import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  OBSERVER_RECIPE_CONTRACT_VERSION,
  OBSERVER_RECIPE_TRIAL_CONTRACT_VERSION,
  OBSERVER_RECIPE_TRIAL_VALIDATION_PROFILE,
  type ObserverRecipeField,
  type ObserverRecipeProposalInput,
  type ObserverRecipeTrialFieldOutcome,
  type ObserverRecipeTrialInput
} from "../packages/contracts/src/index.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import {
  OBSERVER_RECIPE_CANARY_MINIMUM_DURATION_MS,
  ObserverRecipeRepository,
  observerRecipeCanaryCohortEligible
} from "../packages/database/src/observer-recipe-repository.js";
import { ObserverRepairCandidateRepository } from "../packages/database/src/observer-repair-candidate-repository.js";
import {
  HOSTED_PRINCIPAL_CONFIRMATION,
  PrincipalRepository
} from "../packages/database/src/principal-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import {
  createObserverRecipeTrustManifest,
  ObserverRecipeTrustAuthority
} from "../packages/observer-registry/src/trust.js";

const NOW = new Date("2026-08-24T05:00:00.000Z").getTime();
const SERVICE_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "observer_recipe_test_identity"
};

function contributorScope(userId: string): RequestScope {
  return { tenantId: LOCAL_TENANT_ID, userId, actorKind: "user", actorId: userId };
}

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

function device(db: YoinkDatabase, now = NOW): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(now);
  return devices.pair({
    pairingCode: code.code,
    extensionVersion: "0.13.0",
    capabilities: { observerRecipeShadow: true, observerRecipePackagedOracle: true }
  }, now + 1_000);
}

function contributorDevice(
  db: YoinkDatabase,
  userId: string,
  now = NOW
): { scope: RequestScope; paired: { id: string; token: string } } {
  const scope = userId === LOCAL_USER_ID ? LOCAL_REQUEST_SCOPE : contributorScope(userId);
  if (userId !== LOCAL_USER_ID) {
    runWithRequestScope(SERVICE_SCOPE, () => new PrincipalRepository(db).provision({
      tenantId: LOCAL_TENANT_ID,
      userId,
      tenantName: "Local tenant",
      displayName: userId,
      confirmation: HOSTED_PRINCIPAL_CONFIRMATION
    }, now));
  }
  return { scope, paired: runWithRequestScope(scope, () => device(db, now)) };
}

function oracleTrial(
  recipeId: string,
  recipeVersion: string,
  sku: string,
  observedAt: number,
  fields: ObserverRecipeField[],
  layout = "a".repeat(64),
  conflictField: ObserverRecipeField | "" = ""
): ObserverRecipeTrialInput {
  const fieldOutcomes: ObserverRecipeTrialFieldOutcome[] = fields.map((field) => ({
    field,
    recipeState: "value",
    packagedState: field === conflictField ? "conflict" : "agreed",
    oracleState: field === conflictField ? "not_evaluated" : "agreed",
    disposition: field === conflictField ? "conflict" : "verified"
  }));
  const conflictCount = conflictField ? 1 : 0;
  return {
    contractVersion: OBSERVER_RECIPE_TRIAL_CONTRACT_VERSION,
    recipeId,
    recipeVersion,
    retailerId: "amazon",
    retailerSku: sku,
    observerVersion: AMAZON_OBSERVER_VERSION,
    layoutFingerprint: layout,
    outcome: conflictField ? "failed" : "passed",
    evaluatedFieldCount: fields.length,
    agreedFieldCount: fields.length - conflictCount,
    ambiguousFieldCount: 0,
    validationProfile: OBSERVER_RECIPE_TRIAL_VALIDATION_PROFILE,
    oracleEvaluatedFieldCount: fields.length - conflictCount,
    oracleAgreedFieldCount: fields.length - conflictCount,
    oracleConflictFieldCount: 0,
    packagedMissingFieldCount: 0,
    packagedConflictFieldCount: conflictCount,
    insufficientFieldCount: 0,
    fieldOutcomes,
    observedAt: new Date(observedAt).toISOString()
  };
}

