import { officialMsrpFixture } from "./helpers/official-msrp.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { TrackalackerPushEnvelope } from "../packages/contracts/src/index.js";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  ANINEBING_ADD_ADAPTER_VERSION,
  AMERICANEAGLE_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  POKEMONCENTER_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { trackalackerSignalInput } from "../packages/sources/src/trackalacker.js";

const NOW = new Date("2026-08-31T20:00:00.000Z").getTime();

const STORES = [
  {
    retailerId: "americaneagle", retailerName: "American Eagle", retailerSku: "0045350782",
    canonicalUrl: "https://www.ae.com/us/en/p/0577_9778_900?sku=0045350782",
    adapterVersion: AMERICANEAGLE_ADD_ADAPTER_VERSION,
    capability: "americanEagleAddOnly", versionCapability: "americanEagleAddAdapterVersion", unitPriceCents: 1795
  },
  {
    retailerId: "aninebing", retailerName: "Anine Bing", retailerSku: "41205281194056",
    canonicalUrl: "https://www.aninebing.com/products/york-scarf-anine-bing-tango-red?variant=41205281194056",
    adapterVersion: ANINEBING_ADD_ADAPTER_VERSION,
    capability: "anineBingAddOnly", versionCapability: "anineBingAddAdapterVersion", unitPriceCents: 15000
  },
  {
    retailerId: "pokemoncenter", retailerName: "Pokémon Center", retailerSku: "10-10320-101",
    canonicalUrl: "https://www.pokemoncenter.com/product/10-10320-101/binder",
    adapterVersion: POKEMONCENTER_ADD_ADAPTER_VERSION,
    capability: "pokemonCenterAddOnly", versionCapability: "pokemonCenterAddAdapterVersion", unitPriceCents: 2999
  },
  {
    retailerId: "target",
    retailerName: "Target",
    retailerSku: "94972381",
    canonicalUrl: "https://www.target.com/p/-/A-94972381",
    adapterVersion: TARGET_ADD_ADAPTER_VERSION,
    capability: "targetAddOnly",
    versionCapability: "targetAddAdapterVersion",
    unitPriceCents: 3_999
  },
  {
    retailerId: "walmart",
    retailerName: "Walmart",
    retailerSku: "20252562938",
    canonicalUrl: "https://www.walmart.com/ip/20252562938",
    adapterVersion: WALMART_ADD_ADAPTER_VERSION,
    capability: "walmartAddOnly",
    versionCapability: "walmartAddAdapterVersion",
    unitPriceCents: 8_497
  },
  {
    retailerId: "amazon",
    retailerName: "Amazon",
    retailerSku: "B00E4AMFKK",
    canonicalUrl: "https://www.amazon.com/dp/B00E4AMFKK",
    adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
    capability: "amazonAddOnly",
    versionCapability: "amazonAddAdapterVersion",
    unitPriceCents: 582
  },
  {
    retailerId: "bestbuy",
    retailerName: "Best Buy",
    retailerSku: "6685081",
    canonicalUrl: "https://www.bestbuy.com/product/2026-topps-flagship-football-mega-box/J3ZPGXX9RP/sku/6685081",
    adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
    capability: "bestBuyAddOnly",
    versionCapability: "bestBuyAddAdapterVersion",
    unitPriceCents: 4_999
  }
] as const;

function envelope(store: typeof STORES[number], sequence: number): TrackalackerPushEnvelope {
  const signalId = `push:trackalacker:guarded-cart-${store.retailerId}-${sequence}`;
  return {
    schemaVersion: 1,
    signalId,
    source: {
      provider: "trackalacker",
      transport: "chrome_extension_web_push",
      notificationId: signalId,
      applicationName: "Google Chrome",
      applicationId: "a".repeat(32),
      domain: "trackalacker.com",
      createdAt: new Date(NOW - 1_000).toISOString(),
      receivedAt: new Date(NOW).toISOString()
    },
    notification: {
      title: `Signal Cart Fixture is in stock at ${store.retailerName}`,
      body: store.retailerId === "bestbuy"
        ? "Available now"
        : `Available for $${(store.unitPriceCents / 100).toFixed(2)}`,
      textElements: [],
      sourceProductId: `cart-product-${sequence}`,
      sourceListingId: `cart-listing-${sequence}`,
      sourceProductSlug: `signal-cart-fixture-${store.retailerId}`,
      sourceRetailer: store.retailerId,
      sourceRetailerSku: store.retailerSku
    }
  };
}

