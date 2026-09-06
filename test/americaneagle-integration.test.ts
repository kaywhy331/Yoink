import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { collectRetailerShadowAttempt } from "../apps/extension/src/retailer-shadow.js";
import { rehearseAmericanEagleAdd, type AmericanEagleAddJob } from "../apps/extension/src/americaneagle-action.js";
import { AMERICANEAGLE_ADD_ADAPTER_VERSION, AMERICANEAGLE_OBSERVER_VERSION, AMERICANEAGLE_ADD_ACTIVATION_CONFIRMATION,
  type AdapterEnvironment } from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";
import { QualificationRepository } from "../packages/database/src/qualification-repository.js";
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { exactRetailerProductLink } from "../packages/domain/src/attribution.js";
import { trackalackerCanonicalIdentity } from "../packages/sources/src/trackalacker.js";
import { ownedIdForUser } from "../packages/database/src/request-scope.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const environment: AdapterEnvironment = { isVisible: element => {
  for (let e: Element | null = element; e; e = e.parentElement) if (e.getAttribute("data-yoink-vis") === "0" || e.hasAttribute("hidden")) return false;
  return true;
} };

test("upgrading an existing private workspace adds a disabled American Eagle policy without replacing saved configuration", t => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-ae-upgrade-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "yoink.sqlite");
  let db = new YoinkDatabase(path);
  db.run("INSERT INTO tenants(id, name, created_at) VALUES ('tenant_ae_upgrade', 'Existing tenant', ?)", new Date().toISOString());
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES ('user_ae_upgrade', 'tenant_ae_upgrade', 'Existing user', ?)", new Date().toISOString());
  db.close();
  db = new YoinkDatabase(path);
  try {
    const policy = db.get<{ id: string; enabled: number; provider: string; tenant_id: string }>(
      "SELECT id, enabled, provider, tenant_id FROM attribution_policies WHERE user_id = 'user_ae_upgrade' AND retailer_id = 'americaneagle'");
    assert.equal(policy?.id, ownedIdForUser("attribution_americaneagle", "user_ae_upgrade", "attribution_americaneagle_local"));
    assert.equal(policy?.tenant_id, "tenant_ae_upgrade");
    assert.equal(policy?.enabled, 0);
    assert.equal(policy?.provider, "canonical");
    db.run("UPDATE attribution_policies SET enabled = 1 WHERE id = ?", policy!.id);
  } finally { db.close(); }
  db = new YoinkDatabase(path);
  try {
    assert.equal(db.get<{ enabled: number }>("SELECT enabled FROM attribution_policies WHERE user_id = 'user_ae_upgrade' AND retailer_id = 'americaneagle'")?.enabled, 1);
    assert.equal(db.get<{ count: number }>("SELECT count(*) AS count FROM retailer_adapter_qualifications WHERE retailer_id = 'americaneagle'")?.count, 0);
  } finally { db.close(); }
});

test("American Eagle canonical links retain sku identity and reject ambiguous catalog links", () => {
  const link = exactRetailerProductLink("https://www.ae.com/us/en/p/0427_9775_410?sku=0045503992&utm_source=ignored");
  assert.equal(link?.retailerId, "americaneagle");
  assert.equal(link?.retailerSku, "0045503992");
  assert.equal(link?.canonicalUrl, "https://www.ae.com/us/en/p/0427_9775_410?sku=0045503992");
  assert.equal(trackalackerCanonicalIdentity("https://www.ae.com/us/en/p/0427_9775_410?sku=0045503992&utm_source=ignored").canonicalUrl, link?.canonicalUrl);
  assert.equal(exactRetailerProductLink("https://www.ae.com/us/en/p/0427_9775_410"), null);
  assert.equal(exactRetailerProductLink("https://www.ae.com/us/en/c/new?sku=0045503992"), null);
});

