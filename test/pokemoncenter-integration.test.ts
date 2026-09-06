import assert from "node:assert/strict";
import test from "node:test";
import { POKEMONCENTER_ADD_ADAPTER_VERSION, POKEMONCENTER_ADD_ACTIVATION_CONFIRMATION, POKEMONCENTER_OBSERVER_VERSION,
  POKEMONCENTER_SELECTOR_PACK_VERSION, type RetailerShadowObservationInput } from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { QualificationRepository } from "../packages/database/src/qualification-repository.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";

const NOW = Date.parse("2026-09-06T01:00:00Z");

test("Pokémon Center has independent evidence, activation and device capability gates", () => {
  const db = new YoinkDatabase();
  try {
    const devices = new DeviceRepository(db);
    const device = devices.pair({ pairingCode: devices.createPairingCode(NOW).code,
      capabilities: { readiness: true, jobReconciliation: true, pokemonCenterAddOnly: true,
        pokemonCenterAddAdapterVersion: POKEMONCENTER_ADD_ADAPTER_VERSION } }, NOW + 1);
    const shadows = new ShadowObservationRepository(db);
    const qualifications = new QualificationRepository(db);
    const activation = { adapterVersion: POKEMONCENTER_ADD_ADAPTER_VERSION, evidenceHash: "0".repeat(64),
      confirmation: POKEMONCENTER_ADD_ACTIVATION_CONFIRMATION } as const;
    assert.equal(qualifications.addQualified("pokemoncenter", NOW), false);
    assert.throws(() => qualifications.activateAdd("pokemoncenter", activation, NOW + 2), /incomplete/);
    const observations = ["10-10320-101", "71-10304-101"].map((sku, index) => shadows.record(device.id, {
      adapterVersion: POKEMONCENTER_OBSERVER_VERSION, contractVersion: 1,
      observedAt: new Date(NOW + 3 + index).toISOString(), pageKind: "product", retailerId: "pokemoncenter",
      retailerSku: sku, canonicalUrl: `https://www.pokemoncenter.com/product/${sku}/fixture`,
      availability: "in_stock", unitPriceCents: 2999, currency: "USD", sellerName: "Pokémon Center",
      sellerType: "first_party", fulfillment: "shipping", addControlActionable: true,
      securityChallenge: false, interactiveBlock: ""
    } satisfies RetailerShadowObservationInput, NOW + 3 + index));
    assert.equal(shadows.pokemonCenterQualificationReadiness(NOW + 5).liveEvidenceReady, true);
    assert.equal(shadows.pokemonCenterQualificationReadiness(NOW + 5).qualificationEvidenceReady, false);
    const trial = qualifications.recordAddRehearsal("pokemoncenter", device.id, {
      adapterVersion: POKEMONCENTER_ADD_ADAPTER_VERSION, observerVersion: POKEMONCENTER_OBSERVER_VERSION,
      packVersion: POKEMONCENTER_SELECTOR_PACK_VERSION, contractVersion: 1,
      shadowObservationId: observations[0]!.id, observedAt: new Date(NOW + 6).toISOString(), outcome: "passed", reasonCode: "verified"
    }, NOW + 7);
    assert.equal(trial.retailerId, "pokemoncenter");
    const ready = shadows.pokemonCenterQualificationReadiness(NOW + 8);
    assert.equal(ready.qualificationEvidenceReady, true);
    assert.equal(ready.addToCartQualified, false);
    assert.equal(shadows.bestBuyQualificationReadiness(NOW + 8).qualificationEvidenceReady, false);
    assert.throws(() => qualifications.activateAdd("pokemoncenter", activation, NOW + 8), /changed or is incomplete/);
    const result = qualifications.activateAdd("pokemoncenter", { ...activation, evidenceHash: ready.qualificationEvidenceHash }, NOW + 9);
    assert.equal(result.readiness.retailerId, "pokemoncenter");
    assert.equal(result.readiness.addToCartQualified, true);
    assert.equal(result.readiness.mutationAuthorized, false);
    assert.equal(qualifications.addQualified("bestbuy", NOW + 10), false);
    assert.equal(qualifications.addQualified("pokemoncenter", NOW + 10), true);
    assert.equal(new RetailerReadinessRepository(db).lanes(NOW + 10).find(lane => lane.retailerId === "pokemoncenter")?.evidence.rehearsalReady, true);
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM retailers WHERE id = 'pokemoncenter'")?.execution_supported, 1);
  } finally { db.close(); }
});
