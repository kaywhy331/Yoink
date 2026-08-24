import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY_CLAIM_CONFIRMATION,
  IDENTITY_CLAIM_CONTRACT_VERSION,
  IDENTITY_CLAIM_REVIEW_CONFIRMATION,
  type IdentityClaimInput
} from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { IdentityClaimRepository } from "../packages/database/src/identity-claim-repository.js";
import { newId } from "../packages/domain/src/ids.js";

const NOW = new Date("2026-08-24T03:00:00.000Z").getTime();

function twoListings(db: YoinkDatabase) {
  const catalog = new CatalogRepository(db);
  const target = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "identity-product-target",
    sourceListingId: "identity-listing-target",
    title: "Exact Collectible Card Blue Edition",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: "https://www.target.com/p/-/A-1011483414",
    listingStatus: "in_stock",
    executionSupported: true,
    msrpCents: 1999,
    currency: "USD",
    variantAttributes: { color: "blue", edition: "standard" }
  }, NOW);
  const walmart = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "identity-product-walmart",
    sourceListingId: "identity-listing-walmart",
    title: "Exact Collectible Card Blue Edition",
    retailerId: "walmart",
    retailerSku: "17354421975",
    canonicalUrl: "https://www.walmart.com/ip/17354421975",
    listingStatus: "in_stock",
    executionSupported: false,
    msrpCents: 1999,
    currency: "USD",
    variantAttributes: { color: "blue", edition: "standard" }
  }, NOW + 1_000);
  return { target: target.listing, walmart: walmart.listing };
}

function claimInput(listingId: string, referenceListingId: string): IdentityClaimInput {
  return {
    contractVersion: IDENTITY_CLAIM_CONTRACT_VERSION,
    listingId,
    referenceListingId,
    identifierKind: "upc" as const,
    identifierValue: "036000291452",
    attributes: { color: "Blue", edition: "Standard", packCount: 1, condition: "new" as const },
    provenanceNote: "manual_catalog_review",
    confirmation: IDENTITY_CLAIM_CONFIRMATION
  };
}

test("an exact-identifier claim records provenance but cannot remap catalog identity or reach local quorum", () => {
  const db = new YoinkDatabase();
  try {
    const listings = twoListings(db);
    const repository = new IdentityClaimRepository(db);
    const before = db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM listings WHERE id = ?",
      listings.target.id
    )?.variantId;
    const claim = repository.create(claimInput(listings.target.id, listings.walmart.id), NOW + 2_000);
    assert.equal(claim.claimState, "pending_review");
    assert.equal(claim.currentVariantId, before);
    assert.equal(claim.claimedVariantId, listings.walmart.variantId);
    assert.notEqual(claim.currentVariantId, claim.claimedVariantId);
    assert.deepEqual(claim.attributes, { color: "blue", edition: "standard", packCount: 1, condition: "new" });
    assert.equal(db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM listings WHERE id = ?",
      listings.target.id
    )?.variantId, before);
    assert.equal(repository.projections(NOW + 3_000)[0]?.publicationState, "insufficient_quorum");
    assert.equal(repository.projections(NOW + 3_000)[0]?.siblingAvailabilityEligible, false);

    const reviewed = repository.review(String(claim.id), {
      outcome: "reviewed",
      note: "exact_identifier_checked",
      confirmation: IDENTITY_CLAIM_REVIEW_CONFIRMATION
    }, NOW + 4_000);
    assert.equal(reviewed.claimState, "reviewed");
    assert.equal(repository.projections(NOW + 5_000)[0]?.publicationState, "reviewed_insufficient_quorum");
    assert.equal(repository.projections(NOW + 5_000)[0]?.catalogRemapped, false);
    assert.equal(db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM listings WHERE id = ?",
      listings.target.id
    )?.variantId, before);
  } finally {
    db.close();
  }
});

test("identity claims reject weak identifiers, invalid check digits, same-store mappings, and arbitrary attributes", () => {
  const db = new YoinkDatabase();
  try {
    const listings = twoListings(db);
    const repository = new IdentityClaimRepository(db);
    assert.throws(() => repository.create({
      ...claimInput(listings.target.id, listings.walmart.id),
      identifierValue: "Exact Collectible Card Blue Edition"
    }, NOW + 2_000), /check digit/);
    assert.throws(() => repository.create({
      ...claimInput(listings.target.id, listings.walmart.id),
      identifierValue: "036000291453"
    }, NOW + 2_000), /check digit/);
    assert.throws(() => repository.create({
      ...claimInput(listings.target.id, listings.walmart.id),
      attributes: { imageUrl: "https://not-identity.example" }
    } as never, NOW + 2_000), /unsupported field/);

    const sameStore = new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "identity-product-target-two",
      sourceListingId: "identity-listing-target-two",
      title: "Another Target Product",
      retailerId: "target",
      retailerSku: "111111111",
      canonicalUrl: "https://www.target.com/p/-/A-111111111",
      listingStatus: "unknown",
      executionSupported: true,
      msrpCents: 1999
    }, NOW + 2_000).listing;
    assert.throws(() => repository.create(claimInput(listings.target.id, sameStore.id), NOW + 3_000), /different retailers/);
    assert.equal(repository.counts().identityClaims, 0);
  } finally {
    db.close();
  }
});

test("an identifier already mapped to another variant quarantines the claim and cannot be approved", () => {
  const db = new YoinkDatabase();
  try {
    const listings = twoListings(db);
    db.run(
      `INSERT INTO identifiers(id, variant_id, kind, value, retailer_id, verified, created_at)
       VALUES (?, ?, 'upc', '036000291452', NULL, 1, ?)`,
      newId("identifier"),
      listings.target.variantId,
      new Date(NOW + 2_000).toISOString()
    );
    const repository = new IdentityClaimRepository(db);
    const claim = repository.create(claimInput(listings.target.id, listings.walmart.id), NOW + 3_000);
    assert.equal(claim.claimState, "quarantined");
    assert.equal(claim.conflictReason, "identifier_maps_to_other_variant");
    assert.throws(() => repository.review(String(claim.id), {
      outcome: "reviewed",
      confirmation: IDENTITY_CLAIM_REVIEW_CONFIRMATION
    }, NOW + 4_000), /cannot be approved/);
    const rejected = repository.review(String(claim.id), {
      outcome: "rejected",
      note: "identifier_conflict_rejected",
      confirmation: IDENTITY_CLAIM_REVIEW_CONFIRMATION
    }, NOW + 5_000);
    assert.equal(rejected.claimState, "rejected");
    assert.equal(db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM listings WHERE id = ?",
      listings.target.id
    )?.variantId, listings.target.variantId);
  } finally {
    db.close();
  }
});

test("duplicate identity proposals deduplicate and physical deletion removes review history", () => {
  const db = new YoinkDatabase();
  try {
    const listings = twoListings(db);
    const repository = new IdentityClaimRepository(db);
    const first = repository.create(claimInput(listings.target.id, listings.walmart.id), NOW + 2_000);
    const duplicate = repository.create(claimInput(listings.target.id, listings.walmart.id), NOW + 3_000);
    assert.equal(duplicate.id, first.id);
    repository.review(String(first.id), {
      outcome: "reviewed",
      confirmation: IDENTITY_CLAIM_REVIEW_CONFIRMATION
    }, NOW + 4_000);
    assert.deepEqual(repository.deleteClaims(NOW + 5_000), { deletedClaims: 1, deletedReviews: 1 });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM identity_equivalence_claims")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM identity_claim_reviews")?.count, 0);
  } finally {
    db.close();
  }
});
