import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_OBSERVER_VERSION,
  COMMUNITY_CONTRIBUTION_CONFIRMATION,
  COMMUNITY_EVIDENCE_CONTRACT_VERSION,
  COMMUNITY_PRIVACY_VERSION,
  TARGET_OBSERVER_VERSION,
  type RetailerAdapterDiagnosticInput,
  type RetailerShadowObservationInput,
  type TargetShadowObservationInput
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { CommunityEvidenceRepository } from "../packages/database/src/community-evidence-repository.js";
import {
  LOCAL_TENANT_ID,
  LOCAL_USER_ID,
  YoinkDatabase
} from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import {
  HOSTED_PRINCIPAL_CONFIRMATION,
  PrincipalRepository
} from "../packages/database/src/principal-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";

const NOW = new Date("2026-08-24T00:00:00.000Z").getTime();
const SERVICE_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "community_identity_sync",
  internalServiceCapability: "internal.principal"
};

function communityUserScope(userId: string): RequestScope {
  return {
    tenantId: LOCAL_TENANT_ID,
    userId,
    actorKind: "user",
    actorId: userId
  };
}

function provisionCommunityUser(db: YoinkDatabase, userId: string, now = NOW): RequestScope {
  const scope = communityUserScope(userId);
  runWithRequestScope(SERVICE_SCOPE, () => new PrincipalRepository(db).provision({
    tenantId: LOCAL_TENANT_ID,
    userId,
    tenantName: "Local tenant",
    displayName: userId,
    confirmation: HOSTED_PRINCIPAL_CONFIRMATION
  }, now));
  return scope;
}

function pairedDevice(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  return devices.pair({ pairingCode: code.code }, NOW + 1_000);
}

function pairedDeviceFor(db: YoinkDatabase, scope: RequestScope): { id: string; token: string } {
  return runWithRequestScope(scope, () => pairedDevice(db));
}

function targetObservation(
  observedAt: number,
  overrides: Partial<TargetShadowObservationInput> = {}
): TargetShadowObservationInput {
  return {
    adapterVersion: TARGET_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    pageKind: "product",
    retailerId: "target",
    retailerSku: "1011483414",
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
      childOfferKey: "1011483414",
      attributes: {}
    },
    ...overrides
  };
}

function amazonObservation(
  observedAt: number,
  overrides: Partial<RetailerShadowObservationInput> = {}
): RetailerShadowObservationInput {
  return {
    adapterVersion: AMAZON_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    pageKind: "product",
    retailerId: "amazon",
    retailerSku: "B002OB49L4",
    canonicalUrl: "https://www.amazon.com/dp/B002OB49L4?do-not-store=secret",
    availability: "in_stock",
    unitPriceCents: 1368,
    currency: "USD",
    sellerName: "Amazon.com",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: "",
    purchaseRouteKind: "amazon_buy_now",
    purchaseRouteReady: true,
    routeReasonCode: "offer_route_verified",
    selectedOffer: {
      schemaVersion: 1,
      selectionState: "exact",
      childOfferKey: "B002OB49L4",
      attributes: {}
    },
    ...overrides
  };
}

function amazonDiagnostic(observedAt: number): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    retailerId: "amazon",
    retailerSku: "B002OB49L4",
    adapterVersion: AMAZON_OBSERVER_VERSION,
    operation: "observe",
    outcome: "passed",
    failureStage: "complete",
    reasonCode: "verified",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "buybox",
      sellerShape: "offer_display_combined",
      fulfillmentShape: "shipping",
      addControlCount: 1,
      scopedControlCount: 1,
      explicitSkuInputCount: 2,
      exactSkuInputCount: 2,
      variationSkuCount: 0,
      canonicalOfferInputCount: 1,
      canonicalOfferDistinctCount: 1,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: 1,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: ""
    }
  };
}

function enable(
  repository: CommunityEvidenceRepository,
  retailerId: "target" | "amazon",
  locationScope = "country:US"
): void {
  repository.updateConsent({
    retailerId,
    enabled: true,
    locationScope,
    privacyVersion: COMMUNITY_PRIVACY_VERSION,
    confirmation: COMMUNITY_CONTRIBUTION_CONFIRMATION
  }, NOW + 1_500);
}

