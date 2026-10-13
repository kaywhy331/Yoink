import { createYoinkServer } from "../apps/api/src/app.js";
import { ADD_LANE_IDS } from "../packages/contracts/src/index.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { collectRetailerShadowAttempt } from "../apps/extension/src/retailer-shadow.js";
import { rehearseBananaRepublicAdd, type BananaRepublicAddJob } from "../apps/extension/src/bananarepublic-action.js";
import { BANANAREPUBLIC_ADD_ADAPTER_VERSION, BANANAREPUBLIC_OBSERVER_VERSION, BANANAREPUBLIC_ADD_ACTIVATION_CONFIRMATION,
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

test("upgrading an existing private workspace adds a Howl BANANAREPUBLIC policy without replacing saved configuration", t => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-bananarepublic-upgrade-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "yoink.sqlite");
  let db = new YoinkDatabase(path);
  db.run("INSERT INTO tenants(id, name, created_at) VALUES ('tenant_bananarepublic_upgrade', 'Existing tenant', ?)", new Date().toISOString());
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES ('user_bananarepublic_upgrade', 'tenant_bananarepublic_upgrade', 'Existing user', ?)", new Date().toISOString());
  db.close();
  db = new YoinkDatabase(path);
  try {
    const policy = db.get<{ id: string; enabled: number; provider: string; tenant_id: string }>(
      "SELECT id, enabled, provider, tenant_id FROM attribution_policies WHERE user_id = 'user_bananarepublic_upgrade' AND retailer_id = 'bananarepublic'");
    assert.equal(policy?.id, ownedIdForUser("attribution_bananarepublic", "user_bananarepublic_upgrade", "attribution_bananarepublic_local"));
    assert.equal(policy?.tenant_id, "tenant_bananarepublic_upgrade");
    // Howl covers this store, so its policy starts on (Kevin, 2026-10-13: Howl links first where available).
    assert.equal(policy?.enabled, 1);
    assert.equal(policy?.provider, "howl");
    db.run("UPDATE attribution_policies SET enabled = 0 WHERE id = ?", policy!.id);
  } finally { db.close(); }
  db = new YoinkDatabase(path);
  try {
    assert.equal(db.get<{ enabled: number }>("SELECT enabled FROM attribution_policies WHERE user_id = 'user_bananarepublic_upgrade' AND retailer_id = 'bananarepublic'")?.enabled, 0, "the saved choice stays");
    assert.equal(db.get<{ count: number }>("SELECT count(*) AS count FROM retailer_adapter_qualifications WHERE retailer_id = 'bananarepublic'")?.count, 0);
  } finally { db.close(); }
});

test("BananaRepublic canonical links retain the exact One Size child and reject other hosts or regions", () => {
  const canonicalUrl = "https://bananarepublic.gap.com/browse/product.do?pid=9067620520000";
  const link = exactRetailerProductLink(`${canonicalUrl}&vid=1&utm_source=ignored#details`);
  assert.equal(link?.retailerId, "bananarepublic");
  assert.equal(link?.retailerSku, "9067620520000");
  assert.equal(link?.canonicalUrl, canonicalUrl);
  assert.equal(trackalackerCanonicalIdentity(canonicalUrl).canonicalUrl, canonicalUrl);
  for (const url of [`${canonicalUrl}&vid=2`, `${canonicalUrl}&pid=9067580020000`, canonicalUrl.replace("bananarepublic.gap.com", "secure-bananarepublic.gap.com"), canonicalUrl.replace("9067620520000", "906762052")]) {
    assert.equal(exactRetailerProductLink(url), null, url);
  }
});

