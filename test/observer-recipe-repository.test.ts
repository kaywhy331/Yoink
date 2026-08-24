import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  OBSERVER_RECIPE_CONTRACT_VERSION,
  type ObserverRecipeProposalInput,
  type ObserverRecipeTrialInput
} from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ObserverRecipeRepository } from "../packages/database/src/observer-recipe-repository.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";

const NOW = new Date("2026-08-24T05:00:00.000Z").getTime();

function proposal(version = "amazon-layout-1", rollbackRecipeId = ""): ObserverRecipeProposalInput {
  return {
    contractVersion: OBSERVER_RECIPE_CONTRACT_VERSION,
    retailerId: "amazon",
    recipeVersion: version,
    minimumExtensionVersion: "0.13.0",
    expiresAt: new Date(NOW + 7 * 24 * 60 * 60_000).toISOString(),
    ...(rollbackRecipeId ? { rollbackRecipeId } : {}),
    fields: {
      availability: { mode: "text", selectors: ["#availability", "[data-testid=availability]"] },
      unitPrice: { mode: "text", selectors: [".a-price .a-offscreen"] },
      seller: { mode: "text", selectors: ["#merchant-info"] },
      fulfillment: { mode: "text", selectors: ["#deliveryBlockMessage"] },
      addControl: { mode: "disabled_state", selectors: ["#add-to-cart-button"] }
    },
    provenanceCode: "sanitized_layout_repair",
    confirmation: "PROPOSE_OBSERVER_ONLY_RECIPE"
  };
}

function device(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  return devices.pair({
    pairingCode: code.code,
    extensionVersion: "0.13.0",
    capabilities: { observerRecipeShadow: true }
  }, NOW + 1_000);
}

function trial(
  recipeId: string,
  recipeVersion: string,
  sku: string,
  observedAt: number,
  layout = "a".repeat(64),
  outcome: "passed" | "failed" = "passed"
): ObserverRecipeTrialInput {
  return {
    contractVersion: OBSERVER_RECIPE_CONTRACT_VERSION,
    recipeId,
    recipeVersion,
    retailerId: "amazon",
    retailerSku: sku,
    observerVersion: AMAZON_OBSERVER_VERSION,
    layoutFingerprint: layout,
    outcome,
    evaluatedFieldCount: 5,
    agreedFieldCount: outcome === "passed" ? 5 : 3,
    ambiguousFieldCount: outcome === "passed" ? 0 : 1,
    observedAt: new Date(observedAt).toISOString()
  };
}

