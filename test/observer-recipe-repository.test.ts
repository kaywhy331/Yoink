import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE,
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION,
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE,
  OBSERVER_RECIPE_CONTRACT_VERSION,
  OBSERVER_RECIPE_RECOVERY_EVIDENCE_CONTRACT_VERSION,
  OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
  OBSERVER_RECIPE_TRIAL_CONTRACT_VERSION,
  OBSERVER_RECIPE_TRIAL_VALIDATION_PROFILE,
  REJECT_OBSERVER_RECIPE_RECOVERY_EVIDENCE,
  REVOKE_OBSERVER_RECIPE_RECOVERY_CONFIRMATION,
  type ObserverRecipeField,
  type ObserverRecipeContributorEligibilityInput,
  type ObserverRecipeProposalInput,
  type ObserverRecipeTrialFieldOutcome,
  type ObserverRecipeTrialInput
} from "../packages/contracts/src/index.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import {
  OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION,
  ObserverRecipeConflictSloRepository
} from "../packages/database/src/observer-recipe-conflict-slo-repository.js";
import { ObserverRecipeContributorEligibilityRepository } from "../packages/database/src/observer-recipe-contributor-eligibility-repository.js";
import {
  OBSERVER_RECIPE_CANARY_MINIMUM_DURATION_MS,
  ObserverRecipeRepository,
  observerRecipeCanaryCohortEligible
} from "../packages/database/src/observer-recipe-repository.js";
import {
  OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS,
  OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH,
  OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION
} from "../packages/database/src/observer-recipe-recovery-retention-repository.js";
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
import { UserPrivacyRepository } from "../packages/database/src/user-privacy-repository.js";
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
  actorId: "observer_recipe_test_identity",
  internalServiceCapability: "internal.principal"
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
    capabilities: {
      observerRecipeShadow: true,
      observerRecipePackagedOracle: true,
      observerRecipeRecoveryEvidence: true
    }
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

function oracleConflictTrial(
  recipeId: string,
  recipeVersion: string,
  sku: string,
  observedAt: number,
  layout = "e".repeat(64)
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
    oracleEvaluatedFieldCount: 1,
    oracleAgreedFieldCount: 0,
    oracleConflictFieldCount: 1,
    packagedMissingFieldCount: 0,
    packagedConflictFieldCount: 0,
    insufficientFieldCount: 0,
    fieldOutcomes: [{
      field: "unitPrice",
      recipeState: "value",
      packagedState: "agreed",
      oracleState: "conflict",
      disposition: "conflict"
    }],
    observedAt: new Date(observedAt).toISOString()
  };
}

function attestEligibility(
  db: YoinkDatabase,
  contributor: { scope: RequestScope; paired: { id: string } },
  contributorRefHash: string,
  proofHash: string,
  regionScope: string,
  now: number
): void {
  const input = {
    contractVersion: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION,
    deviceId: contributor.paired.id,
    contributorRefHash,
    regionScope,
    accountEligible: true,
    deviceEligible: true,
    regionEligible: true,
    proofHash,
    source: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE,
    attestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60 * 60_000).toISOString()
  } satisfies ObserverRecipeContributorEligibilityInput;
  runWithRequestScope({
    tenantId: contributor.scope.tenantId,
    userId: contributor.scope.userId,
    actorKind: "service",
    actorId: "external_identity_risk_test",
    internalServiceCapability: "internal.eligibility"
  }, () => new ObserverRecipeContributorEligibilityRepository(db).attest(input, now));
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