test("live BananaRepublic evidence flows through qualification, setup, signals and the full API retailer-hint list", async () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const device = devices.pair({ pairingCode: devices.createPairingCode(now).code,
      extensionVersion: "1.28.0", capabilities: { readiness: true, jobReconciliation: true, bananarepublicAddOnly: true, bananarepublicAddAdapterVersion: BANANAREPUBLIC_ADD_ADAPTER_VERSION } }, now);
    const observations = new ShadowObservationRepository(db);
    const qualifications = new QualificationRepository(db);
    const saved = ["bandana", "beanie"].map((handle, index) => {
      const metadata = JSON.parse(readFileSync(`docs/store-evidence/bananarepublic/${handle}-product-2026-09-06.json`, "utf8"));
      const url: string = metadata.url;
      const document = new JSDOM(`<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(metadata.product)}</script></head><body>${metadata.html}</body></html>`, { url }).window.document as Document;
      for (const input of document.querySelectorAll<HTMLInputElement>("input[data-selected]")) input.checked = input.getAttribute("data-selected") === "true";
      const attempt = collectRetailerShadowAttempt(document, url, "bananarepublic", "shipping", 1, false, environment);
      assert.equal(attempt.diagnostic.outcome, "passed", JSON.stringify(attempt.diagnostic));
      assert.equal(attempt.observation.selectedOffer?.selectionState, "exact");
      const observation = { ...attempt.observation, observedAt: new Date(now + index).toISOString() };
      assert.equal(observation.adapterVersion, BANANAREPUBLIC_OBSERVER_VERSION);
      assert.equal(observation.addControlActionable, true);
      assert.equal(observation.sellerName, "Banana Republic");
      assert.ok(observation.canonicalUrl);
      assert.equal(observation.canonicalUrl, `https://bananarepublic.gap.com/browse/product.do?pid=${metadata.sku}`);
      assert.equal(observation.retailerSku, metadata.sku);
      const record = observations.record(device.id, observation, now + index);
      const job: BananaRepublicAddJob = { contractVersion: 1, adapterVersion: BANANAREPUBLIC_ADD_ADAPTER_VERSION,
        jobId: `job_${observation.retailerSku}`, retailerId: "bananarepublic", retailerSku: observation.retailerSku,
        canonicalUrl: observation.canonicalUrl, action: "add_to_cart", quantity: 1, currency: "USD", sellerPolicy: "first_party_only",
        expectedSeller: "Banana Republic", fulfillment: "shipping", maxUnitPriceCents: observation.unitPriceCents!, maxOrderTotalCents: observation.unitPriceCents!,
        expiresAt: new Date(now + 60_000).toISOString() };
      assert.equal(rehearseBananaRepublicAdd(document, url, job, now, environment).ok, true);
      assert.equal(rehearseBananaRepublicAdd(document, url, { ...job, quantity: 2 }, now, environment).ok, false);
      assert.equal(rehearseBananaRepublicAdd(document, url, { ...job, fulfillment: "pickup" }, now, environment).ok, false);
      qualifications.recordAddRehearsal("bananarepublic", device.id, { adapterVersion: BANANAREPUBLIC_ADD_ADAPTER_VERSION,
        observerVersion: BANANAREPUBLIC_OBSERVER_VERSION, contractVersion: 1, packVersion: "retailers-pack-v1", shadowObservationId: record.id,
        observedAt: new Date(now + index + 2).toISOString(), outcome: "passed", reasonCode: "verified" }, now + index + 2);
      return { ...observation, canonicalUrl: observation.canonicalUrl };
    });
    assert.equal(qualifications.addQualified("bananarepublic", now + 5), false);
    const readiness = observations.bananarepublicQualificationReadiness(now + 5);
    assert.equal(readiness.qualificationEvidenceReady, true);
    qualifications.activateAdd("bananarepublic", { adapterVersion: BANANAREPUBLIC_ADD_ADAPTER_VERSION, evidenceHash: readiness.qualificationEvidenceHash,
      confirmation: BANANAREPUBLIC_ADD_ACTIVATION_CONFIRMATION }, now + 6);
    assert.equal(qualifications.addQualified("bananarepublic", now + 7), true);
    assert.equal(qualifications.addQualified("pokemoncenter", now + 7), false);
    assert.equal(new RetailerReadinessRepository(db).lanes(now + 7).find(lane => lane.retailerId === "bananarepublic")?.evidence.rehearsalReady, true);
    const offer = saved[1]!;
    const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_browser_local", source: "browser",
      sourceProductId: offer.retailerSku, sourceListingId: offer.retailerSku, title: "Merino Lightweight Striped Beanie", retailerId: "bananarepublic",
      retailerSku: offer.retailerSku, canonicalUrl: offer.canonicalUrl, listingStatus: "in_stock", executionSupported: true, msrpCents: offer.unitPriceCents!, currency: "USD" }, now + 8);
    const control = new ControlRepository(db);
    control.replaceStrategies([], now + 8);
    control.createConfiguredMission({ contractVersion: 1, listingId: listing.listing.id, targetQuantity: 1, maxUnitPriceCents: offer.unitPriceCents!,
      maxAllInCents: 6000, actionCeiling: "add_to_cart", sellerPolicy: "first_party_only", fulfillment: "shipping", substitutionPolicy: "exact_only",
      cooldownSeconds: 0, confirmation: "CREATE_EXACT_PURCHASE_PLAN" }, now + 8);
    db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
    const result = new SignalEngine(db).process({ sourceConnectionId: "source_browser_local", source: "browser", externalEventId: "bananarepublic_live_fixture_signal",
      eventType: "restock", observedAt: new Date(now + 9).toISOString(), parserVersion: "bananarepublic-fixture-v1",
      identity: { sourceProductId: offer.retailerSku, sourceListingId: offer.retailerSku, retailerId: "bananarepublic", retailerSku: offer.retailerSku,
        canonicalUrl: offer.canonicalUrl, title: "Merino Lightweight Striped Beanie" },
      offer: { availability: "in_stock", unitPriceCents: offer.unitPriceCents!, currency: "USD", sellerName: "Banana Republic", sellerType: "first_party", fulfillment: "shipping", orderLimit: 1 }
    }, now + 10);
    assert.equal(result.actionJobState, "awaiting_executor", result.reason);
    const execution = new ExecutionRepository(db);
    assert.equal(execution.leaseNextJob(device.id, now + 11, ["target"]).reason, "no_jobs");
    const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "1.28.0" });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/devices/self/jobs/next?retailers=${ADD_LANE_IDS.join(",")}`, {
        headers: { Origin: `chrome-extension://${"a".repeat(32)}`, Authorization: `Bearer ${device.token}` }
      });
      assert.equal(response.status, 200);
      const lease = await response.json() as any;
      assert.equal(lease.reason, "leased", JSON.stringify(lease));
      assert.equal(lease.job?.adapterVersion, BANANAREPUBLIC_ADD_ADAPTER_VERSION);
      assert.equal(lease.job?.retailerSku, offer.retailerSku);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally { db.close(); }
});