test("observer recipes advance only through signed, measured, observer-only lifecycle stages", () => {
  const db = new YoinkDatabase();
  try {
    const paired = device(db);
    const signer = ObserverRecipeSigner.ephemeral();
    const repository = new ObserverRecipeRepository(db, signer);
    const created = repository.propose(proposal(), NOW + 2_000);
    assert.equal(created.lifecycleState, "quarantined");
    assert.equal(repository.active("amazon", NOW + 3_000), null);
    assert.throws(() => repository.promote(String(created.id), {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000), /advance through/);

    const shadow = repository.promote(String(created.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);
    assert.equal(shadow.lifecycleState, "shadow");
    const envelope = repository.active("amazon", NOW + 4_000);
    assert.ok(envelope);
    assert.equal(signer.verify(envelope), true);
    assert.equal(envelope.payload.fields.unitPrice?.selectors[0], ".a-price .a-offscreen");
    assert.equal("script" in envelope.payload, false);
    assert.throws(() => repository.promote(String(created.id), {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 4_000), /two passing/);

    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B002OB49L4", NOW + 5_000), NOW + 6_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B0DCGQ6CJD", NOW + 7_000), NOW + 8_000);
    assert.equal(repository.promote(String(created.id), {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 9_000).lifecycleState, "canary");

    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B0F2BDXW4J", NOW + 10_000, "b".repeat(64)), NOW + 11_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B002OB49L4", NOW + 12_000, "b".repeat(64)), NOW + 13_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B0DCGQ6CJD", NOW + 14_000, "b".repeat(64)), NOW + 15_000);
    const trusted = repository.promote(String(created.id), {
      targetState: "trusted_read_only",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 16_000);
    assert.equal(trusted.lifecycleState, "trusted_read_only");
    assert.deepEqual(trusted.trials, { passed: 5, failed: 0, distinctSkus: 3, distinctLayouts: 2 });
    assert.equal(repository.active("amazon", NOW + 17_000)?.payload.state, "trusted_read_only");
    assert.equal(repository.counts(NOW + 17_000).activeObserverRecipes, 1);
  } finally {
    db.close();
  }
});

test("the recipe schema rejects code, XPath, credential selectors, mutation selectors, arbitrary fields, and long expiry", () => {
  const db = new YoinkDatabase();
  try {
    const repository = new ObserverRecipeRepository(db, ObserverRecipeSigner.ephemeral());
    for (const fields of [
      { availability: { mode: "text", selectors: ["//div[@id='availability']"] } },
      { seller: { mode: "text", selectors: ["input[name=password]"] } },
      { addControl: { mode: "presence", selectors: ["#place-order"] } },
      { sku: { mode: "text", selectors: ["#asin"] } },
      { availability: { mode: "text", selectors: ["#availability"], script: "return document.body" } }
    ]) {
      assert.throws(() => repository.propose({ ...proposal(), fields } as never, NOW + 2_000), /selector|fields|schema|definition/);
    }
    assert.throws(() => repository.propose({
      ...proposal(),
      expiresAt: new Date(NOW + 31 * 24 * 60 * 60_000).toISOString()
    }, NOW + 2_000), /30 days/);
    assert.equal(repository.list().length, 0);
  } finally {
    db.close();
  }
});

test("any failed shadow trial blocks promotion and the kill switch immediately removes distribution", () => {
  const db = new YoinkDatabase();
  try {
    const paired = device(db);
    const repository = new ObserverRecipeRepository(db, ObserverRecipeSigner.ephemeral());
    const created = repository.propose(proposal("amazon-layout-failure"), NOW + 2_000);
    repository.promote(String(created.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-failure", "B002OB49L4", NOW + 4_000, "a".repeat(64), "failed"), NOW + 5_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-failure", "B0DCGQ6CJD", NOW + 6_000), NOW + 7_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-failure", "B0F2BDXW4J", NOW + 8_000), NOW + 9_000);
    assert.throws(() => repository.promote(String(created.id), {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 10_000), /no failures/);
    const disabled = repository.disable(String(created.id), "observed_false_positive", NOW + 11_000);
    assert.equal(disabled.lifecycleState, "disabled");
    assert.equal(disabled.killSwitch, true);
    assert.equal(repository.active("amazon", NOW + 12_000), null);
  } finally {
    db.close();
  }
});

test("explicit rollback disables the current recipe and restores only a signed reviewed target", () => {
  const db = new YoinkDatabase();
  try {
    const signer = ObserverRecipeSigner.ephemeral();
    const repository = new ObserverRecipeRepository(db, signer);
    const oldRecipe = repository.propose(proposal("amazon-layout-old"), NOW + 2_000);
    repository.promote(String(oldRecipe.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);
    const current = repository.propose(proposal("amazon-layout-current", String(oldRecipe.id)), NOW + 4_000);
    repository.promote(String(current.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 5_000);
    assert.equal(repository.active("amazon", NOW + 6_000)?.payload.recipeId, current.id);
    const rollback = repository.rollback(String(current.id), NOW + 7_000);
    assert.equal(rollback.disabled.lifecycleState, "disabled");
    assert.equal(rollback.active.payload.recipeId, oldRecipe.id);
    assert.equal(signer.verify(rollback.active), true);
  } finally {
    db.close();
  }
});

test("persistent observer signing keys are stable and private on disk", () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-observer-key-test-"));
  try {
    const first = ObserverRecipeSigner.persistent(directory);
    const second = ObserverRecipeSigner.persistent(directory);
    assert.equal(second.keyId, first.keyId);
    assert.equal(second.publicKeySpki, first.publicKeySpki);
    assert.equal(statSync(join(directory, "observer-recipe-ed25519-private.pem")).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
