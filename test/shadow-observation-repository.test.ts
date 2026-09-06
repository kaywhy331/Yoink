import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  RETAILER_OBSERVER_VERSIONS,
  TARGET_OBSERVER_VERSION,
  type RetailerShadowObservationInput,
  type TargetShadowObservationInput
} from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";

const NOW = new Date("2026-08-23T01:00:00.000Z").getTime();

function observation(overrides: Partial<TargetShadowObservationInput> = {}): TargetShadowObservationInput {
  const retailerSku = overrides.retailerSku ?? "1011483414";
  return {
    adapterVersion: TARGET_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: new Date(NOW).toISOString(),
    pageKind: "product",
    retailerId: "target",
    retailerSku,
    availability: "in_stock",
    unitPriceCents: 5999,
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: "",
    selectedOffer: {
      schemaVersion: 1,
      selectionState: "exact",
      childOfferKey: retailerSku,
      attributes: {}
    },
    ...overrides
  };
}

function pairedDevice(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  return devices.pair({ pairingCode: code.code }, NOW + 1_000);
}

test("a paired device records only normalized Target shadow evidence", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new ShadowObservationRepository(db);
    const input = {
      ...observation({
        observedAt: new Date(NOW + 1_000).toISOString(),
        selectedOffer: {
          schemaVersion: 1,
          selectionState: "exact",
          childOfferKey: "1011483414",
          attributes: { color: "  RED  " }
        }
      }),
      url: "https://www.target.com/p/-/A-1011483414?secret=DO_NOT_STORE",
      cookie: "DO_NOT_STORE",
      pageText: "DO_NOT_STORE"
    };
    const stored = repository.record(device.id, input, NOW + 2_000);
    assert.equal(stored.observationState, "actionable_candidate");
    assert.equal(stored.canonicalUrl, "https://www.target.com/p/-/A-1011483414");
    assert.match(stored.evidenceHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(stored.selectedOffer.attributes, { color: "red" });
    assert.equal(stored.selectedOffer.selectionState, "exact");
    assert.match(stored.selectedOffer.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(repository.count(), 1);
    const durable = JSON.stringify(db.all("SELECT * FROM retailer_shadow_observations"));
    assert.equal(durable.includes("DO_NOT_STORE"), false);
    assert.equal(durable.includes(device.token), false);
  } finally {
    db.close();
  }
});

test("Target shadow evidence rejects stale, malformed, and unpaired input", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new ShadowObservationRepository(db);
    assert.throws(() => repository.record(device.id, observation({ retailerSku: "not-a-tcin" }), NOW + 2_000), /TCIN/);
    assert.throws(() => repository.record(device.id, observation({ observedAt: new Date(NOW - 11 * 60_000).toISOString() }), NOW), /stale/);
    assert.throws(() => repository.record("device_missing", observation(), NOW), /unavailable/);
    assert.throws(() => repository.record(device.id, observation({ sellerName: "", sellerType: "third_party" }), NOW), /identified/);
    assert.throws(() => repository.record(device.id, observation({
      selectedOffer: {
        schemaVersion: 1,
        selectionState: "exact",
        childOfferKey: "9999999999",
        attributes: {}
      }
    }), NOW), /child offer/);
    assert.throws(() => repository.record(device.id, observation({
      selectedOffer: {
        schemaVersion: 1,
        selectionState: "exact",
        childOfferKey: "1011483414",
        attributes: { offerToken: "DO_NOT_STORE" } as never
      }
    }), NOW), /unsupported variant/);
    assert.equal(repository.count(), 0);
  } finally {
    db.close();
  }
});