test("priced trusted exact TrackaLacker signals lease guarded cart jobs; unknown Best Buy price stops", () => {
  for (const [index, store] of STORES.entries()) {
    const db = new YoinkDatabase();
    try {
      db.run("UPDATE retailers SET execution_supported = 1 WHERE id = ?", store.retailerId);
      const listing = new CatalogRepository(db).upsertListing({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        sourceProductId: `cart-product-${index}`,
        sourceListingId: `cart-listing-${index}`,
        title: `Signal Cart Fixture at ${store.retailerName}`,
        retailerId: store.retailerId,
        retailerSku: store.retailerSku,
        canonicalUrl: store.canonicalUrl,
        listingStatus: "out_of_stock",
        executionSupported: true,
        msrpCents: store.unitPriceCents,
        currency: "USD"
      }, NOW);
      if (["amazon", "target", "walmart", "bestbuy"].includes(store.retailerId)) {
        officialMsrpFixture(db, listing.listing.id, NOW, store.unitPriceCents);
      }
      const control = new ControlRepository(db);
      control.replaceStrategies([], NOW);
      control.createConfiguredMission({
        contractVersion: 1,
        listingId: listing.listing.id,
        officialMsrpEvidenceId: db.get<{ id: string }>("SELECT id FROM official_msrp_evidence WHERE listing_id=? ORDER BY revision DESC LIMIT 1", listing.listing.id)?.id ?? "",
        targetQuantity: 1,
        maxUnitPriceCents: store.unitPriceCents,
        maxAllInCents: store.unitPriceCents + 5_000,
        actionCeiling: "add_to_cart",
        sellerPolicy: "first_party_only",
        fulfillment: "shipping",
        substitutionPolicy: "exact_only",
        cooldownSeconds: 0,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      }, NOW);
      db.run(
        `INSERT INTO retailer_adapter_qualifications(
           tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
           evidence_hash, qualified_at, updated_at, expires_at
         ) VALUES (?, ?, ?, ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)`,
        LOCAL_TENANT_ID,
        LOCAL_USER_ID,
        store.retailerId,
        store.adapterVersion,
        `${store.retailerId}-signal-cart-evidence`,
        new Date(NOW).toISOString(),
        new Date(NOW).toISOString(),
        new Date(NOW + 30 * 24 * 60 * 60_000).toISOString()
      );
      db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");

      const raw = envelope(store, index);
      const signal = trackalackerSignalInput(raw, raw.signalId);
      assert.ok(signal.offer);
      assert.equal(signal.offer.unitPriceCents, store.retailerId === "bestbuy" ? null : store.unitPriceCents);
      assert.equal(signal.offer.sellerType, "unknown");
      assert.equal(signal.offer.fulfillment, "unknown");
      const processed = new SignalEngine(db).process(signal, NOW);
      if (store.retailerId === "bestbuy") {
        assert.notEqual(processed.actionJobState, "awaiting_executor", "missing signal price cannot authorize a cart");
        assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM action_jobs WHERE action='add_to_cart'")?.n, 0);
        continue;
      }
      assert.equal(processed.decision, "qualified", `${store.retailerName} signal decision`);
      assert.equal(processed.actionJobState, "awaiting_executor", `${store.retailerName} job state`);
      assert.match(processed.reason, /Chrome must verify/);

      const stored = db.get<{
        action: string;
        fulfillment: string;
        sellerPolicy: string;
        expectedSeller: string;
        sourceSellerType: string;
        sourceFulfillment: string;
      }>(
        `SELECT job.action, job.fulfillment, job.seller_policy AS sellerPolicy,
                job.expected_seller AS expectedSeller, snapshot.seller_type AS sourceSellerType,
                snapshot.fulfillment AS sourceFulfillment
         FROM action_jobs job JOIN offer_snapshots snapshot ON snapshot.id = job.offer_snapshot_id
         WHERE job.id = ?`,
        processed.actionJobId
      );
      assert.deepEqual({ ...stored }, {
        action: "add_to_cart",
        fulfillment: "shipping",
        sellerPolicy: "first_party_only",
        expectedSeller: "",
        sourceSellerType: "unknown",
        sourceFulfillment: "unknown"
      });

      const devices = new DeviceRepository(db);
      const code = devices.createPairingCode(NOW);
      const paired = devices.pair({
        pairingCode: code.code,
        capabilities: {
          readiness: true,
          jobReconciliation: true, officialMsrpCartV1: true,
          [store.capability]: true,
          [store.versionCapability]: store.adapterVersion
        }
      }, NOW + 1);
      const execution = new ExecutionRepository(db);
      if (["pokemoncenter", "aninebing", "americaneagle"].includes(store.retailerId)) {
        assert.equal(execution.leaseNextJob(paired.id, NOW + 2, ["target"]).reason, "no_jobs");
        db.run("UPDATE action_jobs SET fulfillment = 'pickup' WHERE id = ?", processed.actionJobId);
        assert.equal(execution.leaseNextJob(paired.id, NOW + 2, [store.retailerId]).reason, "no_jobs");
        db.run("UPDATE action_jobs SET fulfillment = 'shipping', quantity = 2 WHERE id = ?", processed.actionJobId);
        assert.equal(execution.leaseNextJob(paired.id, NOW + 2, [store.retailerId]).reason, "no_jobs");
        db.run("UPDATE action_jobs SET quantity = 1 WHERE id = ?", processed.actionJobId);
      }
      const lease = execution.leaseNextJob(paired.id, NOW + 2);
      assert.equal(lease.reason, "leased", `${store.retailerName} lease result`);
      assert.ok(lease.job);
      assert.equal(lease.job.retailerId, store.retailerId);
      assert.equal(lease.job.retailerSku, store.retailerSku);
      assert.equal(lease.job.adapterVersion, store.adapterVersion);
      assert.equal(lease.job.action, "add_to_cart");
      assert.equal(lease.job.quantity, 1);
      assert.equal(lease.job.sellerPolicy, "first_party_only");
      assert.equal(lease.job.fulfillment, "shipping");
      execution.reconcileJob(paired.id, lease.job.id, lease.job.capabilityToken,
        "navigating", "navigation_started", "Navigation started.", {
          retailerId: store.retailerId, retailerSku: store.retailerSku, secret: "DO_NOT_STORE"
        }, NOW + 3);
      const evidence = JSON.parse(db.get<{ evidence_json: string }>(
        "SELECT evidence_json FROM action_events WHERE job_id = ? ORDER BY created_at DESC LIMIT 1", lease.job.id
      )!.evidence_json) as Record<string, unknown>;
      assert.deepEqual(evidence, { retailerId: store.retailerId, retailerSku: store.retailerSku });
      if (store.retailerId === "pokemoncenter") {
        execution.reconcileJob(paired.id, lease.job.id, lease.job.capabilityToken,
          "verifying_listing", "verification_started", "Verification started.", {
            retailerId: store.retailerId, retailerSku: "10-10320-101?private=value"
          }, NOW + 4);
        const invalidEvidence = JSON.parse(db.get<{ evidence_json: string }>(
          "SELECT evidence_json FROM action_events WHERE job_id = ? ORDER BY created_at DESC LIMIT 1", lease.job.id
        )!.evidence_json) as Record<string, unknown>;
        assert.deepEqual(invalidEvidence, { retailerId: "pokemoncenter" });
      }
    } finally {
      db.close();
    }
  }
});