function enableFor(
  db: YoinkDatabase,
  scope: RequestScope,
  retailerId: "target" | "amazon",
  locationScope = "country:US"
): void {
  runWithRequestScope(scope, () => enable(new CommunityEvidenceRepository(db), retailerId, locationScope));
}

function contributeTargetFor(
  db: YoinkDatabase,
  scope: RequestScope,
  deviceId: string,
  observedAt: number,
  overrides: Partial<TargetShadowObservationInput> = {}
): { receipt: { disposition: string }; assertion: Record<string, unknown> } {
  return runWithRequestScope(scope, () => {
    const community = new CommunityEvidenceRepository(db);
    const shadow = new ShadowObservationRepository(db).record(
      deviceId,
      targetObservation(observedAt, overrides),
      observedAt + 500
    );
    const nonce = community.issueNonce(deviceId, "target", observedAt + 700);
    return community.contribute(deviceId, "target", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: nonce.nonce,
      shadowObservationId: shadow.id
    }, observedAt + 900);
  });
}

test("community evidence requires explicit per-retailer consent, a one-use nonce, and server-bound sanitized evidence", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const community = new CommunityEvidenceRepository(db);
    assert.throws(() => community.issueNonce(device.id, "amazon", NOW + 2_000), /Enable read-only evidence/);
    assert.throws(() => community.updateConsent({
      retailerId: "amazon",
      enabled: true,
      locationScope: "country:US",
      privacyVersion: COMMUNITY_PRIVACY_VERSION,
      confirmation: "wrong" as typeof COMMUNITY_CONTRIBUTION_CONFIRMATION
    }, NOW + 2_000), /explicitly accepted/);

    enable(community, "amazon");
    const observedAt = NOW + 2_000;
    const shadow = new ShadowObservationRepository(db).record(
      device.id,
      amazonObservation(observedAt),
      NOW + 3_000
    );
    const diagnostic = new AdapterDiagnosticRepository(db).record(
      device.id,
      amazonDiagnostic(observedAt),
      NOW + 3_000
    );
    const issued = community.issueNonce(device.id, "amazon", NOW + 4_000);
    const contribution = community.contribute(device.id, "amazon", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: issued.nonce,
      shadowObservationId: shadow.id,
      adapterDiagnosticId: diagnostic.id,
      rawDom: "DO_NOT_STORE",
      cookie: "DO_NOT_STORE"
    } as never, NOW + 4_500);

    assert.equal(contribution.receipt.disposition, "accepted");
    assert.equal(contribution.assertion.retailerSku, "B002OB49L4");
    assert.equal(contribution.assertion.unitPriceCents, 1368);
    assert.match(String(contribution.assertion.variantFingerprint), /^[a-f0-9]{64}$/);
    assert.deepEqual(contribution.assertion.selectedOffer, {
      selectionState: "exact",
      childOfferKey: "B002OB49L4",
      attributes: {},
      fingerprint: contribution.assertion.variantFingerprint
    });
    assert.throws(() => community.contribute(device.id, "amazon", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: issued.nonce,
      shadowObservationId: shadow.id,
      adapterDiagnosticId: diagnostic.id
    }, NOW + 5_000), /already used/);
    const durable = JSON.stringify(db.all("SELECT * FROM community_inventory_assertions"));
    assert.equal(durable.includes("DO_NOT_STORE"), false);
    assert.equal(durable.includes(device.token), false);
  } finally {
    db.close();
  }
});