function insufficientOracleTrial(
  recipeId: string,
  recipeVersion: string,
  sku: string,
  observedAt: number,
  field: ObserverRecipeField,
  layout = "f".repeat(64)
): ObserverRecipeTrialInput {
  return {
    contractVersion: OBSERVER_RECIPE_TRIAL_CONTRACT_VERSION,
    recipeId,
    recipeVersion,
    retailerId: "amazon",
    retailerSku: sku,
    observerVersion: AMAZON_OBSERVER_VERSION,
    layoutFingerprint: layout,
    outcome: "failed",
    evaluatedFieldCount: 1,
    agreedFieldCount: 0,
    ambiguousFieldCount: 0,
    validationProfile: OBSERVER_RECIPE_TRIAL_VALIDATION_PROFILE,
    oracleEvaluatedFieldCount: 0,
    oracleAgreedFieldCount: 0,
    oracleConflictFieldCount: 0,
    packagedMissingFieldCount: 1,
    packagedConflictFieldCount: 0,
    insufficientFieldCount: 1,
    fieldOutcomes: [{
      field,
      recipeState: "value",
      packagedState: "missing",
      oracleState: "missing",
      disposition: "insufficient"
    }],
    observedAt: new Date(observedAt).toISOString()
  };
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

function installRootedTrust(
  repository: ObserverRecipeRepository,
  trust: ObserverRecipeTrustAuthority,
  now = NOW + 1_500
): void {
  const manifest = trust.manifest()?.manifest;
  assert.ok(manifest);
  repository.installTrustManifest({
    manifest,
    confirmation: "INSTALL_ROOTED_OBSERVER_RECIPE_TRUST_MANIFEST"
  }, now);
}

test("observer recipes advance only through signed, measured, observer-only lifecycle stages", () => {
  const db = new YoinkDatabase();
  try {
    const paired = device(db);
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
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
    assert.equal(trust.intermediateSigner.verify(envelope), true);
    assert.equal(envelope.payload.fields.unitPrice?.selectors[0], ".a-price .a-offscreen");
    assert.equal("script" in envelope.payload, false);
    assert.throws(() => repository.promote(String(created.id), {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 4_000), /contributor-deduplicated passing/);

    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B002OB49L4", NOW + 5_000), NOW + 6_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B0DCGQ6CJD", NOW + 7_000), NOW + 8_000);
    assert.equal(repository.promote(String(created.id), {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 9_000).lifecycleState, "canary");

    const burnIn = NOW + 9_000 + OBSERVER_RECIPE_CANARY_MINIMUM_DURATION_MS;
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B0F2BDXW4J", burnIn + 1_000, "b".repeat(64)), burnIn + 2_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B002OB49L4", burnIn + 3_000, "b".repeat(64)), burnIn + 4_000);
    repository.recordTrial(paired.id, trial(String(created.id), "amazon-layout-1", "B0DCGQ6CJD", burnIn + 5_000, "a".repeat(64)), burnIn + 6_000);
    const trusted = repository.promote(String(created.id), {
      targetState: "trusted_read_only",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, burnIn + 7_000);
    assert.equal(trusted.lifecycleState, "trusted_read_only");
    const stableTrials = { ...(trusted.trials as Record<string, unknown>) };
    assert.ok(Number(stableTrials.canaryAgeSeconds) >= 86_400);
    delete stableTrials.canaryAgeSeconds;
    assert.deepEqual(stableTrials, {
      passed: 5,
      failed: 0,
      distinctSkus: 3,
      distinctLayouts: 2,
      packagedOracleTrials: 0,
      oracleCompletePassed: 0,
      distinctOracleSkus: 0,
      distinctOracleLayouts: 0,
      packagedConflictTrials: 0,
      oracleConflictTrials: 0,
      insufficientTrials: 0,
      cohortTrials: 5,
      cohortPassed: 5,
      cohortFailed: 0,
      distinctCohortContributors: 1,
      distinctCohortDevices: 1,
      distinctCohortSkus: 3,
      distinctCohortLayouts: 2,
      oracleCompleteCohortPassed: 0,
      distinctOracleContributors: 0,
      distinctOracleDevices: 0,
      distinctOracleCohortSkus: 0,
      distinctOracleCohortLayouts: 0,
      canaryCohortTrials: 3,
      canaryCohortPassed: 3,
      canaryCohortFailed: 0,
      distinctCanaryContributors: 1,
      distinctCanaryFailureContributors: 0,
      distinctCanarySkus: 3,
      distinctCanaryLayouts: 2,
      canaryOracleCompletePassed: 0,
      distinctCanaryOracleContributors: 0,
      distinctCanaryOracleDevices: 0,
      distinctCanaryOracleSkus: 0,
      distinctCanaryOracleLayouts: 0,
      canaryStartedAt: new Date(NOW + 9_000).toISOString(),
      canaryMinimumDurationSeconds: 86_400,
      canaryCohortPercent: 25,
      canaryRegressionSloBreached: false
    });
    assert.equal(repository.active("amazon", burnIn + 8_000)?.payload.state, "trusted_read_only");
    assert.equal(repository.counts(burnIn + 8_000).activeObserverRecipes, 1);
  } finally {
    db.close();
  }
});