function recoveryTrial(
  recipeId: string,
  recipeVersion: string,
  sku: string,
  observedAt: number,
  field: ObserverRecipeField,
  normalizedValue: string | number | boolean,
  layout = "9".repeat(64)
): ObserverRecipeTrialInput {
  return {
    contractVersion: OBSERVER_RECIPE_RECOVERY_EVIDENCE_CONTRACT_VERSION,
    recipeId,
    recipeVersion,
    retailerId: "amazon",
    retailerSku: sku,
    observerVersion: AMAZON_OBSERVER_VERSION,
    layoutFingerprint: layout,
    outcome: "passed",
    evaluatedFieldCount: 1,
    agreedFieldCount: 1,
    ambiguousFieldCount: 0,
    validationProfile: OBSERVER_RECIPE_TRIAL_VALIDATION_PROFILE,
    oracleEvaluatedFieldCount: 1,
    oracleAgreedFieldCount: 1,
    oracleConflictFieldCount: 0,
    packagedMissingFieldCount: 1,
    packagedConflictFieldCount: 0,
    insufficientFieldCount: 0,
    fieldOutcomes: [{
      field,
      recipeState: "value",
      packagedState: "missing",
      oracleState: "agreed",
      disposition: "verified"
    }],
    recoveryEvidence: [{ field, normalizedValue }],
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

test("oracle-agreed missing-field values enter an append-only quarantine without filling or executing", () => {
  const db = new YoinkDatabase();
  try {
    const paired = device(db);
    const devices = new DeviceRepository(db);
    const legacyCode = devices.createPairingCode(NOW + 100);
    const legacyCompanion = devices.pair({
      pairingCode: legacyCode.code,
      extensionVersion: "0.50.0",
      capabilities: { observerRecipeShadow: true, observerRecipePackagedOracle: true }
    }, NOW + 200);
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
    const input = proposal("amazon-recovery-ledger");
    input.fields = { unitPrice: { mode: "text", selectors: [".a-price .a-offscreen"] } };
    const created = repository.propose(input, NOW + 2_000);
    repository.promote(String(created.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);
    const operationalBefore = {
      observations: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_shadow_observations")?.count,
      qualifications: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_qualifications")?.count,
      jobs: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count,
      missions: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count
    };
    const valid = recoveryTrial(
      String(created.id), "amazon-recovery-ledger", "B002OB49L4", NOW + 4_000, "unitPrice", 1_368
    );
    assert.throws(
      () => repository.recordTrial(legacyCompanion.id, valid, NOW + 4_250),
      /Upgrade the paired Chrome companion/
    );
    assert.throws(
      () => repository.recordTrial(paired.id, { ...valid, contractVersion: OBSERVER_RECIPE_TRIAL_CONTRACT_VERSION }, NOW + 4_300),
      /contract version 3/
    );
    const missingRecovery = structuredClone(valid);
    delete missingRecovery.recoveryEvidence;
    assert.throws(
      () => repository.recordTrial(paired.id, missingRecovery, NOW + 4_350),
      /requires bounded recovery evidence/
    );
    assert.throws(
      () => repository.recordTrial(paired.id, {
        ...valid,
        recoveryEvidence: [{ field: "seller", normalizedValue: "buyer@example.com" }]
      }, NOW + 4_400),
      /bounded public-name schema/
    );
    const receipt = repository.recordTrial(paired.id, valid, NOW + 4_500);
    assert.equal(receipt.recoveryEvidenceCount, 1);
    assert.equal(receipt.recoveryEvidenceState, "quarantined");
    const evidence = repository.recoveryEvidence();
    assert.equal(evidence.length, 1);
    assert.deepEqual({
      recipeId: evidence[0]?.recipeId,
      retailerId: evidence[0]?.retailerId,
      retailerSku: evidence[0]?.retailerSku,
      field: evidence[0]?.field,
      normalizedValue: evidence[0]?.normalizedValue,
      provenanceCode: evidence[0]?.provenanceCode,
      recipeStateAtTrial: evidence[0]?.recipeStateAtTrial,
      evidenceState: evidence[0]?.evidenceState,
      applicationState: evidence[0]?.applicationState
    }, {
      recipeId: created.id,
      retailerId: "amazon",
      retailerSku: "B002OB49L4",
      field: "unitPrice",
      normalizedValue: 1_368,
      provenanceCode: "recipe_packaged_oracle_agreement_v1",
      recipeStateAtTrial: "shadow",
      evidenceState: "quarantined",
      applicationState: "not_applied"
    });
    assert.match(String(evidence[0]?.contributorRef), /^[a-f0-9]{12}$/);
    assert.equal(evidence[0]?.reviewState, "unreviewed");
    assert.equal(evidence[0]?.reviewSequence, 0);
    assert.equal(evidence[0]?.confirmableByCurrentUser, true);
    assert.equal(evidence[0]?.reviewAffectsApplication, false);
    assert.deepEqual(repository.userRecoveryEvidence().map((item) => item.id), [evidence[0]?.id]);
    const otherScope = contributorScope("observer_recovery_other");
    assert.deepEqual(runWithRequestScope(otherScope, () => repository.userRecoveryEvidence()), []);
    assert.throws(
      () => db.run(
        `INSERT INTO observer_recipe_recovery_reviews(
           id, tenant_id, user_id, evidence_id, sequence, decision,
           confirmation_code, evidence_hash, actor_kind, actor_id, created_at
         ) VALUES (?, ?, ?, ?, 1, 'confirmed', ?, ?, 'user', ?, ?)`,
        "observer_recipe_recovery_review_wrong_owner",
        LOCAL_TENANT_ID,
        "observer_recovery_other",
        String(evidence[0]?.id),
        CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE,
        "a".repeat(64),
        "observer_recovery_other",
        new Date(NOW + 4_900).toISOString()
      ),
      /FOREIGN KEY constraint failed/
    );
    assert.throws(
      () => runWithRequestScope(otherScope, () => repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
        contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
        decision: "confirmed",
        confirmation: CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE
      }, NOW + 5_000)),
      /does not belong to the authenticated user/
    );
    assert.throws(
      () => repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
        contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
        decision: "confirmed",
        confirmation: REJECT_OBSERVER_RECIPE_RECOVERY_EVIDENCE
      }, NOW + 5_050),
      /explicitly confirm/
    );
    assert.throws(
      () => repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
        contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
        decision: "confirmed",
        confirmation: CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE,
        note: "DO_NOT_STORE"
      } as unknown as Parameters<ObserverRecipeRepository["reviewRecoveryEvidence"]>[1], NOW + 5_075),
      /valid bounded recovery-evidence review decision/
    );
    const confirmed = repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
      contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
      decision: "confirmed",
      confirmation: CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE
    }, NOW + 5_100);
    assert.equal(confirmed.disposition, "recorded");
    assert.equal((confirmed.evidence as Record<string, unknown>).reviewState, "confirmed");
    assert.equal(confirmed.applicationAffected, false);
    assert.equal(confirmed.fieldFillApplied, false);
    const confirmedRetry = repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
      contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
      decision: "confirmed",
      confirmation: CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE
    }, NOW + 5_200);
    assert.equal(confirmedRetry.disposition, "unchanged");
    assert.equal(confirmedRetry.reviewEventId, confirmed.reviewEventId);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_recovery_reviews"
    )?.count, 1);
    const rejected = repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
      contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
      decision: "rejected",
      confirmation: REJECT_OBSERVER_RECIPE_RECOVERY_EVIDENCE
    }, NOW + 5_300);
    assert.equal((rejected.evidence as Record<string, unknown>).reviewState, "rejected");
    assert.throws(
      () => repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
        contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
        decision: "revoked",
        confirmation: REVOKE_OBSERVER_RECIPE_RECOVERY_CONFIRMATION
      }, NOW + 5_350),
      /Only a current confirmation can be revoked/
    );
    repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
      contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
      decision: "confirmed",
      confirmation: CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE
    }, NOW + 5_400);
    const revoked = repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
      contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
      decision: "revoked",
      confirmation: REVOKE_OBSERVER_RECIPE_RECOVERY_CONFIRMATION
    }, NOW + 5_500);
    assert.equal((revoked.evidence as Record<string, unknown>).reviewState, "revoked");
    assert.equal((revoked.evidence as Record<string, unknown>).reviewSequence, 4);
    const revokeRetry = repository.reviewRecoveryEvidence(String(evidence[0]?.id), {
      contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
      decision: "revoked",
      confirmation: REVOKE_OBSERVER_RECIPE_RECOVERY_CONFIRMATION
    }, NOW + 5_600);
    assert.equal(revokeRetry.disposition, "unchanged");
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_recovery_reviews"
    )?.count, 4);
    assert.equal(JSON.stringify(db.all("SELECT * FROM observer_recipe_recovery_reviews")).includes("DO_NOT_STORE"), false);
    assert.deepEqual({
      observations: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_shadow_observations")?.count,
      qualifications: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_qualifications")?.count,
      jobs: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count,
      missions: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count
    }, operationalBefore);
    const recoveryCounts = repository.counts(NOW + 6_000);
    assert.equal(recoveryCounts.quarantinedObserverRecipeRecoveryEvidence, 1);
    assert.equal(recoveryCounts.observerRecipeRecoveryReviewEvents, 4);
    assert.equal(recoveryCounts.confirmedObserverRecipeRecoveryEvidence, 0);
    assert.equal(recoveryCounts.rejectedObserverRecipeRecoveryEvidence, 0);
    assert.equal(recoveryCounts.revokedObserverRecipeRecoveryEvidence, 1);
    assert.equal(recoveryCounts.unreviewedObserverRecipeRecoveryEvidence, 0);
    const audit = db.get<{ dataJson: string }>(
      "SELECT data_json AS dataJson FROM audit_events WHERE event_type = 'observer_recipe_recovery_evidence_quarantined'"
    );
    assert.ok(audit);
    assert.equal(audit.dataJson.includes("1368"), false);
    assert.equal(audit.dataJson.includes("example.com"), false);
    const reviewAudits = db.all<{ dataJson: string }>(
      "SELECT data_json AS dataJson FROM audit_events WHERE event_type LIKE 'observer_recipe_recovery_evidence_%'"
    );
    assert.equal(reviewAudits.every((item) => !item.dataJson.includes("1368")), true);
    const exported = new UserPrivacyRepository(db).export(NOW + 6_000);
    const maintenance = exported.data.community_and_maintenance as Record<string, unknown>;
    const exportedEvidence = maintenance.observer_recipe_recovery_evidence as Array<Record<string, unknown>>;
    const exportedReviews = maintenance.observer_recipe_recovery_reviews as Array<Record<string, unknown>>;
    assert.equal(exportedEvidence.length, 1);
    assert.equal(exportedEvidence[0]?.normalized_value, "1368");
    assert.equal(exportedEvidence[0]?.application_state, "not_applied");
    assert.equal(exportedReviews.length, 4);
    assert.deepEqual(exportedReviews.map((item) => item.sequence), [1, 2, 3, 4]);
    assert.deepEqual(exportedReviews.map((item) => item.decision), ["confirmed", "rejected", "confirmed", "revoked"]);
    assert.throws(
      () => db.run("UPDATE observer_recipe_recovery_evidence SET application_state = 'not_applied'"),
      /append-only/
    );
    assert.throws(
      () => db.run("DELETE FROM observer_recipe_recovery_evidence"),
      /retained until bounded cleanup/
    );
    assert.throws(
      () => db.run("UPDATE observer_recipe_recovery_reviews SET decision = 'confirmed'"),
      /append-only/
    );
    assert.throws(
      () => db.run("DELETE FROM observer_recipe_recovery_reviews"),
      /append-only/
    );
    db.run("DELETE FROM users WHERE id = ?", LOCAL_USER_ID);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_recovery_reviews"
    )?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_recovery_evidence"
    )?.count, 0);
  } finally {
    db.close();
  }
});