test("selected variants remain isolated and listing-only evidence is quarantined", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const community = new CommunityEvidenceRepository(db);
    const shadows = new ShadowObservationRepository(db);
    const diagnostics = new AdapterDiagnosticRepository(db);
    enable(community, "amazon");

    const contribute = (
      observedAt: number,
      overrides: Partial<RetailerShadowObservationInput>
    ): { assertion: Record<string, unknown> } => {
      const shadow = shadows.record(device.id, amazonObservation(observedAt, overrides), observedAt + 500);
      const diagnostic = diagnostics.record(device.id, amazonDiagnostic(observedAt), observedAt + 500);
      const nonce = community.issueNonce(device.id, "amazon", observedAt + 700);
      return community.contribute(device.id, "amazon", {
        contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
        nonce: nonce.nonce,
        shadowObservationId: shadow.id,
        adapterDiagnosticId: diagnostic.id
      }, observedAt + 900);
    };

    const red = contribute(NOW + 2_000, {
      selectedOffer: {
        schemaVersion: 1,
        selectionState: "exact",
        childOfferKey: "B002OB49L4",
        attributes: { color: " Red " }
      }
    });
    const blue = contribute(NOW + 12_000, {
      availability: "out_of_stock",
      addControlActionable: false,
      selectedOffer: {
        schemaVersion: 1,
        selectionState: "exact",
        childOfferKey: "B002OB49L4",
        attributes: { color: "BLUE" }
      }
    });
    assert.equal(red.assertion.assertionState, "accepted");
    assert.equal(blue.assertion.assertionState, "accepted");
    assert.notEqual(red.assertion.variantFingerprint, blue.assertion.variantFingerprint);
    assert.notEqual(red.assertion.observationKey, blue.assertion.observationKey);

    const listingOnly = contribute(NOW + 22_000, {
      selectedOffer: {
        schemaVersion: 1,
        selectionState: "listing_only",
        childOfferKey: "B002OB49L4",
        attributes: {}
      }
    });
    assert.equal(listingOnly.assertion.assertionState, "quarantined");
    assert.equal(listingOnly.assertion.quarantineReason, "selected_offer_listing_only");
    const listingAggregate = community.aggregates(NOW + 23_000)
      .find((item) => item.observationKey === listingOnly.assertion.observationKey);
    assert.equal(listingAggregate?.publicationState, "quarantined");
    assert.equal((listingAggregate?.confidence as Record<string, number>).identity, 0);
  } finally {
    db.close();
  }
});

test("per-device dedupe and latest eligible selection prevent multi-device quorum inflation", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const secondDevice = pairedDevice(db);
    const community = new CommunityEvidenceRepository(db);
    enable(community, "target");
    const shadow = new ShadowObservationRepository(db).record(
      device.id,
      targetObservation(NOW + 2_000),
      NOW + 3_000
    );
    const firstNonce = community.issueNonce(device.id, "target", NOW + 4_000);
    const first = community.contribute(device.id, "target", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: firstNonce.nonce,
      shadowObservationId: shadow.id
    }, NOW + 4_500);
    const secondNonce = community.issueNonce(device.id, "target", NOW + 5_000);
    const second = community.contribute(device.id, "target", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: secondNonce.nonce,
      shadowObservationId: shadow.id
    }, NOW + 5_500);
    const secondDeviceShadow = new ShadowObservationRepository(db).record(
      secondDevice.id,
      targetObservation(NOW + 2_500, { unitPriceCents: 6099 }),
      NOW + 3_500
    );
    const thirdNonce = community.issueNonce(secondDevice.id, "target", NOW + 5_600);
    const third = community.contribute(secondDevice.id, "target", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: thirdNonce.nonce,
      shadowObservationId: secondDeviceShadow.id
    }, NOW + 5_900);

    assert.equal(first.receipt.disposition, "accepted");
    assert.equal(second.receipt.disposition, "deduped");
    assert.equal(second.receipt.assertionId, first.receipt.assertionId);
    assert.equal(third.receipt.disposition, "accepted");
    assert.notEqual(third.receipt.assertionId, first.receipt.assertionId);
    assert.equal(community.counts(NOW + 6_000).communityAssertions, 2);
    assert.equal(community.counts(NOW + 6_000).communityContributionReceipts, 3);
    const aggregate = community.aggregates(NOW + 6_000)[0];
    assert.equal(aggregate?.independentDeviceCount, 1);
    assert.equal(aggregate?.independentUserCount, 1);
    assert.equal(aggregate?.currentContributorVoteCount, 1);
    assert.equal(aggregate?.supersededAssertionCount, 1);
    assert.equal(aggregate?.priceMinimumCents, 6099);
    assert.equal(aggregate?.publicationState, "insufficient_quorum");
    assert.equal(aggregate?.unitPriceCents, null);
    assert.equal(aggregate?.priceVoteCount, 1);
    assert.equal(aggregate?.priceQuorumMet, false);

    assert.equal(new DeviceRepository(db).revoke(secondDevice.id, NOW + 6_100), true);
    const afterRevocation = community.aggregates(NOW + 6_200)[0];
    assert.equal(afterRevocation?.currentContributorVoteCount, 1);
    assert.equal(afterRevocation?.eligibleAssertionCount, 1);
    assert.equal(afterRevocation?.ineligibleAssertionCount, 1);
    assert.equal(afterRevocation?.supersededAssertionCount, 0);
    assert.equal(afterRevocation?.priceMinimumCents, 5999);
  } finally {
    db.close();
  }
});

