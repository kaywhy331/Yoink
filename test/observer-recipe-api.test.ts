import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { ObserverRecipeTrustAuthority } from "../packages/observer-registry/src/trust.js";

test("the signed observer registry distributes only promoted recipes to capable paired devices", async () => {
  const db = new YoinkDatabase();
  const trust = ObserverRecipeTrustAuthority.ephemeral();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "0.13.0-test",
    observerRecipeTrust: trust
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
        capabilities: { observerRecipeShadow: true, observerRecipePackagedOracle: true }
      })
    });
    assert.equal(pairedResponse.status, 201);
    const paired = (await pairedResponse.json() as { device: { token: string } }).device;
    const manifest = trust.manifest()?.manifest;
    assert.ok(manifest);
    const installedTrust = await fetch(`${baseUrl}/api/v1/observer-recipes/trust-manifests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        manifest,
        confirmation: "INSTALL_ROOTED_OBSERVER_RECIPE_TRUST_MANIFEST"
      })
    });
    assert.equal(installedTrust.status, 201);
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
    }).then((response) => response.json()) as {
      trust: { rootKeyId: string; manifestHash: string };
      recipe: Parameters<typeof trust.intermediateSigner.verify>[0];
    };
    assert.equal(distributed.trust.rootKeyId, trust.root.keyId);
    assert.match(distributed.trust.manifestHash, /^[a-f0-9]{64}$/);
    assert.equal(distributed.recipe.payload.state, "shadow");
    assert.equal(trust.intermediateSigner.verify(distributed.recipe), true);

    const trialResponse = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipe-trials/amazon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        contractVersion: 2,
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
        validationProfile: "packaged_structured_oracle_v1",
        oracleEvaluatedFieldCount: 2,
        oracleAgreedFieldCount: 2,
        oracleConflictFieldCount: 0,
        packagedMissingFieldCount: 0,
        packagedConflictFieldCount: 0,
        insufficientFieldCount: 0,
        fieldOutcomes: ["availability", "unitPrice"].map((field) => ({
          field,
          recipeState: "value",
          packagedState: "agreed",
          oracleState: "agreed",
          disposition: "verified"
        })),
        observedAt: new Date().toISOString(),
        recipeStateAtTrial: "trusted_read_only",
        extractedText: "DO_NOT_STORE"
      })
    });
    assert.equal(trialResponse.status, 201);
    assert.equal(JSON.stringify(db.all("SELECT * FROM observer_recipe_trials")).includes("DO_NOT_STORE"), false);
    assert.equal(db.get<{ state: string }>(
      "SELECT recipe_state_at_trial AS state FROM observer_recipe_trials WHERE recipe_id = ?",
      recipe.id
    )?.state, "shadow");
    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      observerRegistry: {
        mutationCapable: boolean;
        trialQuorumPolicy: string;
        canaryCohortPercent: number;
        canaryMinimumDurationHours: number;
        canaryRegressionAutoKill: boolean;
        publicIndependentAccountQuorum: boolean;
        recipeFieldFill: boolean;
        recipes: Array<Record<string, unknown>>;
      };
    };
    assert.equal(snapshot.counts.activeObserverRecipes, 1);
    assert.equal(snapshot.counts.observerRecipeTrials, 1);
    assert.equal(snapshot.counts.packagedOracleObserverRecipeTrials, 1);
    assert.equal(snapshot.counts.oracleCompleteObserverRecipeTrials, 1);
    assert.equal(snapshot.counts.autoDisabledObserverRecipesByCanaryRegression, 0);
    assert.equal(snapshot.observerRegistry.mutationCapable, false);
    assert.equal(snapshot.observerRegistry.trialQuorumPolicy, "latest_per_contributor_sku_layout_stage");
    assert.equal(snapshot.observerRegistry.canaryCohortPercent, 25);
    assert.equal(snapshot.observerRegistry.canaryMinimumDurationHours, 24);
    assert.equal(snapshot.observerRegistry.canaryRegressionAutoKill, true);
    assert.equal(snapshot.observerRegistry.publicIndependentAccountQuorum, false);
    assert.equal(snapshot.observerRegistry.recipeFieldFill, false);

    const conflictResponse = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipe-trials/amazon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        contractVersion: 2,
        recipeId: recipe.id,
        recipeVersion: "amazon-api-shadow",
        retailerId: "amazon",
        retailerSku: "B0DCGQ6CJD",
        observerVersion: "amazon-observer-v6",
        layoutFingerprint: "b".repeat(64),
        outcome: "failed",
        evaluatedFieldCount: 2,
        agreedFieldCount: 1,
        ambiguousFieldCount: 0,
        validationProfile: "packaged_structured_oracle_v1",
        oracleEvaluatedFieldCount: 1,
        oracleAgreedFieldCount: 1,
        oracleConflictFieldCount: 0,
        packagedMissingFieldCount: 0,
        packagedConflictFieldCount: 1,
        insufficientFieldCount: 0,
        fieldOutcomes: [{
          field: "availability",
          recipeState: "value",
          packagedState: "agreed",
          oracleState: "agreed",
          disposition: "verified"
        }, {
          field: "unitPrice",
          recipeState: "value",
          packagedState: "conflict",
          oracleState: "not_evaluated",
          disposition: "conflict"
        }],
        observedAt: new Date().toISOString()
      })
    });
    assert.equal(conflictResponse.status, 201);
    assert.equal((await conflictResponse.json() as { trial: { autoDisabled: boolean } }).trial.autoDisabled, true);
    const afterConflict = await fetch(`${baseUrl}/api/v1/devices/self/observer-recipes/amazon`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    }).then((response) => response.json()) as { recipe: unknown };
    assert.equal(afterConflict.recipe, null);
    const conflictSnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
    };
    assert.equal(conflictSnapshot.counts.packagedConflictObserverRecipeTrials, 1);
    assert.equal(conflictSnapshot.counts.autoDisabledObserverRecipesByPackagedConflict, 1);

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
