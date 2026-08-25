import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import { ObserverRecipeTrustAuthority } from "../packages/observer-registry/src/trust.js";
import {
  ObserverRecipeWitnessVerifier,
  createObserverRecipeWitnessReceipt,
  type ObserverRecipeWitnessPublisher
} from "../packages/observer-registry/src/witness.js";

test("hosted observer recipe delivery requires the current independently witnessed transparency tip", async () => {
  const db = new YoinkDatabase();
  const trust = ObserverRecipeTrustAuthority.ephemeral();
  const signer = ObserverRecipeSigner.ephemeral();
  let witnessSequence = 0;
  const publisher: ObserverRecipeWitnessPublisher = {
    verifier: new ObserverRecipeWitnessVerifier("yoink-hosted", {
      algorithm: "Ed25519",
      keyId: signer.keyId,
      publicKeySpki: signer.publicKeySpki
    }, 600),
    endpointOrigin: "https://witness.example.net",
    async publish(checkpoint, previousReceiptHash) {
      const now = Date.now();
      witnessSequence += 1;
      return createObserverRecipeWitnessReceipt(signer, {
        checkpoint,
        witnessSequence,
        previousReceiptHash,
        witnessedAt: new Date(now - 1_000).toISOString(),
        validUntil: new Date(now + 60 * 60_000).toISOString()
      });
    }
  };
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "0.27.0-test",
    observerRecipeTrust: trust,
    observerRecipeWitness: publisher,
    observerRecipeWitnessRequired: true
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"c".repeat(32)}`;
  try {
    const pairing = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    }).then((response) => response.json()) as { pairing: { code: string } };
    const paired = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({
        pairingCode: pairing.pairing.code,
        extensionVersion: "0.27.0",
        capabilities: { observerRecipeShadow: true }
      })
    }).then((response) => response.json()) as { device: { token: string } };
    const manifest = trust.manifest()?.manifest;
    assert.ok(manifest);
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/observer-recipes/trust-manifests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ manifest, confirmation: "INSTALL_ROOTED_OBSERVER_RECIPE_TRUST_MANIFEST" })
    })).status, 201);
    const proposedResponse = await fetch(`${baseUrl}/api/v1/admin/observer-recipes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: 1,
        retailerId: "amazon",
        recipeVersion: "amazon-witness-api",
        minimumExtensionVersion: "0.27.0",
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        fields: { availability: { mode: "text", selectors: ["#availability"] } },
        provenanceCode: "sanitized_layout_repair",
        confirmation: "PROPOSE_OBSERVER_ONLY_RECIPE"
      })
    });
    assert.equal(proposedResponse.status, 201);
    const proposed = await proposedResponse.json() as { recipe: { id: string } };
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/observer-recipes/${encodeURIComponent(proposed.recipe.id)}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ targetState: "shadow", confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE" })
    })).status, 200);

    const blocked = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipes/amazon`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.device.token}` }
    });
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json() as { error: string }).error, "observer_recipe_witness_required");

    const witnessed = await fetch(`${baseUrl}/api/v1/admin/observer-recipes/witness/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ confirmation: "PUBLISH_OBSERVER_RECIPE_CHECKPOINT" })
    });
    assert.equal(witnessed.status, 201);
    const witnessStatus = (await witnessed.json() as { witness: Record<string, unknown> }).witness;
    assert.equal(witnessStatus.state, "healthy");
    assert.equal(witnessStatus.deliveryAllowed, true);

    const delivered = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipes/amazon`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.device.token}` }
    });
    assert.equal(delivered.status, 200);
    assert.equal((await delivered.json() as { recipe: { payload: { recipeId: string } } }).recipe.payload.recipeId, proposed.recipe.id);
    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(health.observerRecipeWitnessRequired, true);
    assert.equal(health.observerRecipeWitnessHealthy, true);
    assert.equal(health.durableObserverRecipeWitnessRefresh, true);
    assert.equal(health.observerRecipeWitnessRefreshConfigured, true);
    assert.equal(health.standaloneWitnessRefreshLoadsSigningKeys, false);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
