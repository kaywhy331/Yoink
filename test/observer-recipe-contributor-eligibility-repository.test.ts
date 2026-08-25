import assert from "node:assert/strict";
import test from "node:test";
import {
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION,
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE,
  type ObserverRecipeContributorEligibilityInput
} from "../packages/contracts/src/index.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import {
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION,
  ObserverRecipeContributorEligibilityRepository
} from "../packages/database/src/observer-recipe-contributor-eligibility-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-25T10:00:00.000Z").getTime();
const SERVICE_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "external_identity_risk_test",
  internalServiceCapability: "internal.eligibility"
};

function device(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(NOW);
  return devices.pair({
    pairingCode: pairing.code,
    extensionVersion: "0.54.0",
    capabilities: { observerRecipeShadow: true, observerRecipePackagedOracle: true }
  }, NOW + 1);
}

function eligibility(deviceId: string, overrides: Partial<ObserverRecipeContributorEligibilityInput> = {}): ObserverRecipeContributorEligibilityInput {
  return {
    contractVersion: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION,
    deviceId,
    contributorRefHash: "a".repeat(64),
    regionScope: "subdivision:US-CA",
    accountEligible: true,
    deviceEligible: true,
    regionEligible: true,
    proofHash: "b".repeat(64),
    source: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE,
    attestedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    ...overrides
  };
}

test("only a trusted service can replace bounded current contributor eligibility", () => {
  const db = new YoinkDatabase();
  try {
    const paired = device(db);
    const repository = new ObserverRecipeContributorEligibilityRepository(db);
    const input = eligibility(paired.id);
    assert.throws(() => repository.attest(input, NOW), /identity-risk service scope/);
    assert.throws(() => runWithRequestScope({
      ...SERVICE_SCOPE,
      actorId: "delivery_worker",
      internalServiceCapability: "internal.delivery"
    }, () => repository.attest(input, NOW)), /internal\.eligibility/);
    assert.throws(() => runWithRequestScope(SERVICE_SCOPE, () => repository.attest({
      ...input,
      rawAccountEmail: "must-not-enter-the-contract@example.test"
    } as unknown as ObserverRecipeContributorEligibilityInput, NOW)), /valid contributor eligibility attestation/);
    assert.throws(() => runWithRequestScope(SERVICE_SCOPE, () => repository.attest({
      ...input,
      deviceId: ` ${paired.id}`
    }, NOW)), /invalid pseudonym, proof, device, or coarse region/);
    assert.throws(() => runWithRequestScope({
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID,
      actorKind: "device",
      actorId: paired.id
    }, () => repository.attest(input, NOW)), /identity-risk service scope/);

    const accepted = runWithRequestScope(SERVICE_SCOPE, () => repository.attest(input, NOW));
    assert.equal(accepted.state, "externally_attested");
    assert.equal(accepted.regionScope, "subdivision:US-CA");
    assert.equal(accepted.rawAccountIdentifierStored, false);
    assert.equal(accepted.rawRiskPayloadStored, false);
    assert.equal(accepted.applicationAffected, false);
    assert.equal(accepted.mutationCapable, false);

    const snapshot = runWithRequestScope(SERVICE_SCOPE, () => repository.snapshotForDevice(paired.id, NOW + 1));
    assert.deepEqual(snapshot, {
      policyVersion: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION,
      state: "externally_attested",
      contributorRefHash: "a".repeat(64),
      regionScope: "subdivision:US-CA",
      proofHash: "b".repeat(64),
      expiresAt: new Date(NOW + 60 * 60_000).toISOString()
    });
    const replay = runWithRequestScope(SERVICE_SCOPE, () => repository.attest(input, NOW + 1));
    assert.deepEqual(replay, accepted);
    assert.equal(db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE event_type = 'observer_recipe_contributor_eligibility_attested'`
    )?.count, 1);

    const adminStatus = runWithRequestScope(SERVICE_SCOPE, () => repository.status(20, false, NOW + 1));
    const adminJson = JSON.stringify(adminStatus);
    assert.doesNotMatch(adminJson, /subdivision:US-CA/);
    assert.doesNotMatch(adminJson, new RegExp("a{64}|b{64}"));
    assert.equal(adminStatus.externallyAttestedDeviceCount, 1);
    assert.equal(adminStatus.distinctExternallyAttestedAccounts, 1);
    assert.equal(adminStatus.distinctExternallyAttestedRegions, 1);
    const ownerStatus = runWithRequestScope(SERVICE_SCOPE, () => repository.status(20, true, NOW + 1));
    assert.match(JSON.stringify(ownerStatus), /subdivision:US-CA/);

    assert.throws(() => runWithRequestScope(SERVICE_SCOPE, () => repository.attest(eligibility(paired.id, {
      attestedAt: new Date(NOW - 1).toISOString(),
      expiresAt: new Date(NOW + 30 * 60_000).toISOString()
    }), NOW + 2)), /older attestation/);
    assert.throws(() => runWithRequestScope(SERVICE_SCOPE, () => repository.attest(eligibility(paired.id, {
      proofHash: "c".repeat(64)
    }), NOW + 2)), /same time/);
    assert.throws(() => runWithRequestScope(SERVICE_SCOPE, () => repository.attest(eligibility(paired.id, {
      expiresAt: new Date(NOW + 24 * 60 * 60_000 + 1).toISOString()
    }), NOW)), /within 24 hours/);

    const replaced = runWithRequestScope(SERVICE_SCOPE, () => repository.attest(eligibility(paired.id, {
      accountEligible: false,
      proofHash: "d".repeat(64),
      attestedAt: new Date(NOW + 1_000).toISOString(),
      expiresAt: new Date(NOW + 30 * 60_000).toISOString()
    }), NOW + 1_000));
    assert.equal(replaced.state, "attested_ineligible");
    assert.equal(runWithRequestScope(SERVICE_SCOPE, () => repository.snapshotForDevice(paired.id, NOW + 1_001)).state, "unverified");
    assert.throws(() => db.run(
      `UPDATE observer_recipe_contributor_eligibility_states SET account_eligible = 1
       WHERE tenant_id = ? AND user_id = ? AND device_id = ?`,
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      paired.id
    ), /advance monotonically/);
    assert.throws(() => db.run(
      `DELETE FROM observer_recipe_contributor_eligibility_states
       WHERE tenant_id = ? AND user_id = ? AND device_id = ?`,
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      paired.id
    ), /service-managed/);
  } finally {
    db.close();
  }
});