test("worker-generated repairs require oracle-complete evidence while legacy trials remain compatible", () => {
  const db = new YoinkDatabase();
  try {
    const first = contributorDevice(db, LOCAL_USER_ID);
    const sameAccountSecondDevice = contributorDevice(db, LOCAL_USER_ID, NOW + 100);
    const second = contributorDevice(db, "observer_contributor_two");
    const third = contributorDevice(db, "observer_contributor_three");
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
    const generated = new ObserverRepairCandidateRepository(db).ensure({
      retailerId: "amazon",
      layoutFingerprint: "c".repeat(64),
      fields: {
        unitPrice: { mode: "text", selectors: ["span[data-testid='product-price']"] }
      },
      minimumExtensionVersion: "0.49.0",
      occurrenceCount: 3,
      minimumDistinctDeviceCount: 3,
      minimumDistinctSkuCount: 2
    }, NOW + 2_000);
    repository.promote(generated.id, {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);
    repository.recordTrial(first.paired.id, trial(generated.id, generated.recipeVersion, "B002OB49L4", NOW + 4_000), NOW + 4_500);
    repository.recordTrial(first.paired.id, trial(generated.id, generated.recipeVersion, "B0DCGQ6CJD", NOW + 5_000), NOW + 5_500);
    assert.throws(() => repository.promote(generated.id, {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 6_000), /packaged-oracle agreement/);

    repository.recordTrial(first.paired.id, oracleTrial(
      generated.id, generated.recipeVersion, "B002OB49L4", NOW + 7_000, ["unitPrice"]
    ), NOW + 7_500);
    repository.recordTrial(sameAccountSecondDevice.paired.id, oracleTrial(
      generated.id, generated.recipeVersion, "B002OB49L4", NOW + 7_200, ["unitPrice"]
    ), NOW + 7_600);
    assert.throws(() => repository.promote(generated.id, {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 7_750), /two independent contributors/);
    runWithRequestScope(second.scope, () => repository.recordTrial(second.paired.id, oracleTrial(
      generated.id, generated.recipeVersion, "B0DCGQ6CJD", NOW + 8_000, ["unitPrice"]
    ), NOW + 8_500));
    const canary = repository.promote(generated.id, {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 9_000);
    assert.equal(canary.lifecycleState, "canary");
    const summary = canary.trials as Record<string, unknown>;
    assert.equal(summary.packagedOracleTrials, 3);
    assert.equal(summary.oracleCompletePassed, 3);
    assert.equal(summary.distinctOracleSkus, 2);
    assert.equal(summary.oracleCompleteCohortPassed, 2);
    assert.equal(summary.cohortTrials, 3);
    assert.equal(summary.distinctOracleContributors, 2);
    assert.equal(summary.distinctOracleDevices, 2);

    let eligibleContributor = "";
    let excludedContributor = "";
    for (let index = 0; index < 1_000 && (!eligibleContributor || !excludedContributor); index += 1) {
      const candidate = `cohort_contributor_${index}`;
      if (observerRecipeCanaryCohortEligible(generated.id, candidate)) eligibleContributor ||= candidate;
      else excludedContributor ||= candidate;
    }
    assert.ok(eligibleContributor);
    assert.ok(excludedContributor);
    assert.equal(repository.active("amazon", NOW + 10_000, eligibleContributor)?.payload.state, "canary");
    assert.equal(repository.active("amazon", NOW + 10_000, excludedContributor), null);
    assert.equal(observerRecipeCanaryCohortEligible(generated.id, eligibleContributor), true);

    const burnIn = NOW + 9_000 + OBSERVER_RECIPE_CANARY_MINIMUM_DURATION_MS;
    repository.recordTrial(first.paired.id, oracleTrial(
      generated.id, generated.recipeVersion, "B002OB49L4", burnIn + 1_000, ["unitPrice"], "d".repeat(64)
    ), burnIn + 2_000);
    runWithRequestScope(second.scope, () => repository.recordTrial(second.paired.id, oracleTrial(
      generated.id, generated.recipeVersion, "B0DCGQ6CJD", burnIn + 3_000, ["unitPrice"], "d".repeat(64)
    ), burnIn + 4_000));
    runWithRequestScope(third.scope, () => repository.recordTrial(third.paired.id, oracleTrial(
      generated.id, generated.recipeVersion, "B0F2BDXW4J", burnIn + 5_000, ["unitPrice"], "e".repeat(64)
    ), burnIn + 6_000));
    const trusted = repository.promote(generated.id, {
      targetState: "trusted_read_only",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, burnIn + 7_000);
    assert.equal(trusted.lifecycleState, "trusted_read_only");
    const trustedSummary = trusted.trials as Record<string, unknown>;
    assert.equal(trustedSummary.canaryOracleCompletePassed, 3);
    assert.equal(trustedSummary.distinctCanaryOracleContributors, 3);
    assert.equal(trustedSummary.distinctCanaryOracleDevices, 3);
    assert.equal(trustedSummary.distinctCanaryOracleSkus, 3);
    assert.equal(trustedSummary.distinctCanaryOracleLayouts, 2);
  } finally {
    db.close();
  }
});

test("a contributor-deduplicated canary regression breaches its SLO and auto-kills distribution", () => {
  const db = new YoinkDatabase();
  try {
    const first = contributorDevice(db, LOCAL_USER_ID);
    const second = contributorDevice(db, "observer_regression_two");
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
    const input = proposal("amazon-canary-regression");
    input.fields = { unitPrice: { mode: "text", selectors: [".a-price .a-offscreen"] } };
    const created = repository.propose(input, NOW + 2_000);
    repository.promote(String(created.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);
    repository.recordTrial(first.paired.id, oracleTrial(
      String(created.id), "amazon-canary-regression", "B002OB49L4", NOW + 4_000, ["unitPrice"]
    ), NOW + 4_500);
    repository.recordTrial(first.paired.id, oracleTrial(
      String(created.id), "amazon-canary-regression", "B0DCGQ6CJD", NOW + 5_000, ["unitPrice"]
    ), NOW + 5_500);
    repository.promote(String(created.id), {
      targetState: "canary",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 6_000);

    repository.recordTrial(first.paired.id, oracleTrial(
      String(created.id), "amazon-canary-regression", "B0F2BDXW4J", NOW + 7_000, ["unitPrice"], "a".repeat(64)
    ), NOW + 7_500);
    runWithRequestScope(second.scope, () => repository.recordTrial(second.paired.id, oracleTrial(
      String(created.id), "amazon-canary-regression", "B081J5PW5J", NOW + 8_000, ["unitPrice"], "b".repeat(64)
    ), NOW + 8_500));
    const firstFailure = repository.recordTrial(first.paired.id, insufficientOracleTrial(
      String(created.id), "amazon-canary-regression", "B08JZHXQDN", NOW + 9_000, "unitPrice", "c".repeat(64)
    ), NOW + 9_500);
    assert.equal(firstFailure.autoDisabled, false);
    const sameContributorFailure = repository.recordTrial(first.paired.id, insufficientOracleTrial(
      String(created.id), "amazon-canary-regression", "B015TKSSB8", NOW + 10_000, "unitPrice", "d".repeat(64)
    ), NOW + 10_500);
    assert.equal(sameContributorFailure.autoDisabled, false);
    assert.equal(repository.list().find((item) => item.id === created.id)?.lifecycleState, "canary");

    const independentFailure = runWithRequestScope(second.scope, () => repository.recordTrial(
      second.paired.id,
      insufficientOracleTrial(
        String(created.id), "amazon-canary-regression", "B0GF44F4MG", NOW + 11_000, "unitPrice", "e".repeat(64)
      ),
      NOW + 11_500
    ));
    assert.equal(independentFailure.autoDisabled, true);
    assert.equal(independentFailure.autoDisabledReason, "canary_regression_slo_breach");
    assert.equal(repository.active("amazon", NOW + 12_000), null);
    const disabled = repository.list().find((item) => item.id === created.id);
    assert.ok(disabled);
    assert.equal(disabled.lifecycleState, "disabled");
    assert.equal(disabled.disabledReason, "canary_regression_slo_breach");
    const summary = disabled.trials as Record<string, unknown>;
    assert.equal(summary.canaryCohortTrials, 5);
    assert.equal(summary.canaryCohortFailed, 3);
    assert.equal(summary.distinctCanaryFailureContributors, 2);
    assert.equal(summary.canaryRegressionSloBreached, true);
    assert.equal(repository.counts(NOW + 12_000).autoDisabledObserverRecipesByCanaryRegression, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_lifecycle_events WHERE recipe_id = ? AND reason_code = 'canary_regression_slo_breach'",
      String(created.id)
    )?.count, 1);
    assert.deepEqual(db.all<{ recipeState: string }>(
      "SELECT DISTINCT recipe_state_at_trial AS recipeState FROM observer_recipe_trials WHERE recipe_id = ? ORDER BY recipeState",
      String(created.id)
    ).map((row) => row.recipeState), ["canary", "shadow"]);
  } finally {
    db.close();
  }
});

test("one packaged conflict durably records bounded evidence and immediately kills distribution", () => {
  const db = new YoinkDatabase();
  try {
    const paired = device(db);
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
    const created = repository.propose(proposal("amazon-conflict-kill"), NOW + 2_000);
    repository.promote(String(created.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);
    const conflict = oracleTrial(
      String(created.id), "amazon-conflict-kill", "B002OB49L4", NOW + 4_000,
      ["availability", "unitPrice", "seller", "fulfillment", "addControl"],
      "d".repeat(64),
      "unitPrice"
    );
    assert.throws(
      () => repository.recordTrial(paired.id, { ...conflict, agreedFieldCount: 5 }, NOW + 4_250),
      /counts do not match/
    );
    const unsafe = structuredClone(conflict) as ObserverRecipeTrialInput & {
      fieldOutcomes: Array<ObserverRecipeTrialFieldOutcome & { rawValue?: string }>;
    };
    assert.ok(unsafe.fieldOutcomes);
    unsafe.fieldOutcomes[0] = { ...unsafe.fieldOutcomes[0]!, rawValue: "DO_NOT_STORE" };
    assert.throws(
      () => repository.recordTrial(paired.id, unsafe, NOW + 4_300),
      /bounded state schema/
    );
    assert.ok(repository.active("amazon", NOW + 4_400));
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM observer_recipe_trials")?.count, 0);
    const receipt = repository.recordTrial(paired.id, conflict, NOW + 4_500);
    assert.equal(receipt.autoDisabled, true);
    assert.equal(repository.active("amazon", NOW + 5_000), null);
    const disabled = repository.list().find((recipe) => recipe.id === created.id);
    assert.equal(disabled?.lifecycleState, "disabled");
    assert.equal(disabled?.disabledReason, "packaged_evidence_conflict");
    assert.equal((disabled?.trials as Record<string, number>).packagedConflictTrials, 1);
    const stored = db.get<Record<string, unknown>>(
      "SELECT validation_profile, packaged_conflict_field_count, field_outcomes_json FROM observer_recipe_trials WHERE recipe_id = ?",
      String(created.id)
    );
    assert.equal(stored?.validation_profile, "packaged_structured_oracle_v1");
    assert.equal(stored?.packaged_conflict_field_count, 1);
    assert.equal(JSON.stringify(stored).includes("DO_NOT_STORE"), false);
    assert.equal(repository.counts(NOW + 5_000).autoDisabledObserverRecipesByPackagedConflict, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_lifecycle_events WHERE recipe_id = ? AND reason_code = 'packaged_evidence_conflict'",
      String(created.id)
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("the recipe schema rejects code, XPath, credential selectors, mutation selectors, arbitrary fields, and long expiry", () => {
  const db = new YoinkDatabase();
  try {
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
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
    assert.throws(() => repository.propose({
      ...proposal(),
      provenanceCode: "privacy_bounded_repair_miner"
    }, NOW + 2_000), /provenance/);
    assert.throws(() => repository.propose({
      ...proposal("amazon-repair-aaaaaaaaaaaa")
    }, NOW + 2_000), /version/);
    assert.equal(repository.list().length, 0);
  } finally {
    db.close();
  }
});

test("any failed shadow trial blocks promotion and the kill switch immediately removes distribution", () => {
  const db = new YoinkDatabase();
  try {
    const paired = device(db);
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
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
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
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
    assert.equal(trust.intermediateSigner.verify(rollback.active), true);
  } finally {
    db.close();
  }
});

test("an explicit re-sign restores reviewed recipe distribution after a monotonic trust renewal", () => {
  const db = new YoinkDatabase();
  try {
    const rootSigner = ObserverRecipeSigner.ephemeral();
    const intermediate = ObserverRecipeSigner.ephemeral();
    const root = { algorithm: "Ed25519" as const, keyId: rootSigner.keyId, publicKeySpki: rootSigner.publicKeySpki };
    const issuedAt = new Date(NOW - 60_000).toISOString();
    const expiresAt = new Date(NOW + 30 * 24 * 60 * 60_000).toISOString();
    const firstManifest = createObserverRecipeTrustManifest(rootSigner, {
      generation: 1,
      issuedAt,
      expiresAt,
      previousManifestHash: "",
      keys: [{
        algorithm: "Ed25519",
        keyId: intermediate.keyId,
        publicKeySpki: intermediate.publicKeySpki,
        usage: "observer_recipe_signing",
        status: "active",
        notBefore: issuedAt,
        notAfter: expiresAt
      }],
      revokedKeyIds: []
    }, root);
    const trust = ObserverRecipeTrustAuthority.inMemory(root, intermediate, firstManifest, NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
    const created = repository.propose(proposal("amazon-root-renewal"), NOW + 2_000);
    repository.promote(String(created.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);
    assert.ok(repository.active("amazon", NOW + 3_500));

    const first = trust.manifest();
    assert.ok(first);
    const secondManifest = createObserverRecipeTrustManifest(rootSigner, {
      generation: 2,
      issuedAt: new Date(NOW + 4_000).toISOString(),
      expiresAt,
      previousManifestHash: first.manifestHash,
      keys: first.manifest.payload.keys,
      revokedKeyIds: []
    }, root);
    repository.installTrustManifest({
      manifest: secondManifest,
      confirmation: "INSTALL_ROOTED_OBSERVER_RECIPE_TRUST_MANIFEST"
    }, NOW + 4_000);
    assert.equal(repository.active("amazon", NOW + 4_500), null);
    const resigned = repository.resign(String(created.id), {
      confirmation: "RESIGN_ROOTED_OBSERVER_RECIPE"
    }, NOW + 5_000);
    assert.equal(resigned.lifecycleState, "shadow");
    assert.equal(resigned.trustManifestGeneration, 2);
    assert.ok(repository.active("amazon", NOW + 5_500));
    assert.equal(repository.counts(NOW + 5_500).observerRecipeTrustManifests, 2);
    assert.equal(repository.counts(NOW + 5_500).observerRecipeTransparencyEvents, 4);
    assert.throws(
      () => db.run("UPDATE observer_recipe_trust_manifests SET installed_at = installed_at"),
      /append-only/
    );
    assert.throws(
      () => db.run("UPDATE observer_recipe_transparency_events SET created_at = created_at"),
      /append-only/
    );
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