test("a contributor's latest eligible assertion supersedes their own stale stock state", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const community = new CommunityEvidenceRepository(db);
    enable(community, "target");
    const shadows = new ShadowObservationRepository(db);
    const first = shadows.record(device.id, targetObservation(NOW + 2_000), NOW + 3_000);
    const firstNonce = community.issueNonce(device.id, "target", NOW + 4_000);
    community.contribute(device.id, "target", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: firstNonce.nonce,
      shadowObservationId: first.id
    }, NOW + 4_500);

    const later = NOW + 70_000;
    const conflict = shadows.record(device.id, targetObservation(later, {
      availability: "out_of_stock",
      unitPriceCents: null,
      addControlActionable: false
    }), later + 1_000);
    const secondNonce = community.issueNonce(device.id, "target", later + 2_000);
    const result = community.contribute(device.id, "target", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: secondNonce.nonce,
      shadowObservationId: conflict.id
    }, later + 2_500);

    assert.equal(result.receipt.disposition, "accepted");
    assert.equal(result.assertion.quarantineReason, "");
    const aggregate = community.aggregates(later + 3_000)[0];
    assert.equal(aggregate?.conflict, false);
    assert.equal(aggregate?.availability, "out_of_stock");
    assert.equal(aggregate?.publicationState, "insufficient_quorum");
    assert.equal(aggregate?.assertionCount, 2);
    assert.equal(aggregate?.currentContributorVoteCount, 1);
    assert.equal(aggregate?.supersededAssertionCount, 1);
    assert.equal(aggregate?.contributorVotePolicy, "latest_eligible_per_user");
  } finally {
    db.close();
  }
});

test("one current vote per contributor reaches advisory quorum with a median price", () => {
  const db = new YoinkDatabase();
  try {
    const secondScope = provisionCommunityUser(db, "community_user_two");
    const thirdScope = provisionCommunityUser(db, "community_user_three", NOW + 1);
    const localFirstDevice = pairedDeviceFor(db, LOCAL_REQUEST_SCOPE);
    const localSecondDevice = pairedDeviceFor(db, LOCAL_REQUEST_SCOPE);
    const secondDevice = pairedDeviceFor(db, secondScope);
    const thirdDevice = pairedDeviceFor(db, thirdScope);
    enableFor(db, LOCAL_REQUEST_SCOPE, "target");
    enableFor(db, secondScope, "target");
    enableFor(db, thirdScope, "target");

    contributeTargetFor(db, LOCAL_REQUEST_SCOPE, localFirstDevice.id, NOW + 2_000, {
      unitPriceCents: 999
    });
    const currentLocal = contributeTargetFor(db, LOCAL_REQUEST_SCOPE, localSecondDevice.id, NOW + 72_000, {
      unitPriceCents: 5900
    });
    const second = contributeTargetFor(db, secondScope, secondDevice.id, NOW + 82_000, {
      unitPriceCents: 6000
    });
    const third = contributeTargetFor(db, thirdScope, thirdDevice.id, NOW + 92_000, {
      unitPriceCents: 6100
    });

    assert.equal(currentLocal.receipt.disposition, "accepted");
    assert.equal(second.receipt.disposition, "accepted");
    assert.equal(third.receipt.disposition, "accepted");
    const aggregate = runWithRequestScope(
      LOCAL_REQUEST_SCOPE,
      () => new CommunityEvidenceRepository(db).aggregates(NOW + 94_000)[0]
    );
    assert.equal(aggregate?.publicationState, "advisory");
    assert.equal(aggregate?.conflict, false);
    assert.equal(aggregate?.assertionCount, 4);
    assert.equal(aggregate?.eligibleAssertionCount, 4);
    assert.equal(aggregate?.currentContributorVoteCount, 3);
    assert.equal(aggregate?.supersededAssertionCount, 1);
    assert.equal(aggregate?.independentUserCount, 3);
    assert.equal(aggregate?.independentDeviceCount, 3);
    assert.equal(aggregate?.unitPriceCents, 6000);
    assert.equal(aggregate?.priceProjectionMethod, "median");
    assert.equal(aggregate?.priceVoteCount, 3);
    assert.equal(aggregate?.priceQuorumMet, true);
    assert.equal(aggregate?.priceMinimumCents, 5900);
    assert.equal(aggregate?.priceMaximumCents, 6100);
    assert.equal(aggregate?.priceSpreadCents, 200);
    assert.equal(aggregate?.advisoryOnly, true);
    assert.equal(aggregate?.mutationAuthority, false);
  } finally {
    db.close();
  }
});

