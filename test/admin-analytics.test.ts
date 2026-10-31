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
import { SignalRepository } from "../packages/database/src/signal-repository.js";

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

test("partial latency evidence preserves missing hops and valid sample denominators across repositories and CSV", () => {
  const db = new YoinkDatabase();
  try {
    seedAnalytics(db);
    const signals = new SignalRepository(db);
    db.run("DELETE FROM action_events WHERE id = 'carted_target_0'");
    db.run("UPDATE action_jobs SET state = 'cart_verified' WHERE id = 'job_target_0'");
    const evidence = { extensionVersion: "1.30.49", adapterVersion: "target-add-v12", latency: {
      leaseToBaselineMs: 0,
      baselineToOfferMs: null,
      offerToClickMs: "",
      clickToSettleMs: false,
      settleToCartReadyMs: -1,
      leaseToCartReadyMs: null
    } };
    signals.transitionJob("job_target_0", "confirmed", "exact_cart_delta_verified", "Fixture cart proof.", evidence, Date.parse(CARTED_AT));
    assert.deepEqual(JSON.parse(db.get<{ evidence: string }>(
      "SELECT evidence_json AS evidence FROM action_events WHERE job_id = 'job_target_0' AND reason_code = 'exact_cart_delta_verified'"
    )!.evidence), evidence, "persistence keeps null and omitted measurements distinct from numeric zero");

    // A shopper's order report is not a timestamp for cart proof.
    db.run("DELETE FROM action_events WHERE id = 'carted_walmart_1'");
    db.run("UPDATE action_events SET created_at = 'invalid timestamp' WHERE id = 'leased_amazon_2'");
    const jobs = new Map(signals.listJobs().map((job) => [job.id, job.latency as Record<string, number | null>]));
    assert.equal(jobs.get("job_target_0")?.leaseToBaselineMs, 0);
    assert.equal(jobs.get("job_target_0")?.leaseToCartReadyMs, 60_000, "missing stored duration uses the valid lease and cart timestamps");
    for (const hop of ["baselineToOfferMs", "offerToClickMs", "clickToSettleMs", "settleToCartReadyMs", "clickToCartReadyMs"]) {
      assert.equal(jobs.get("job_target_0")?.[hop], null, hop);
    }
    assert.equal(jobs.get("job_walmart_1")?.leaseToCartReadyMs, null);
    assert.equal(jobs.get("job_amazon_2")?.leaseToBaselineMs, null, "invalid lease timestamps cannot establish browser hops");

    const admin = new AdminAnalyticsRepository(db);
    const snapshot = admin.snapshot("24h", NOW);
    const insights = signals.actionInsights() as { latency: { jobsSampled: number; hops: unknown } };
    assert.equal(snapshot.latency.jobsSampled, 4);
    assert.equal(insights.latency.jobsSampled, 4);
    assert.deepEqual(insights.latency.hops, snapshot.latency.hops);
    assert.deepEqual(snapshot.latency.hops.leaseToBaselineMs, { samples: 2, p50Ms: 0, p95Ms: 120 });
    assert.deepEqual(snapshot.latency.hops.baselineToOfferMs, { samples: 1, p50Ms: 230, p95Ms: 230 });
    assert.deepEqual(snapshot.latency.hops.leaseToCartReadyMs, { samples: 2, p50Ms: 1700, p95Ms: 60_000 });
    assert.deepEqual(snapshot.latency.hops.observedToReceivedMs, { samples: 0, p50Ms: null, p95Ms: null });
    const target = snapshot.latency.breakdowns.find((group) => group.retailerId === "target")!;
    assert.equal(target.outcome, "got_it");
    assert.equal(target.extensionVersion, "1.30.49");
    assert.equal(target.adapterVersion, "target-add-v12");
    assert.equal(target.jobsSampled, 1);
    assert.deepEqual(target.hops.leaseToBaselineMs, { samples: 1, p50Ms: 0, p95Ms: 0 });
    assert.deepEqual(target.hops.baselineToOfferMs, { samples: 0, p50Ms: null, p95Ms: null });
    const missed = snapshot.latency.breakdowns.find((group) => group.retailerId === "bestbuy")!;
    assert.equal(missed.outcome, "missed_it");
    assert.equal(missed.extensionVersion, null);
    assert.equal(missed.adapterVersion, null);
    assert.equal(snapshot.latency.breakdowns.reduce((sum, group) => sum + group.jobsSampled, 0), 4);
    const csv = admin.csv("24h", NOW);
    assert.match(csv, /^scope,period,retailer,metric,value,outcome,extensionVersion,adapterVersion$/m);
    assert.match(csv, /^latency,24h,,jobsSampled,4,,,/m);
    assert.match(csv, /^latency,24h,,maximumSampleSize,500,,,/m);
    assert.match(csv, /^latency,24h,,leaseToBaselineMs.samples,2(?:,|$)/m);
    assert.match(csv, /^latency,24h,,leaseToBaselineMs.p50Ms,0(?:,|$)/m);
    assert.match(csv, /^latency,24h,,observedToReceivedMs.samples,0(?:,|$)/m);
    assert.match(csv, /^latency,24h,,observedToReceivedMs.p50Ms,(?:,|$)/m);
    assert.match(csv, /^latency_breakdown,24h,target,leaseToBaselineMs.samples,1,got_it,1.30.49,target-add-v12$/m);
    assert.match(csv, /^latency_breakdown,24h,target,baselineToOfferMs.p50Ms,,got_it,1.30.49,target-add-v12$/m);
    assert.match(csv, /^latency_breakdown,24h,bestbuy,jobsSampled,1,missed_it,,$/m);
    for (const line of csv.trim().split("\n")) assert.equal(line.split(",").length, 8);
  } finally {
    db.close();
  }
});

