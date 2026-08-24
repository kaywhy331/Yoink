import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";

test("the signed observer registry distributes only promoted recipes to capable paired devices", async () => {
  const db = new YoinkDatabase();
  const signer = ObserverRecipeSigner.ephemeral();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "0.13.0-test",
    observerRecipeSigner: signer
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"b".repeat(32)}`;
  try {
    const pairing = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    }).then((response) => response.json()) as { pairing: { code: string } };
    const pairedResponse = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({
        pairingCode: pairing.pairing.code,
        extensionVersion: "0.13.0",
        capabilities: { observerRecipeShadow: true }
      })
    });
    assert.equal(pairedResponse.status, 201);
    const paired = (await pairedResponse.json() as { device: { token: string } }).device;
    const proposal = await fetch(`${baseUrl}/api/v1/observer-recipes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: 1,
        retailerId: "amazon",
        recipeVersion: "amazon-api-shadow",
        minimumExtensionVersion: "0.13.0",
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        fields: {
          availability: { mode: "text", selectors: ["#availability"] },
          unitPrice: { mode: "text", selectors: [".a-price .a-offscreen"] }
        },
        provenanceCode: "sanitized_layout_repair",
        confirmation: "PROPOSE_OBSERVER_ONLY_RECIPE"
      })
    });
    assert.equal(proposal.status, 201);
    const recipe = (await proposal.json() as { recipe: { id: string } }).recipe;

    const beforePromotion = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipes/amazon`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    }).then((response) => response.json()) as { recipe: unknown };
    assert.equal(beforePromotion.recipe, null);
    const promoted = await fetch(`${baseUrl}/api/v1/observer-recipes/${encodeURIComponent(recipe.id)}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ targetState: "shadow", confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE" })
    });
    assert.equal(promoted.status, 200);
    const distributed = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipes/amazon`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    }).then((response) => response.json()) as { recipe: Parameters<typeof signer.verify>[0] };
    assert.equal(distributed.recipe.payload.state, "shadow");
    assert.equal(signer.verify(distributed.recipe), true);

    const trialResponse = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipe-trials/amazon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        contractVersion: 1,
        recipeId: recipe.id,
        recipeVersion: "amazon-api-shadow",
        retailerId: "amazon",
        retailerSku: "B002OB49L4",
        observerVersion: "amazon-observer-v6",
        layoutFingerprint: "a".repeat(64),
        outcome: "passed",
        evaluatedFieldCount: 2,
        agreedFieldCount: 2,
        ambiguousFieldCount: 0,
        observedAt: new Date().toISOString(),
        extractedText: "DO_NOT_STORE"
      })
    });
    assert.equal(trialResponse.status, 201);
    assert.equal(JSON.stringify(db.all("SELECT * FROM observer_recipe_trials")).includes("DO_NOT_STORE"), false);
    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      observerRegistry: { mutationCapable: boolean; recipes: Array<Record<string, unknown>> };
    };
    assert.equal(snapshot.counts.activeObserverRecipes, 1);
    assert.equal(snapshot.counts.observerRecipeTrials, 1);
    assert.equal(snapshot.observerRegistry.mutationCapable, false);

    const disabled = await fetch(`${baseUrl}/api/v1/observer-recipes/${encodeURIComponent(recipe.id)}/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ confirmation: "DISABLE_OBSERVER_RECIPE", reasonCode: "api_kill_switch_test" })
    });
    assert.equal(disabled.status, 200);
    const afterDisable = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipes/amazon`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    }).then((response) => response.json()) as { recipe: unknown };
    assert.equal(afterDisable.recipe, null);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
