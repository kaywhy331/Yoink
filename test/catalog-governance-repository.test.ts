import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVE_CATALOG_PROPOSAL_CONFIRMATION,
  CatalogGovernanceRepository,
  REJECT_CATALOG_PROPOSAL_CONFIRMATION
} from "../packages/database/src/catalog-governance-repository.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-24T13:00:00.000Z").getTime();
const USER_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "user",
  actorId: LOCAL_USER_ID
};

function listing(overrides: Record<string, unknown> = {}) {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "governed-product-1",
    sourceListingId: "governed-listing-1",
    title: "Governed exact product",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: "https://www.target.com/p/-/A-1011483414",
    listingStatus: "out_of_stock" as const,
    executionSupported: true,
    msrpCents: 1999,
    currency: "USD",
    observedAt: new Date(NOW).toISOString(),
    ...overrides
  };
}

test("catalog changes are normalized, deduplicated, reviewed, and only then applied", () => {
  const db = new YoinkDatabase();
  try {
    const governance = new CatalogGovernanceRepository(db);
    const proposed = governance.proposeListing({ ...listing(), rawDom: "DO_NOT_PERSIST" } as never, NOW);
    assert.equal(proposed.disposition, "created");
    assert.equal(proposed.proposal.status, "pending");
    assert.equal(JSON.stringify(proposed.proposal.payload).includes("DO_NOT_PERSIST"), false);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);

    const duplicate = governance.proposeListing(listing(), NOW);
    assert.equal(duplicate.disposition, "duplicate_pending");
    assert.equal(duplicate.proposal.id, proposed.proposal.id);

    const approved = governance.decide(proposed.proposal.id, {
      outcome: "approve",
      note: "Exact retailer and source identifiers verified.",
      confirmation: APPROVE_CATALOG_PROPOSAL_CONFIRMATION
    }, NOW + 1);
    assert.equal(approved.proposal.status, "approved");
    assert.equal(approved.application?.createdListing, true);
    assert.equal(approved.proposal.appliedListingId, approved.application?.listing.id);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 1);

    const replay = governance.decide(proposed.proposal.id, {
      outcome: "approve",
      confirmation: APPROVE_CATALOG_PROPOSAL_CONFIRMATION
    }, NOW + 2);
    assert.equal(replay.replayed, true);
    assert.equal(replay.application, null);

    const rejectedProposal = governance.proposeListing(listing({
      sourceProductId: "governed-product-2",
      sourceListingId: "governed-listing-2",
      retailerSku: "8888888888",
      canonicalUrl: "https://www.target.com/p/-/A-8888888888"
    }), NOW + 3);
    const rejected = governance.decide(rejectedProposal.proposal.id, {
      outcome: "reject",
      note: "The exact item identity could not be independently confirmed.",
      confirmation: REJECT_CATALOG_PROPOSAL_CONFIRMATION
    }, NOW + 4);
    assert.equal(rejected.proposal.status, "rejected");
    assert.equal(rejected.application, null);
    assert.equal(governance.counts().catalogProposals, 2);
    assert.equal(governance.counts().pendingCatalogProposals, 0);
  } finally {
    db.close();
  }
});

test("ordinary users may propose but cannot review catalog changes", () => {
  const db = new YoinkDatabase();
  try {
    const governance = new CatalogGovernanceRepository(db);
    runWithRequestScope(USER_SCOPE, () => {
      const proposal = governance.proposeListing(listing(), NOW).proposal;
      assert.equal(governance.listMine().length, 1);
      assert.throws(() => governance.listForReview(), /Permission catalog.review/);
      assert.throws(() => governance.decide(proposal.id, {
        outcome: "approve",
        confirmation: APPROVE_CATALOG_PROPOSAL_CONFIRMATION
      }), /Permission catalog.review/);
    });
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
      new AuthorizationRepository(db).grantRole(LOCAL_USER_ID, "catalog_curator", NOW + 1);
    });
    runWithRequestScope(USER_SCOPE, () => {
      assert.equal(governance.listForReview().length, 1);
    });
  } finally {
    db.close();
  }
});