test("Amazon observations share the sanitized ledger and remain independently qualification-gated", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new ShadowObservationRepository(db);
    const stored = repository.record(device.id, {
      adapterVersion: AMAZON_OBSERVER_VERSION,
      contractVersion: 1,
      observedAt: new Date(NOW + 1_000).toISOString(),
      pageKind: "product",
      retailerId: "amazon",
      retailerSku: "B0GYTRYV7P",
      availability: "in_stock",
      unitPriceCents: 2186,
      currency: "USD",
      sellerName: "Amazon.com",
      sellerType: "first_party",
      fulfillment: "shipping",
      addControlActionable: true,
      securityChallenge: false,
      interactiveBlock: "",
      purchaseRouteKind: "amazon_buy_now",
      purchaseRouteReady: true,
      routeReasonCode: "offer_route_verified"
    }, NOW + 2_000);
    assert.equal(stored.retailerId, "amazon");
    assert.equal(stored.canonicalUrl, "https://www.amazon.com/dp/B0GYTRYV7P");
    assert.equal(stored.observationState, "actionable_candidate");
    assert.equal(stored.purchaseRouteReady, true);
    assert.equal(stored.routeReasonCode, "offer_route_verified");
    assert.equal(repository.listRecent()[0]?.retailerId, "amazon");
    const readiness = repository.retailerEvidenceReadiness(NOW + 3_000);
    assert.equal(readiness.find((item) => item.retailerId === "amazon")?.actionableCandidateCount, 1);
    assert.equal(readiness.find((item) => item.retailerId === "amazon")?.distinctSkuCount, 1);
    assert.equal(readiness.find((item) => item.retailerId === "amazon")?.purchaseRouteReadyCount, 1);
    assert.equal(readiness.find((item) => item.retailerId === "walmart")?.observationCount, 0);
    assert.equal(readiness.find((item) => item.retailerId === "target")?.mode, "guarded_add");
    assert.equal(readiness.find((item) => item.retailerId === "amazon")?.mode, "guarded_add");
    assert.equal(readiness.find((item) => item.retailerId === "bestbuy")?.mode, "guarded_add");
    assert.equal(repository.bestBuyQualificationReadiness(NOW + 3_000).liveEvidenceReady, false);
    assert.equal(repository.amazonQualificationReadiness(NOW + 3_000).liveEvidenceReady, false);
    assert.equal(repository.targetQualificationReadiness(NOW + 3_000).observationCount, 0);
    assert.deepEqual(repository.qualificationCandidates(NOW + 3_000).map((candidate) => ({
      retailerId: candidate.retailerId,
      retailerSku: candidate.retailerSku,
      fulfillment: candidate.fulfillment,
      rehearsalPassed: candidate.rehearsalPassed
    })), [{
      retailerId: "amazon",
      retailerSku: "B0GYTRYV7P",
      fulfillment: "shipping",
      rehearsalPassed: false
    }]);
    assert.throws(() => repository.record(device.id, {
      ...stored,
      adapterVersion: TARGET_OBSERVER_VERSION,
      observedAt: new Date(NOW + 2_000).toISOString()
    }, NOW + 3_000), /contract version/);
  } finally {
    db.close();
  }
});

test("nine additional retailers store sanitized read-only evidence and never inherit execution", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new ShadowObservationRepository(db);
    const examples = [
      ["disney", "409914998395", "https://www.disneystore.com/dumbo-409914998395.html?CMP=secret", "Disney Store", "first_party"],
      ["ravensburger", "22893", "https://www.ravensburger.us/en-US/products/games/oh-my-pigeons-22893?tracking=secret", "Ravensburger", "first_party"],
      ["riot", "RIFTBOUND-UNLEASHED-VAULT", "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/?tracking=secret", "Riot Games Merch", "first_party"],
      ["booksamillion", "F019649505470", "https://www.booksamillion.com/p/-/F019649505470?tracking=secret", "Books-A-Million", "first_party"],
      ["fanatics", "350174258", "https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803?tracking=secret", "Fanatics", "first_party"],
      ["kohls", "3384298", "https://www.kohls.com/product/prd-3384298/product.jsp?tracking=secret", "Kohl's", "first_party"],
      ["macys", "16569610", "https://www.macys.com/shop/product/example?ID=16569610&tracking=secret", "GAP", "third_party"],
      ["pbandai", "N2884150001", "https://p-bandai.com/us/item/N2884150001?tracking=secret", "Premium Bandai", "first_party"],
      ["pokemoncenter", "10-10320-101", "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder?tracking=secret", "Pokémon Center", "first_party"]
    ] as const;
    examples.forEach(([retailerId, retailerSku, canonicalUrl, sellerName, sellerType], index) => {
      const input: RetailerShadowObservationInput = {
        adapterVersion: RETAILER_OBSERVER_VERSIONS[retailerId],
        contractVersion: 1,
        observedAt: new Date(NOW + 1_000 + index).toISOString(),
        pageKind: "product",
        retailerId,
        retailerSku,
        canonicalUrl,
        availability: "in_stock",
        unitPriceCents: 1999 + index,
        currency: "USD",
        sellerName,
        sellerType,
        fulfillment: "shipping",
        addControlActionable: true,
        securityChallenge: false,
        interactiveBlock: "",
        purchaseRouteKind: "none",
        purchaseRouteReady: false,
        routeReasonCode: "not_applicable"
      };
      const stored = repository.record(device.id, input, NOW + 2_000 + index);
      assert.equal(stored.retailerId, retailerId);
      assert.equal(stored.observationState, "actionable_candidate");
      assert.equal(stored.canonicalUrl.includes("tracking"), false);
    });
    const readiness = repository.retailerEvidenceReadiness(NOW + 3_000);
    for (const [retailerId] of examples) {
      assert.equal(readiness.find((item) => item.retailerId === retailerId)?.mode, retailerId === "pokemoncenter" ? "guarded_add" : "read_only");
      assert.equal(readiness.find((item) => item.retailerId === retailerId)?.observationCount, 1);
      assert.equal(db.get<{ execution_supported: number }>(
        "SELECT execution_supported FROM retailers WHERE id = ?", retailerId
      )?.execution_supported, 0);
    }
    assert.equal(JSON.stringify(db.all("SELECT canonical_url FROM retailer_shadow_observations")).includes("secret"), false);
  } finally {
    db.close();
  }
});

