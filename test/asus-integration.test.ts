import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { collectRetailerShadowAttempt } from "../apps/extension/src/retailer-shadow.js";
import { rehearseAsusAdd, type AsusAddJob } from "../apps/extension/src/asus-action.js";
import { ASUS_ADD_ADAPTER_VERSION, ASUS_OBSERVER_VERSION, ASUS_ADD_ACTIVATION_CONFIRMATION,
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
  for (let e: Element | null = element; e; e = e.parentElement) if (e.getAttribute("data-assessment-visible") === "false" || e.hasAttribute("hidden")) return false;
  return true;
} };

test("upgrading an existing private workspace adds a disabled ASUS policy without replacing saved configuration", t => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-asus-upgrade-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "yoink.sqlite");
  let db = new YoinkDatabase(path);
  db.run("INSERT INTO tenants(id, name, created_at) VALUES ('tenant_asus_upgrade', 'Existing tenant', ?)", new Date().toISOString());
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES ('user_asus_upgrade', 'tenant_asus_upgrade', 'Existing user', ?)", new Date().toISOString());
  db.close();
  db = new YoinkDatabase(path);
  try {
    const policy = db.get<{ id: string; enabled: number; provider: string; tenant_id: string }>(
      "SELECT id, enabled, provider, tenant_id FROM attribution_policies WHERE user_id = 'user_asus_upgrade' AND retailer_id = 'asus'");
    assert.equal(policy?.id, ownedIdForUser("attribution_asus", "user_asus_upgrade", "attribution_asus_local"));
    assert.equal(policy?.tenant_id, "tenant_asus_upgrade");
    assert.equal(policy?.enabled, 0);
    assert.equal(policy?.provider, "canonical");
    db.run("UPDATE attribution_policies SET enabled = 1 WHERE id = ?", policy!.id);
  } finally { db.close(); }
  db = new YoinkDatabase(path);
  try {
    assert.equal(db.get<{ enabled: number }>("SELECT enabled FROM attribution_policies WHERE user_id = 'user_asus_upgrade' AND retailer_id = 'asus'")?.enabled, 1);
    assert.equal(db.get<{ count: number }>("SELECT count(*) AS count FROM retailer_adapter_qualifications WHERE retailer_id = 'asus'")?.count, 0);
  } finally { db.close(); }
});

test("ASUS canonical links retain the product path and reject configurations and non-US offers", () => {
  const canonicalUrl = "https://eshop.asus.com/us/90mp04d0-bmaa02-rog-harpe-mini-core.html";
  const link = exactRetailerProductLink(`${canonicalUrl}?utm_source=ignored#details`);
  assert.equal(link?.retailerId, "asus");
  assert.equal(link?.retailerSku, "90MP04D0-BMAA02");
  assert.equal(link?.canonicalUrl, canonicalUrl);
  assert.equal(trackalackerCanonicalIdentity(canonicalUrl).canonicalUrl, canonicalUrl);
  for (const url of [`${canonicalUrl}?config=123`, canonicalUrl.replace("/us/", "/ca-en/"), canonicalUrl.replace("eshop.asus.com", "asus.com"), canonicalUrl.replace("90mp04d0-bmaa02", "48256")]) {
    assert.equal(exactRetailerProductLink(url), null, url);
  }
});

