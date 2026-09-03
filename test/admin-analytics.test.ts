import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { AdminAnalyticsRepository } from "../packages/database/src/admin-analytics-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { StoreLinkInteractionRepository } from "../packages/database/src/store-link-interaction-repository.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

const NOW = Date.now();
const CREATED_AT = new Date(NOW - 60 * 60_000).toISOString();
const LEASED_AT = new Date(NOW - 59 * 60_000).toISOString();
const CARTED_AT = new Date(NOW - 58 * 60_000).toISOString();
const CLICK_AT = NOW - 40 * 60_000;
const OUTCOME_AT = new Date(NOW - 30 * 60_000).toISOString();
const RETAILERS = ["target", "walmart", "amazon", "bestbuy"] as const;

async function eventually(assertion: () => void, attempts = 300): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function seedAnalytics(db: YoinkDatabase): void {
  const interactions = new StoreLinkInteractionRepository(db);
  for (const [index, retailerId] of RETAILERS.entries()) {
    const suffix = `${retailerId}_${index}`;
    const familyId = `family_${suffix}`;
    const variantId = `variant_${suffix}`;
    const listingId = `listing_${suffix}`;
    const missionId = `mission_${suffix}`;
    const targetId = `mission_target_${suffix}`;
    const incidentId = `incident_${suffix}`;
    const jobId = `job_${suffix}`;
    const sku = `90000000${index}`;
    const canonicalUrl = `https://www.${retailerId === "bestbuy" ? "bestbuy" : retailerId}.com/product/${sku}`;
    db.run("INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, '', ?, ?)", familyId, `${retailerId} family`, CREATED_AT, CREATED_AT);
    db.run("INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)", variantId, familyId, `${retailerId} item`, CREATED_AT, CREATED_AT);
    db.run("INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, msrp_cents, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'in_stock', 1, 2500, 'USD', ?, ?)", listingId, variantId, retailerId, sku, canonicalUrl, CREATED_AT, CREATED_AT);
    db.run("INSERT INTO missions(id, tenant_id, user_id, variant_id, status, origin, target_quantity, fulfilled_quantity, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'manual', 1, 0, ?, ?)", missionId, LOCAL_TENANT_ID, LOCAL_USER_ID, variantId, CREATED_AT, CREATED_AT);
    db.run("INSERT INTO mission_targets(id, mission_id, listing_id, enabled, max_unit_price_cents, currency, seller_policy, fulfillment, created_at, updated_at) VALUES (?, ?, ?, 1, 2500, 'USD', 'first_party_only', 'shipping', ?, ?)", targetId, missionId, listingId, CREATED_AT, CREATED_AT);
    db.run("INSERT INTO signal_incidents(id, tenant_id, user_id, listing_id, event_type, semantic_key, status, unit_price_cents, currency, seller_name, seller_type, offer_fingerprint, first_observed_at, last_observed_at, occurrence_count, closed_reason, created_at, updated_at) VALUES (?, ?, ?, ?, 'in_stock', ?, 'open', 2000, 'USD', ?, 'first_party', ?, ?, ?, 1, '', ?, ?)", incidentId, LOCAL_TENANT_ID, LOCAL_USER_ID, listingId, `semantic_${suffix}`, retailerId, `offer_${suffix}`, CREATED_AT, CREATED_AT, CREATED_AT, CREATED_AT);
    db.run(
      `INSERT INTO action_jobs(
         id, tenant_id, user_id, mission_id, mission_target_id, incident_id, state, action,
         quantity, max_unit_price_cents, max_order_total_cents, currency, seller_policy,
         fulfillment, expected_seller, listing_id, canonical_url, idempotency_key,
         capability_nonce_hash, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', 'add_to_cart', 1, 2500, 2500, 'USD',
         'first_party_only', 'shipping', ?, ?, ?, ?, ?, ?, ?, ?)`,
      jobId, LOCAL_TENANT_ID, LOCAL_USER_ID, missionId, targetId, incidentId, retailerId,
      listingId, canonicalUrl, `idempotency_${suffix}`, `nonce_${suffix}`,
      new Date(NOW + 60 * 60_000).toISOString(), CREATED_AT, CREATED_AT
    );
    db.run(
      `INSERT INTO signal_events(
         id, tenant_id, user_id, source_connection_id, signal_id, external_event_id,
         transport_hash, schema_version, source, event_type, test, observed_at, received_at,
         identity_json, offer_json, evidence_json, parser_version, resolution_status, created_at
       ) VALUES (?, ?, ?, 'source_trackalacker_local', ?, ?, ?, 1, 'trackalacker', 'in_stock', 0,
         ?, ?, ?, '{}', '{}', 'fixture-v1', 'matched', ?)`,
      `signal_event_${suffix}`, LOCAL_TENANT_ID, LOCAL_USER_ID, `signal_${suffix}`,
      `external_${suffix}`, `transport_${suffix}`, CREATED_AT, CREATED_AT,
      JSON.stringify({ retailerId, retailerSku: sku }), CREATED_AT
    );
    db.run("INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, 'leased', 'lease_acquired', 'Leased.', '{}', ?)", `leased_${suffix}`, jobId, LEASED_AT);
    db.run(
      "INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, 'confirmed', 'exact_cart_delta_verified', 'Cart verified.', ?, ?)",
      `carted_${suffix}`,
      jobId,
      JSON.stringify({ latency: {
        leaseToBaselineMs: 120,
        baselineToOfferMs: 230,
        offerToClickMs: 340,
        clickToSettleMs: 450,
        settleToCartReadyMs: 560,
        leaseToCartReadyMs: 1700,
        clickToCartReadyMs: 1010
      } }),
      CARTED_AT
    );
    const affiliate = retailerId === "target" || retailerId === "walmart";
    db.run("INSERT INTO attribution_receipts(id, tenant_id, user_id, job_id, policy_id, retailer_id, provider, outcome, reason_code, route_url, canonical_url_hash, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)", `attribution_${suffix}`, LOCAL_TENANT_ID, LOCAL_USER_ID, jobId, retailerId, affiliate ? "howl" : "canonical", affiliate ? "affiliate_route" : "canonical_fallback", affiliate ? "howl_enabled" : "canonical_only", affiliate ? "https://howl.link/link" : canonicalUrl, `url_hash_${suffix}`, CREATED_AT);
    interactions.record({
      jobId,
      canonicalUrl,
      routeKind: affiliate ? "affiliate" : "direct",
      destinationKind: "cart",
      surface: "activity",
      confirmation: "RECORD_STORE_LINK_CLICK"
    }, CLICK_AT + index);
    if (retailerId === "bestbuy") {
      db.run("INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, 'cancelled', 'user_reported_missed_it', 'Missed.', '{}', ?)", `outcome_${suffix}`, jobId, OUTCOME_AT);
   } else {
      const evidence = retailerId === "target"
        ? JSON.stringify({ actualTotalCents: 3000, reviewedMaximumCents: 2500, overCap: true, overCapAmountCents: 500 })
        : "{}";
      db.run("INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at) VALUES (?, ?, 'confirmed', 'user_reported_order', 'Bought.', ?, ?)", `outcome_${suffix}`, jobId, evidence, OUTCOME_AT);
    }
  }
}