test("independent current stock conflicts quarantine dynamically and recover after convergence", () => {
  const db = new YoinkDatabase();
  try {
    const secondScope = provisionCommunityUser(db, "conflict_user_two");
    const thirdScope = provisionCommunityUser(db, "conflict_user_three", NOW + 1);
    const localDevice = pairedDeviceFor(db, LOCAL_REQUEST_SCOPE);
    const secondDevice = pairedDeviceFor(db, secondScope);
    const thirdDevice = pairedDeviceFor(db, thirdScope);
    enableFor(db, LOCAL_REQUEST_SCOPE, "target");
    enableFor(db, secondScope, "target");
    enableFor(db, thirdScope, "target");

    contributeTargetFor(db, LOCAL_REQUEST_SCOPE, localDevice.id, NOW + 2_000);
    contributeTargetFor(db, secondScope, secondDevice.id, NOW + 12_000);
    const conflict = contributeTargetFor(db, thirdScope, thirdDevice.id, NOW + 22_000, {
      availability: "out_of_stock",
      unitPriceCents: null,
      addControlActionable: false
    });
    assert.equal(conflict.receipt.disposition, "quarantined");
    assert.equal(conflict.assertion.quarantineReason, "availability_conflict");

    const quarantined = runWithRequestScope(
      LOCAL_REQUEST_SCOPE,
      () => new CommunityEvidenceRepository(db).aggregates(NOW + 24_000)[0]
    );
    assert.equal(quarantined?.publicationState, "quarantined");
    assert.equal(quarantined?.availability, "unknown");
    assert.equal(quarantined?.currentContributorVoteCount, 3);

    const converged = contributeTargetFor(db, thirdScope, thirdDevice.id, NOW + 94_000);
    assert.equal(converged.receipt.disposition, "accepted");
    const recovered = runWithRequestScope(
      LOCAL_REQUEST_SCOPE,
      () => new CommunityEvidenceRepository(db).aggregates(NOW + 96_000)[0]
    );
    assert.equal(recovered?.publicationState, "advisory");
    assert.equal(recovered?.availability, "in_stock");
    assert.equal(recovered?.currentContributorVoteCount, 3);
    assert.equal(recovered?.supersededAssertionCount, 1);
  } finally {
    db.close();
  }
});

test("pickup evidence requires a one-way store scope and user deletion is physical", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
    const community = new CommunityEvidenceRepository(db);
    enable(community, "target");
    const shadow = new ShadowObservationRepository(db).record(device.id, targetObservation(NOW + 2_000, {
      fulfillment: "pickup"
    }), NOW + 3_000);
    const issued = community.issueNonce(device.id, "target", NOW + 4_000);
    assert.throws(() => community.contribute(device.id, "target", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: issued.nonce,
      shadowObservationId: shadow.id
    }, NOW + 4_500), /store fingerprint/);

    enable(community, "target", `store:${"a".repeat(64)}`);
    const accepted = community.contribute(device.id, "target", {
      contractVersion: COMMUNITY_EVIDENCE_CONTRACT_VERSION,
      nonce: issued.nonce,
      shadowObservationId: shadow.id
    }, NOW + 5_000);
    assert.equal(accepted.receipt.disposition, "accepted");
    assert.equal(accepted.assertion.locationScope, `store:${"a".repeat(64)}`);
    assert.deepEqual(community.deleteContributions("target", NOW + 6_000), {
      deletedAssertions: 1,
      deletedReceipts: 1
    });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM community_inventory_assertions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM community_contribution_receipts")?.count, 0);
    assert.equal(community.listRecent().length, 0);
  } finally {
    db.close();
  }
});