test("latency breakdowns group the same outcome, store and historical versions with independent hop counts", () => {
  const db = new YoinkDatabase();
  try {
    seedAnalytics(db);
    db.run("UPDATE listings SET retailer_id = 'target'");
    for (const [index, eventId] of ["carted_target_0", "carted_walmart_1"].entries()) {
      db.run("UPDATE action_events SET evidence_json = ? WHERE id = ?", JSON.stringify({
        extensionVersion: "1.30.49", adapterVersion: "target-add-v12",
        latency: index === 0 ? { leaseToBaselineMs: 0 } : {}
      }), eventId);
    }
    db.run("DELETE FROM action_events WHERE id = 'outcome_amazon_2'");
    db.run("UPDATE action_events SET evidence_json = ? WHERE id = 'carted_amazon_2'",
      JSON.stringify({ extensionVersion: false, adapterVersion: " " }));
    db.run("UPDATE action_events SET evidence_json = ? WHERE id = 'carted_bestbuy_3'",
      JSON.stringify({ extensionVersion: "1.30.50", adapterVersion: "target-add-v12" }));
    const admin = new AdminAnalyticsRepository(db);
    const { latency } = admin.snapshot("24h", NOW);
    assert.equal(latency.breakdowns.length, 3);
    const known = latency.breakdowns.find((group) => group.extensionVersion === "1.30.49")!;
    assert.equal(known.jobsSampled, 2);
    assert.equal(known.outcome, "got_it");
    assert.deepEqual(known.hops.leaseToBaselineMs, { samples: 1, p50Ms: 0, p95Ms: 0 });
    assert.deepEqual(known.hops.leaseToCartReadyMs, { samples: 2, p50Ms: 60_000, p95Ms: 60_000 });
    const unknown = latency.breakdowns.find((group) => group.extensionVersion === null)!;
    assert.equal(unknown.jobsSampled, 1);
    assert.equal(unknown.outcome, "confirmed", "an unreported job keeps its current state");
    assert.equal(unknown.adapterVersion, null);
    assert.equal(latency.breakdowns.find((group) => group.extensionVersion === "1.30.50")?.outcome, "missed_it");
    assert.match(admin.csv("24h", NOW), /^latency_breakdown,24h,target,jobsSampled,2,got_it,1.30.49,target-add-v12$/m);
  } finally {
    db.close();
  }
});

test("latency reporting and export retain the bounded job denominator even when most hops are missing", () => {
  const db = new YoinkDatabase();
  try {
    seedAnalytics(db);
    const template = db.get<Record<string, string | number | null>>("SELECT * FROM action_jobs WHERE id = 'job_target_0'")!;
    const columns = Object.keys(template);
    db.transaction(() => {
      for (let index = 0; index < 500; index++) {
        const id = `zz_latency_${String(index).padStart(3, "0")}`;
        const row: Record<string, string | number | null> = { ...template, id, idempotency_key: id, capability_nonce_hash: id };
        db.run(`INSERT INTO action_jobs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, ...columns.map((column) => row[column]!));
      }
    });
    const admin = new AdminAnalyticsRepository(db);
    const snapshot = admin.snapshot("24h", NOW);
    assert.equal(snapshot.totals.jobs, 504);
    assert.equal(snapshot.latency.maximumSampleSize, 500);
    assert.equal(snapshot.latency.jobsSampled, 500);
    assert.equal(snapshot.latency.breakdowns.length, 1);
    assert.equal(snapshot.latency.breakdowns[0]?.jobsSampled, 500);
    for (const hop of Object.values(snapshot.latency.hops)) assert.deepEqual(hop, { samples: 0, p50Ms: null, p95Ms: null });
    const insights = new SignalRepository(db).actionInsights(1000) as { latency: { jobsSampled: number; hops: unknown } };
    assert.equal(insights.latency.jobsSampled, 500);
    assert.deepEqual(insights.latency.hops, snapshot.latency.hops);
    const csv = admin.csv("24h", NOW);
    assert.match(csv, /^latency,24h,,jobsSampled,500,,,/m);
    assert.match(csv, /^latency_breakdown,24h,target,jobsSampled,500,confirmed,,$/m);
    assert.match(csv, /^latency_breakdown,24h,target,leaseToBaselineMs.samples,0,confirmed,,$/m);
    assert.match(csv, /^latency_breakdown,24h,target,leaseToBaselineMs.p50Ms,,confirmed,,$/m);
  } finally {
    db.close();
  }
});

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