test("operator analytics aggregates all four stores, affiliate clicks, conversions, and CSV", async () => {
  const db = new YoinkDatabase();
  seedAnalytics(db);
  const analytics = new AdminAnalyticsRepository(db).snapshot("24h", NOW);
  assert.deepEqual(analytics.totals, {
    signals: 4,
    matched: 4,
    jobs: 4,
    carted: 4,
    gotIt: 3,
    missed: 1,
    routesIssued: 4,
    affiliateRoutesIssued: 2,
    clicks: 4,
    affiliateClicks: 2,
    conversions: 2
  });
  assert.deepEqual(analytics.overCap, { count: 1, amountCents: 500 });
  assert.equal(analytics.latency.jobsSampled, 4);
  assert.deepEqual(analytics.latency.hops.jobToLeaseMs, { samples: 4, p50Ms: 60_000, p95Ms: 60_000 });
  assert.deepEqual(analytics.latency.hops.leaseToCartReadyMs, { samples: 4, p50Ms: 1700, p95Ms: 1700 });
  assert.deepEqual(analytics.stores.map((store) => store.retailerId).sort(), [...RETAILERS].sort());
  assert.equal(analytics.stores.find((store) => store.retailerId === "target")?.conversions, 1);
  assert.equal(analytics.stores.find((store) => store.retailerId === "amazon")?.conversions, 0);
  assert.equal(db.all("SELECT * FROM audit_events WHERE event_type = 'store_link_clicked'").length, 4);
  assert.equal(JSON.stringify(db.all("SELECT data_json FROM audit_events WHERE event_type = 'store_link_clicked'")).includes("https://"), false);
  assert.match(new AdminAnalyticsRepository(db).csv("24h", NOW), /store,24h,target,conversions,1/);

  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-analytics-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#analytics`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: (path: string, options: RequestInit = {}) => fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        ...(options.method && options.method !== "GET" ? { Origin: baseUrl } : {}),
        ...(options.headers || {})
      }
    })
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });

  try {
    const response = await fetch(`${baseUrl}/api/v1/admin/analytics?window=24h`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-yoink-api-surface"), "admin");
    const apiAnalytics = await response.json() as { analytics: { totals: { clicks: number }; latency: { jobsSampled: number } } };
    assert.equal(apiAnalytics.analytics.totals.clicks, 4);
    assert.equal(apiAnalytics.analytics.latency.jobsSampled, 4);
    const csvResponse = await fetch(`${baseUrl}/api/v1/admin/analytics.csv?window=24h`);
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(await csvResponse.text(), /scope,period,retailer,metric,value/);

    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.equal(browser.document.querySelectorAll("#adminAnalyticsMetrics .metric").length, 6));
    assert.match(browser.document.querySelector("#adminAnalyticsMetrics")?.textContent ?? "", /Clicks4/);
    assert.match(browser.document.querySelector("#adminAnalyticsAttribution")?.textContent ?? "", /Conversions2/);
    assert.match(browser.document.querySelector("#adminAnalyticsMetrics")?.textContent ?? "", /Over cap1\$5\.00 above reviewed maximum/);
    assert.match(browser.document.querySelector("#adminAnalyticsLatency")?.textContent ?? "", /Chrome → cart ready4 samplesp50 1,700 ms · p95 1,700 ms/);
    assert.equal(browser.document.querySelectorAll("#adminAnalyticsStores tr").length, 4);
    assert.match(browser.document.querySelector("#adminAnalyticsStores")?.textContent ?? "", /Target/);
    assert.match(browser.document.querySelector("#adminAnalyticsStores")?.textContent ?? "", /Best Buy/);
    assert.equal((browser.document.querySelector("#adminAnalyticsExport") as HTMLAnchorElement).getAttribute("href"), "/api/v1/admin/analytics.csv?window=7d");
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