test("recovery evidence expires by latest activity through a bounded owner-scoped worker with aggregate receipts", () => {
  const db = new YoinkDatabase();
  try {
    const retentionNow = Date.now();
    const oldNow = retentionNow - (OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS + 1) * 24 * 60 * 60_000;
    const paired = device(db, oldNow);
    const other = contributorDevice(db, "observer_retention_other", oldNow + 100);
    const trust = ObserverRecipeTrustAuthority.ephemeral(oldNow);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust, oldNow + 1_500);
    const input = proposal("amazon-recovery-retention");
    input.expiresAt = new Date(oldNow + 7 * 24 * 60 * 60_000).toISOString();
    input.fields = { unitPrice: { mode: "text", selectors: [".a-price .a-offscreen"] } };
    const created = repository.propose(input, oldNow + 2_000);
    repository.promote(String(created.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, oldNow + 3_000);
    repository.recordTrial(paired.id, recoveryTrial(
      String(created.id), "amazon-recovery-retention", "B002OB49L4", oldNow + 4_000, "unitPrice", 1_368
    ), oldNow + 4_500);
    repository.recordTrial(paired.id, recoveryTrial(
      String(created.id), "amazon-recovery-retention", "B0DCGQ6CJD", oldNow + 6_000, "unitPrice", 1_060,
      "8".repeat(64)
    ), oldNow + 6_500);
    runWithRequestScope(other.scope, () => repository.recordTrial(other.paired.id, recoveryTrial(
      String(created.id), "amazon-recovery-retention", "B0F2BDXW4J", oldNow + 8_000, "unitPrice", 12_199,
      "7".repeat(64)
    ), oldNow + 8_500));
    const evidence = repository.recoveryEvidence();
    const expiredReviewed = evidence.find((item) => item.retailerSku === "B002OB49L4");
    const recentlyReviewed = evidence.find((item) => item.retailerSku === "B0DCGQ6CJD");
    const otherEvidence = evidence.find((item) => item.retailerSku === "B0F2BDXW4J");
    assert.ok(expiredReviewed && recentlyReviewed && otherEvidence);
    repository.reviewRecoveryEvidence(String(expiredReviewed.id), {
      contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
      decision: "confirmed",
      confirmation: CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE
    }, oldNow + 5_000);
    repository.reviewRecoveryEvidence(String(recentlyReviewed.id), {
      contractVersion: OBSERVER_RECIPE_RECOVERY_REVIEW_CONTRACT_VERSION,
      decision: "confirmed",
      confirmation: CONFIRM_OBSERVER_RECIPE_RECOVERY_EVIDENCE
    }, retentionNow - 10 * 24 * 60 * 60_000);
    const protectedProjection = repository.userRecoveryEvidence().find(
      (item) => item.id === recentlyReviewed.id
    );
    assert.equal(protectedProjection?.retentionDays, OBSERVER_RECIPE_RECOVERY_RETENTION_DAYS);
    assert.equal(protectedProjection?.retentionPolicyVersion, OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION);
    assert.equal(
      new Date(String(protectedProjection?.retentionExpiresAt)).getTime(),
      retentionNow + 80 * 24 * 60 * 60_000
    );
    assert.throws(
      () => db.run("DELETE FROM observer_recipe_recovery_evidence WHERE id = ?", String(recentlyReviewed.id)),
      /retained until bounded cleanup/
    );
    assert.throws(
      () => repository.pruneRecoveryEvidence(retentionNow),
      /trusted background service scope/
    );
    const operationalBefore = {
      observations: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_shadow_observations")?.count,
      qualifications: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_qualifications")?.count,
      jobs: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count,
      missions: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count
    };
    const localResult = runWithRequestScope({
      tenantId: SERVICE_SCOPE.tenantId,
      userId: SERVICE_SCOPE.userId,
      actorKind: "service",
      actorId: "observer_recovery_retention_worker"
    }, () => repository.pruneRecoveryEvidence(retentionNow));
    assert.deepEqual({
      deletedRecoveryEvidence: localResult.deletedRecoveryEvidence,
      deletedRecoveryReviewEvents: localResult.deletedRecoveryReviewEvents,
      recoveryEvidenceRetentionDays: localResult.recoveryEvidenceRetentionDays
    }, {
      deletedRecoveryEvidence: 1,
      deletedRecoveryReviewEvents: 1,
      recoveryEvidenceRetentionDays: 90
    });
    assert.match(localResult.recoveryEvidenceRetentionReceiptId, /^observer_recovery_retention_/);
    assert.equal(OBSERVER_RECIPE_RECOVERY_RETENTION_MAXIMUM_BATCH, 500);
    assert.deepEqual(repository.recoveryEvidence().map((item) => item.retailerSku).sort(), [
      "B0DCGQ6CJD",
      "B0F2BDXW4J"
    ]);
    const localStatus = repository.recoveryRetentionStatus(20, true, retentionNow) as {
      policyVersion: string;
      retentionDays: number;
      activityResetsExpiry: boolean;
      maximumEvidencePerRun: number;
      eligibleEvidence: number;
      receiptCount: number;
      deletedEvidenceCount: number;
      deletedReviewEventCount: number;
      receipts: Array<Record<string, unknown>>;
      applicationAffected: boolean;
      fieldFillEnabled: boolean;
    };
    assert.equal(localStatus.policyVersion, OBSERVER_RECIPE_RECOVERY_RETENTION_POLICY_VERSION);
    assert.equal(localStatus.retentionDays, 90);
    assert.equal(localStatus.activityResetsExpiry, true);
    assert.equal(localStatus.maximumEvidencePerRun, 500);
    assert.equal(localStatus.eligibleEvidence, 0);
    assert.equal(localStatus.receiptCount, 1);
    assert.equal(localStatus.deletedEvidenceCount, 1);
    assert.equal(localStatus.deletedReviewEventCount, 1);
    assert.equal(localStatus.applicationAffected, false);
    assert.equal(localStatus.fieldFillEnabled, false);
    assert.equal(localStatus.receipts[0]?.normalizedValuesRecorded, false);
    assert.equal("normalizedValue" in (localStatus.receipts[0] ?? {}), false);
    assert.throws(
      () => db.run("UPDATE observer_recipe_recovery_retention_receipts SET retention_days = 90"),
      /append-only/
    );
    assert.throws(
      () => db.run("DELETE FROM observer_recipe_recovery_retention_receipts"),
      /append-only/
    );
    const retentionAudit = db.get<{ dataJson: string }>(
      "SELECT data_json AS dataJson FROM audit_events WHERE event_type = 'observer_recipe_recovery_retention_applied'"
    );
    assert.ok(retentionAudit);
    assert.equal(retentionAudit.dataJson.includes("1368"), false);
    assert.equal(retentionAudit.dataJson.includes("B002OB49L4"), false);
    const exported = new UserPrivacyRepository(db).export(retentionNow);
    const exportedRetention = (
      exported.data.community_and_maintenance as Record<string, unknown>
    ).observer_recipe_recovery_retention_receipts as Array<Record<string, unknown>>;
    assert.equal(exportedRetention.length, 1);
    assert.equal(exportedRetention[0]?.deleted_evidence_count, 1);
    assert.equal("normalized_value" in (exportedRetention[0] ?? {}), false);
    assert.deepEqual({
      observations: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_shadow_observations")?.count,
      qualifications: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_qualifications")?.count,
      jobs: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count,
      missions: db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count
    }, operationalBefore);
    const otherResult = runWithRequestScope({
      tenantId: LOCAL_TENANT_ID,
      userId: "observer_retention_other",
      actorKind: "service",
      actorId: "observer_recovery_retention_worker"
    }, () => repository.pruneRecoveryEvidence(retentionNow));
    assert.equal(otherResult.deletedRecoveryEvidence, 1);
    assert.deepEqual(repository.recoveryEvidence().map((item) => item.retailerSku), ["B0DCGQ6CJD"]);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_recovery_retention_receipts WHERE user_id = 'observer_retention_other'"
    )?.count, 1);
    db.run("DELETE FROM users WHERE tenant_id = ? AND id = 'observer_retention_other'", LOCAL_TENANT_ID);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_recovery_retention_receipts WHERE user_id = 'observer_retention_other'"
    )?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_recipe_recovery_retention_receipts WHERE user_id = ?",
      LOCAL_USER_ID
    )?.count, 1);
    db.assertIntegrity();
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

