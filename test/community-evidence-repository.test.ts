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
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";

const NOW = new Date("2026-08-24T00:00:00.000Z").getTime();

function pairedDevice(db: YoinkDatabase): { id: string; token: string } {
  const devices = new DeviceRepository(db);
  const code = devices.createPairingCode(NOW);
  return devices.pair({ pairingCode: code.code }, NOW + 1_000);
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
    ...overrides
  };
}

function amazonObservation(observedAt: number): RetailerShadowObservationInput {
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
    routeReasonCode: "offer_route_verified"
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

test("identical assertions deduplicate without reusing nonces or inflating community quorum", () => {
  const db = new YoinkDatabase();
  try {
    const device = pairedDevice(db);
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

    assert.equal(first.receipt.disposition, "accepted");
    assert.equal(second.receipt.disposition, "deduped");
    assert.equal(second.receipt.assertionId, first.receipt.assertionId);
    assert.equal(community.counts(NOW + 6_000).communityAssertions, 1);
    assert.equal(community.counts(NOW + 6_000).communityContributionReceipts, 2);
    const aggregate = community.aggregates(NOW + 6_000)[0];
    assert.equal(aggregate?.independentDeviceCount, 1);
    assert.equal(aggregate?.independentUserCount, 1);
    assert.equal(aggregate?.publicationState, "insufficient_quorum");
  } finally {
    db.close();
  }
});

test("material stock conflicts are quarantined and cannot publish a community state", () => {
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

    assert.equal(result.receipt.disposition, "quarantined");
    assert.equal(result.assertion.quarantineReason, "availability_conflict");
    const aggregate = community.aggregates(later + 3_000)[0];
    assert.equal(aggregate?.conflict, true);
    assert.equal(aggregate?.availability, "unknown");
    assert.equal(aggregate?.publicationState, "quarantined");
    assert.equal(aggregate?.confidence && (aggregate.confidence as Record<string, number>).availability, 0);
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