test("live American Eagle page evidence flows through independent qualification, setup, signal and leasing", () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const device = devices.pair({ pairingCode: devices.createPairingCode(now).code,
      capabilities: { readiness: true, jobReconciliation: true, americanEagleAddOnly: true, americanEagleAddAdapterVersion: AMERICANEAGLE_ADD_ADAPTER_VERSION } }, now);
    const observations = new ShadowObservationRepository(db);
    const qualifications = new QualificationRepository(db);
    const saved = ["tote-product", "charm-product"].map((handle, index) => {
      const url: string = JSON.parse(readFileSync(`test/fixtures/retailers/americaneagle/${handle}.json`, "utf8")).url;
      const document = new JSDOM(readFileSync(`test/fixtures/retailers/americaneagle/${handle}.html`, "utf8"), { url }).window.document as Document;
      const attempt = collectRetailerShadowAttempt(document, url, "americaneagle", "shipping", 1, false, environment);
      assert.equal(attempt.diagnostic.outcome, "passed", JSON.stringify(attempt.diagnostic));
      assert.equal(attempt.observation.selectedOffer?.selectionState, "exact");
      const observation = { ...attempt.observation, observedAt: new Date(now + index).toISOString() };
      assert.equal(observation.adapterVersion, AMERICANEAGLE_OBSERVER_VERSION);
      assert.equal(observation.addControlActionable, true);
      assert.equal(observation.sellerName, "American Eagle");
      assert.ok(observation.canonicalUrl);
      assert.equal(new URL(observation.canonicalUrl).searchParams.get("sku"), observation.retailerSku);
      const record = observations.record(device.id, observation, now + index);
      const job: AmericanEagleAddJob = { contractVersion: 1, adapterVersion: AMERICANEAGLE_ADD_ADAPTER_VERSION,
        jobId: `job_${observation.retailerSku}`, retailerId: "americaneagle", retailerSku: observation.retailerSku,
        canonicalUrl: observation.canonicalUrl, action: "add_to_cart", quantity: 1, currency: "USD", sellerPolicy: "first_party_only",
        expectedSeller: "American Eagle", fulfillment: "shipping", maxUnitPriceCents: observation.unitPriceCents!, maxOrderTotalCents: observation.unitPriceCents!,
        expiresAt: new Date(now + 60_000).toISOString() };
      assert.equal(rehearseAmericanEagleAdd(document, url, job, now, environment).ok, true);
      qualifications.recordAddRehearsal("americaneagle", device.id, { adapterVersion: AMERICANEAGLE_ADD_ADAPTER_VERSION,
        observerVersion: AMERICANEAGLE_OBSERVER_VERSION, contractVersion: 1, packVersion: "retailers-pack-v1", shadowObservationId: record.id,
        observedAt: new Date(now + index + 2).toISOString(), outcome: "passed", reasonCode: "verified" }, now + index + 2);
      return { ...observation, canonicalUrl: observation.canonicalUrl };
    });
    assert.equal(qualifications.addQualified("americaneagle", now + 5), false);
    const readiness = observations.americanEagleQualificationReadiness(now + 5);
    assert.equal(readiness.qualificationEvidenceReady, true);
    qualifications.activateAdd("americaneagle", { adapterVersion: AMERICANEAGLE_ADD_ADAPTER_VERSION, evidenceHash: readiness.qualificationEvidenceHash,
      confirmation: AMERICANEAGLE_ADD_ACTIVATION_CONFIRMATION }, now + 6);
    assert.equal(qualifications.addQualified("americaneagle", now + 7), true);
    assert.equal(qualifications.addQualified("pokemoncenter", now + 7), false);
    assert.equal(new RetailerReadinessRepository(db).lanes(now + 7).find(lane => lane.retailerId === "americaneagle")?.evidence.rehearsalReady, true);
    const offer = saved[1]!;
    const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_browser_local", source: "browser",
      sourceProductId: offer.retailerSku, sourceListingId: offer.retailerSku, title: "AE Halloweenie Bag Charm", retailerId: "americaneagle",
      retailerSku: offer.retailerSku, canonicalUrl: offer.canonicalUrl, listingStatus: "in_stock", executionSupported: true, msrpCents: 1795, currency: "USD" }, now + 8);
    const control = new ControlRepository(db);
    control.replaceStrategies([], now + 8);
    control.createConfiguredMission({ contractVersion: 1, listingId: listing.listing.id, targetQuantity: 1, maxUnitPriceCents: 1795,
      maxAllInCents: 3000, actionCeiling: "add_to_cart", sellerPolicy: "first_party_only", fulfillment: "shipping", substitutionPolicy: "exact_only",
      cooldownSeconds: 0, confirmation: "CREATE_EXACT_PURCHASE_PLAN" }, now + 8);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const result = new SignalEngine(db).process({ sourceConnectionId: "source_browser_local", source: "browser", externalEventId: "ae_live_fixture_signal",
      eventType: "restock", observedAt: new Date(now + 9).toISOString(), parserVersion: "ae-fixture-v1",
      identity: { sourceProductId: offer.retailerSku, sourceListingId: offer.retailerSku, retailerId: "americaneagle", retailerSku: offer.retailerSku,
        canonicalUrl: offer.canonicalUrl, title: "AE Halloweenie Bag Charm" },
      offer: { availability: "in_stock", unitPriceCents: 1795, currency: "USD", sellerName: "American Eagle", sellerType: "first_party", fulfillment: "shipping", orderLimit: 1 }
    }, now + 10);
    assert.equal(result.actionJobState, "awaiting_executor", result.reason);
    const execution = new ExecutionRepository(db);
    assert.equal(execution.leaseNextJob(device.id, now + 11, ["target"]).reason, "no_jobs");
    const lease = execution.leaseNextJob(device.id, now + 11, ["americaneagle"]);
    assert.equal(lease.reason, "leased");
    assert.equal(lease.job?.adapterVersion, AMERICANEAGLE_ADD_ADAPTER_VERSION);
    assert.equal(lease.job?.retailerSku, offer.retailerSku);
  } finally { db.close(); }
});