test("only fresh externally eligible multi-account and multi-region oracle conflicts can breach the regional SLO", () => {
  const db = new YoinkDatabase();
  try {
    const first = contributorDevice(db, LOCAL_USER_ID);
    const second = contributorDevice(db, "observer_regional_two");
    const third = contributorDevice(db, "observer_regional_three");
    const trust = ObserverRecipeTrustAuthority.ephemeral(NOW);
    const repository = new ObserverRecipeRepository(db, trust);
    installRootedTrust(repository, trust);
    const input = proposal("amazon-regional-conflict");
    input.fields = { unitPrice: { mode: "text", selectors: [".a-price .a-offscreen"] } };
    const created = repository.propose(input, NOW + 2_000);
    repository.promote(String(created.id), {
      targetState: "shadow",
      confirmation: "PROMOTE_SIGNED_OBSERVER_RECIPE"
    }, NOW + 3_000);

    const unverified = runWithRequestScope(first.scope, () => repository.recordTrial(
      first.paired.id,
      oracleConflictTrial(
        String(created.id), "amazon-regional-conflict", "B002OB49L4", NOW + 3_100, "f".repeat(64)
      ),
      NOW + 3_200
    ));
    assert.equal(unverified.eligibilityState, "unverified");
    assert.equal(unverified.autoDisabled, false);
    assert.equal((unverified.regionalConflictSlo as Record<string, unknown>).eligibleTrials, 0);
    assert.equal(repository.list().find((item) => item.id === created.id)?.lifecycleState, "shadow");

    attestEligibility(db, first, "1".repeat(64), "a".repeat(64), "subdivision:US-CA", NOW + 4_000);
    attestEligibility(db, second, "2".repeat(64), "b".repeat(64), "subdivision:US-NY", NOW + 4_000);
    attestEligibility(db, third, "3".repeat(64), "c".repeat(64), "subdivision:US-CA", NOW + 4_000);

    const skus = [
      "B0DCGQ6CJD", "B0F2BDXW4J", "B081J5PW5J", "B08JZHXQDN", "B015TKSSB8",
      "B0GF44F4MG", "B0FPPWKMGK", "B0FH8M48ZC", "B0FB21526X", "B07ZPS1KVD"
    ];
    const contributors = [first, second, third, first, second, third, first, second, third, first];
    let finalReceipt: Record<string, unknown> = {};
    for (let index = 0; index < skus.length; index += 1) {
      const contributor = contributors[index]!;
      const observedAt = NOW + 5_000 + index * 500;
      const evidence = index < 2
        ? oracleConflictTrial(
          String(created.id), "amazon-regional-conflict", skus[index]!, observedAt,
          index.toString(16).repeat(64)
        )
        : oracleTrial(
          String(created.id), "amazon-regional-conflict", skus[index]!, observedAt,
          ["unitPrice"], index.toString(16).repeat(64)
        );
      finalReceipt = runWithRequestScope(contributor.scope, () => repository.recordTrial(
        contributor.paired.id,
        evidence,
        observedAt + 100
      ));
      if (index < skus.length - 1) assert.equal(finalReceipt.autoDisabled, false);
    }
    assert.equal(finalReceipt.autoDisabled, true);
    assert.equal(finalReceipt.autoDisabledReason, "regional_oracle_conflict_slo_breach");
    const measurement = runWithRequestScope(LOCAL_REQUEST_SCOPE, () =>
      new ObserverRecipeConflictSloRepository(db).measure(String(created.id), NOW + 10_000));
    assert.equal(measurement.policyVersion, OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION);
    assert.deepEqual(measurement, {
      policyVersion: OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION,
      windowDays: 7,
      cutoffAt: new Date(NOW + 10_000 - 7 * 24 * 60 * 60_000).toISOString(),
      eligibleTrials: 10,
      conflictTrials: 2,
      distinctEligibleAccounts: 3,
      distinctEligibleRegions: 2,
      distinctConflictAccounts: 2,
      distinctConflictRegions: 2,
      conflictRateBasisPoints: 2_000,
      evidenceReady: true,
      breached: true,
      state: "breached"
    });
    const disabled = repository.list().find((item) => item.id === created.id);
    assert.equal(disabled?.lifecycleState, "disabled");
    assert.equal(disabled?.disabledReason, "regional_oracle_conflict_slo_breach");
    assert.equal(repository.active("amazon", NOW + 10_001), null);
    assert.equal(repository.counts(NOW + 10_001).autoDisabledObserverRecipesByRegionalConflictSlo, 1);
    assert.equal(db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM observer_recipe_lifecycle_events
       WHERE recipe_id = ? AND reason_code = 'regional_oracle_conflict_slo_breach'`,
      String(created.id)
    )?.count, 1);
    const storedUnverified = db.get<{ state: string; region: string }>(
      `SELECT eligibility_state AS state, region_scope AS region
       FROM observer_recipe_trials WHERE id = ?`,
      String(unverified.id)
    );
    assert.equal(storedUnverified?.state, "unverified");
    assert.equal(storedUnverified?.region, "");
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
