import assert from "node:assert/strict";
import test from "node:test";
import {
  OBSERVER_RECIPE_CONTRACT_VERSION,
  type ObserverRecipeProposalInput
} from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { ObserverRecipeRepository } from "../packages/database/src/observer-recipe-repository.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import { ObserverRecipeTrustAuthority } from "../packages/observer-registry/src/trust.js";
import {
  ObserverRecipeWitnessVerifier,
  createObserverRecipeWitnessReceipt
} from "../packages/observer-registry/src/witness.js";

const NOW = new Date("2026-08-24T21:00:00.000Z").getTime();

function proposal(): ObserverRecipeProposalInput {
  return {
    contractVersion: OBSERVER_RECIPE_CONTRACT_VERSION,
    retailerId: "amazon",
    recipeVersion: "amazon-witness-test",
    minimumExtensionVersion: "0.27.0",
    expiresAt: new Date(NOW + 24 * 60 * 60_000).toISOString(),
    fields: { availability: { mode: "text", selectors: ["#availability"] } },
    provenanceCode: "sanitized_layout_repair",
    confirmation: "PROPOSE_OBSERVER_ONLY_RECIPE"
  };
}

test("witness receipts pin each transparency tip and hosted delivery closes on an unwitnessed or stale tip", () => {
  const db = new YoinkDatabase();
  try {
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const witnessSigner = ObserverRecipeSigner.ephemeral();
    const verifier = new ObserverRecipeWitnessVerifier("yoink-hosted", {
      algorithm: "Ed25519",
      keyId: witnessSigner.keyId,
      publicKeySpki: witnessSigner.publicKeySpki
    }, 600);
    const repository = new ObserverRecipeRepository(db, trust, {
      witnessVerifier: verifier,
      witnessRequired: true,
      witnessEndpointOrigin: "https://witness.example.net"
    });
    const manifest = trust.manifest()?.manifest;
    assert.ok(manifest);
    repository.installTrustManifest({
      manifest,
      confirmation: "INSTALL_ROOTED_OBSERVER_RECIPE_TRUST_MANIFEST"
    }, NOW + 1_000);

    const pending = repository.witnessStatus(NOW + 2_000) as Record<string, unknown>;
    assert.equal(pending.state, "witness_pending");
    assert.equal(pending.deliveryAllowed, false);
    const firstCheckpoint = repository.witnessCheckpoint();
    assert.ok(firstCheckpoint);
    const first = createObserverRecipeWitnessReceipt(witnessSigner, {
      checkpoint: firstCheckpoint,
      witnessSequence: 1,
      previousReceiptHash: "",
      witnessedAt: new Date(NOW + 2_000).toISOString(),
      validUntil: new Date(NOW + 60 * 60_000).toISOString()
    });
    const firstStatus = repository.acceptWitnessReceipt(first, NOW + 3_000);
    assert.equal(firstStatus.state, "healthy");
    assert.equal(firstStatus.deliveryAllowed, true);
    assert.equal(repository.previousWitnessReceiptHash().length, 64);

    const candidate = repository.propose(proposal(), NOW + 4_000);
    repository.promote(String(candidate.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 5_000);
    assert.equal(repository.witnessStatus(NOW + 6_000).state, "witness_pending");
    assert.equal(repository.witnessStatus(NOW + 6_000).deliveryAllowed, false);
    const secondCheckpoint = repository.witnessCheckpoint();
    assert.ok(secondCheckpoint);
    assert.notEqual(secondCheckpoint.transparencyEventHash, firstCheckpoint.transparencyEventHash);
    const previousReceiptHash = repository.previousWitnessReceiptHash();
    const second = createObserverRecipeWitnessReceipt(witnessSigner, {
      checkpoint: secondCheckpoint,
      witnessSequence: 2,
      previousReceiptHash,
      witnessedAt: new Date(NOW + 6_000).toISOString(),
      validUntil: new Date(NOW + 60 * 60_000).toISOString()
    });
    repository.acceptWitnessReceipt(second, NOW + 7_000);
    assert.equal(repository.witnessStatus(NOW + 8_000).state, "healthy");
    assert.equal(repository.counts(NOW + 8_000).observerRecipeWitnessReceipts, 2);
    assert.equal(repository.counts(NOW + 8_000).observerRecipeWitnessChecks, 2);

    repository.recordWitnessFailure("unavailable", NOW + 9_000);
    const degraded = repository.witnessStatus(NOW + 10_000);
    assert.equal(degraded.state, "degraded");
    assert.equal(degraded.deliveryAllowed, true);
    assert.equal(degraded.failedWitnessCheckCount, 1);
    const stale = repository.witnessStatus(NOW + 607_001);
    assert.equal(stale.state, "stale");
    assert.equal(stale.deliveryAllowed, false);

    assert.throws(() => db.run(
      "UPDATE observer_recipe_witness_receipts SET valid_until = ? WHERE receipt_hash = ?",
      new Date(NOW + 2 * 60 * 60_000).toISOString(),
      repository.previousWitnessReceiptHash()
    ), /append-only/);
    assert.throws(() => db.run("DELETE FROM observer_recipe_witness_checks"), /append-only/);
  } finally {
    db.close();
  }
});