test("Target qualification readiness requires diverse live evidence and never self-qualifies", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const repository = new ShadowObservationRepository(db);
    const empty = repository.targetQualificationReadiness(NOW);
    assert.equal(empty.liveEvidenceReady, false);
    assert.equal(empty.addToCartQualified, false);
    assert.equal(empty.mutationAuthorized, false);
    assert.equal(empty.liveEvidenceHash, "");

    repository.record(device.id, observation({
      retailerSku: "111111111",
      observedAt: new Date(NOW + 1_000).toISOString(),
      fulfillment: "shipping"
    }), NOW + 2_000);
    repository.record(device.id, observation({
      retailerSku: "222222222",
      observedAt: new Date(NOW + 3_000).toISOString(),
      sellerName: "Fixture Marketplace Seller",
      sellerType: "third_party",
      fulfillment: "pickup"
    }), NOW + 4_000);
    repository.record(device.id, observation({
      retailerSku: "333333333",
      observedAt: new Date(NOW + 5_000).toISOString(),
      availability: "out_of_stock",
      unitPriceCents: null,
      sellerName: "",
      sellerType: "unknown",
      fulfillment: "unknown",
      addControlActionable: false
    }), NOW + 6_000);

    const readiness = repository.targetQualificationReadiness(NOW + 7_000);
    assert.equal(readiness.liveEvidenceReady, true);
    assert.equal(readiness.rehearsalReady, false);
    assert.equal(readiness.qualificationEvidenceReady, false);
    assert.equal(readiness.observationCount, 3);
    assert.equal(readiness.distinctSkuCount, 3);
    assert.equal(readiness.checks.filter((check) => check.id !== "pre_click_rehearsal").every((check) => check.met), true);
    assert.equal(readiness.checks.find((check) => check.id === "pre_click_rehearsal")?.met, false);
    const firstPartyProducts = readiness.checks.find((check) => check.id === "first_party_actionable")?.products || [];
    assert.deepEqual(firstPartyProducts.map((product) => [product.retailerSku, product.status]), [
      ["333333333", "did_not_pass"],
      ["222222222", "did_not_pass"],
      ["111111111", "passed"]
    ]);
    assert.equal(firstPartyProducts[2]?.canonicalUrl, "https://www.target.com/p/-/A-111111111");
    const diversityProducts = readiness.checks.find((check) => check.id === "sku_diversity")?.products || [];
    assert.equal(diversityProducts.length, 3);
    assert.equal(diversityProducts.every((product) => product.status === "passed"), true);
    assert.match(readiness.liveEvidenceHash, /^[a-f0-9]{64}$/);
    assert.equal(readiness.qualification, null);
    assert.equal(readiness.addToCartQualified, false);
    assert.equal(readiness.mutationAuthorized, false);
    assert.match(readiness.nextStep, /mutation-disabled/);
    assert.equal(Number(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM retailer_adapter_qualifications WHERE retailer_id = 'target'"
    )?.count ?? 0), 0);
    const candidate = repository.qualificationCandidates(NOW + 7_000).find((item) => item.retailerId === "target");
    assert.equal(candidate?.retailerSku, "111111111");
    assert.equal(candidate?.canonicalUrl, "https://www.target.com/p/-/A-111111111");
    assert.equal(candidate?.fulfillment, "shipping");
  } finally {
    db.close();
  }
});