test("live ASUS page evidence flows through independent qualification, setup, signal and leasing", () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const device = devices.pair({ pairingCode: devices.createPairingCode(now).code,
      capabilities: { readiness: true, jobReconciliation: true, asusAddOnly: true, asusAddAdapterVersion: ASUS_ADD_ADAPTER_VERSION } }, now);
    const observations = new ShadowObservationRepository(db);
    const qualifications = new QualificationRepository(db);
    const saved = ["mouse", "pad"].map((handle, index) => {
      const metadata = JSON.parse(readFileSync(`docs/store-evidence/asus/${handle}-product-2026-09-06.json`, "utf8"));
      const url: string = metadata.url;
      const document = new JSDOM(readFileSync(`docs/store-evidence/asus/${handle}-product-2026-09-06.html`, "utf8"), { url }).window.document as Document;
      for (const [field, value] of [["currency", metadata.currency], ["amount", String(metadata.priceCents / 100)]]) {
        const meta = document.createElement("meta"); meta.setAttribute("property", `product:price:${field}`); meta.content = value; document.head.append(meta);
      }
      const attempt = collectRetailerShadowAttempt(document, url, "asus", "shipping", 1, false, environment);
      assert.equal(attempt.diagnostic.outcome, "passed", JSON.stringify(attempt.diagnostic));
      assert.equal(attempt.observation.selectedOffer?.selectionState, "exact");
      const observation = { ...attempt.observation, observedAt: new Date(now + index).toISOString() };
      assert.equal(observation.adapterVersion, ASUS_OBSERVER_VERSION);
      assert.equal(observation.addControlActionable, true);
      assert.equal(observation.sellerName, "ASUS");
      assert.ok(observation.canonicalUrl);
      assert.equal(observation.canonicalUrl, metadata.url);
      assert.equal(observation.retailerSku, metadata.sku);
      const record = observations.record(device.id, observation, now + index);
      const job: AsusAddJob = { contractVersion: 1, adapterVersion: ASUS_ADD_ADAPTER_VERSION,
        jobId: `job_${observation.retailerSku}`, retailerId: "asus", retailerSku: observation.retailerSku,
        canonicalUrl: observation.canonicalUrl, action: "add_to_cart", quantity: 1, currency: "USD", sellerPolicy: "first_party_only",
        expectedSeller: "ASUS", fulfillment: "shipping", maxUnitPriceCents: observation.unitPriceCents!, maxOrderTotalCents: observation.unitPriceCents!,
        expiresAt: new Date(now + 60_000).toISOString() };
      assert.equal(rehearseAsusAdd(document, url, job, now, environment).ok, true);
      assert.equal(rehearseAsusAdd(document, url, { ...job, quantity: 2 }, now, environment).ok, false);
      assert.equal(rehearseAsusAdd(document, url, { ...job, fulfillment: "pickup" }, now, environment).ok, false);
      qualifications.recordAddRehearsal("asus", device.id, { adapterVersion: ASUS_ADD_ADAPTER_VERSION,
        observerVersion: ASUS_OBSERVER_VERSION, contractVersion: 1, packVersion: "retailers-pack-v1", shadowObservationId: record.id,
        observedAt: new Date(now + index + 2).toISOString(), outcome: "passed", reasonCode: "verified" }, now + index + 2);
      return { ...observation, canonicalUrl: observation.canonicalUrl };
    });
    assert.equal(qualifications.addQualified("asus", now + 5), false);
    const readiness = observations.asusQualificationReadiness(now + 5);
    assert.equal(readiness.qualificationEvidenceReady, true);
    qualifications.activateAdd("asus", { adapterVersion: ASUS_ADD_ADAPTER_VERSION, evidenceHash: readiness.qualificationEvidenceHash,
      confirmation: ASUS_ADD_ACTIVATION_CONFIRMATION }, now + 6);
    assert.equal(qualifications.addQualified("asus", now + 7), true);
    assert.equal(qualifications.addQualified("pokemoncenter", now + 7), false);
    assert.equal(new RetailerReadinessRepository(db).lanes(now + 7).find(lane => lane.retailerId === "asus")?.evidence.rehearsalReady, true);
    const offer = saved[1]!;
    const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_browser_local", source: "browser",
      sourceProductId: offer.retailerSku, sourceListingId: offer.retailerSku, title: "ROG Scabbard II Arctic Gray XXL", retailerId: "asus",
      retailerSku: offer.retailerSku, canonicalUrl: offer.canonicalUrl, listingStatus: "in_stock", executionSupported: true, msrpCents: 4999, currency: "USD" }, now + 8);
    const control = new ControlRepository(db);
    control.replaceStrategies([], now + 8);
    control.createConfiguredMission({ contractVersion: 1, listingId: listing.listing.id, targetQuantity: 1, maxUnitPriceCents: 4999,
      maxAllInCents: 6000, actionCeiling: "add_to_cart", sellerPolicy: "first_party_only", fulfillment: "shipping", substitutionPolicy: "exact_only",
      cooldownSeconds: 0, confirmation: "CREATE_EXACT_PURCHASE_PLAN" }, now + 8);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const result = new SignalEngine(db).process({ sourceConnectionId: "source_browser_local", source: "browser", externalEventId: "asus_live_fixture_signal",
      eventType: "restock", observedAt: new Date(now + 9).toISOString(), parserVersion: "asus-fixture-v1",
      identity: { sourceProductId: offer.retailerSku, sourceListingId: offer.retailerSku, retailerId: "asus", retailerSku: offer.retailerSku,
        canonicalUrl: offer.canonicalUrl, title: "ROG Scabbard II Arctic Gray XXL" },
      offer: { availability: "in_stock", unitPriceCents: 4999, currency: "USD", sellerName: "ASUS", sellerType: "first_party", fulfillment: "shipping", orderLimit: 1 }
    }, now + 10);
    assert.equal(result.actionJobState, "awaiting_executor", result.reason);
    const execution = new ExecutionRepository(db);
    assert.equal(execution.leaseNextJob(device.id, now + 11, ["target"]).reason, "no_jobs");
    const lease = execution.leaseNextJob(device.id, now + 11, ["asus"]);
    assert.equal(lease.reason, "leased");
    assert.equal(lease.job?.adapterVersion, ASUS_ADD_ADAPTER_VERSION);
    assert.equal(lease.job?.retailerSku, offer.retailerSku);
  } finally { db.close(); }
});
