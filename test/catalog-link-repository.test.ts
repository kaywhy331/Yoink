import assert from "node:assert/strict";
import test from "node:test";
import {
  CatalogLinkRepository,
  PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION
} from "../packages/database/src/catalog-link-repository.js";
import {
  APPROVE_CATALOG_PROPOSAL_CONFIRMATION,
  CatalogGovernanceRepository
} from "../packages/database/src/catalog-governance-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import {
  HOSTED_PRINCIPAL_CONFIRMATION,
  PrincipalRepository
} from "../packages/database/src/principal-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-25T04:00:00.000Z").getTime();

test("a user product link creates only a normalized review proposal", () => {
  const db = new YoinkDatabase();
  try {
    const links = new CatalogLinkRepository(db);
    const preview = links.preview("https://www.walmart.com/ip/pins/20009805270?conditionGroupCode=4&private=discard");
    assert.deepEqual(preview, {
      retailerId: "walmart",
      retailerName: "Walmart",
      retailerSku: "20009805270",
      canonicalUrl: "https://www.walmart.com/ip/20009805270",
      postReviewCapability: "monitor_only",
      capabilityLabel: "Monitoring and notifications only unless this retailer's separate guarded lane is qualified later.",
      reviewRequired: true,
      stockEvidenceAccepted: false,
      purchasePlanCreated: false
    });

    const first = links.propose({
      url: "https://www.walmart.com/ip/pins/20009805270?conditionGroupCode=4&private=discard",
      title: "  99 Nights in the Forest Collectible Pins  ",
      confirmation: PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION
    }, NOW);
    assert.equal(first.disposition, "created");
    assert.equal(first.proposal.status, "pending");
    assert.equal(first.proposal.payload.title, "99 Nights in the Forest Collectible Pins");
    assert.equal(first.proposal.payload.canonicalUrl, "https://www.walmart.com/ip/20009805270");
    assert.equal(first.proposal.payload.source, "user_link");
    assert.equal(first.proposal.payload.listingStatus, "unknown");
    assert.equal(first.proposal.payload.observedPriceCents, null);
    assert.equal(first.proposal.payload.msrpCents, null);
    assert.equal(first.proposal.payload.executionSupported, true);
    assert.equal(JSON.stringify(first.proposal).includes("private=discard"), false);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM offer_observations")?.count, 0);
    assert.deepEqual({ ...db.get<Record<string, unknown>>(
      `SELECT source, name, status, trust_level AS trustLevel,
              auto_create_missions AS autoCreateMissions, is_private AS isPrivate
       FROM source_connections WHERE id = 'source_user_link_local'`
    ) }, {
      source: "user_link",
      name: "Product links",
      status: "manual",
      trustLevel: "informational",
      autoCreateMissions: 0,
      isPrivate: 1
    });

    const duplicate = links.propose({
      url: "https://www.walmart.com/ip/20009805270",
      title: "99 Nights in the Forest Collectible Pins",
      confirmation: PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION
    }, NOW);
    assert.equal(duplicate.disposition, "duplicate_pending");
    assert.equal(duplicate.proposal.id, first.proposal.id);

    assert.throws(() => new CatalogGovernanceRepository(db).proposeListing({
      ...first.proposal.payload,
      sourceProductId: "forged_user_link_stock_claim",
      sourceListingId: "forged_user_link_stock_claim",
      listingStatus: "in_stock",
      observedPriceCents: 798
    }, NOW), /cannot assert availability or price evidence/);

    const approved = new CatalogGovernanceRepository(db).decide(first.proposal.id, {
      outcome: "approve",
      note: "Exact Walmart item ID independently verified.",
      confirmation: APPROVE_CATALOG_PROPOSAL_CONFIRMATION
    }, NOW + 1);
    assert.equal(approved.application?.listing.retailerSku, "20009805270");
    assert.equal(approved.application?.listing.executionSupported, false);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM offer_observations")?.count, 0);
  } finally {
    db.close();
  }
});

test("link intake fails closed before creating provenance and preserves tenant ownership", () => {
  const db = new YoinkDatabase();
  try {
    const links = new CatalogLinkRepository(db);
    assert.throws(() => links.propose({
      url: "https://www.walmart.com/shop/collectibles/draw",
      title: "Not an exact item",
      confirmation: PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION
    }, NOW), /exact item ID/);
    assert.throws(() => links.propose({
      url: "https://www.amazon.com/dp/B0DCGQ6CJD",
      title: "Card Game",
      confirmation: "WRONG"
    } as never, NOW), /Confirm that this is the exact product page/);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM source_connections WHERE source = 'user_link'"
    )?.count, 0);

    const serviceScope: RequestScope = {
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID,
      actorKind: "service",
      actorId: "identity_sync",
      internalServiceCapability: "internal.principal"
    };
    const secondScope: RequestScope = {
      tenantId: "tenant_link_second",
      userId: "user_link_second",
      actorKind: "user",
      actorId: "user_link_second"
    };
    runWithRequestScope(serviceScope, () => new PrincipalRepository(db).provision({
      tenantId: secondScope.tenantId,
      userId: secondScope.userId,
      tenantName: "Second link tenant",
      displayName: "Second link user",
      confirmation: HOSTED_PRINCIPAL_CONFIRMATION
    }, NOW));
    const second = runWithRequestScope(secondScope, () => links.propose({
      url: "https://p-bandai.com/us/item/N2884150001?discard=1",
      title: "Premium Bandai preorder",
      confirmation: PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION
    }, NOW + 1));
    assert.equal(second.proposal.tenantId, secondScope.tenantId);
    assert.equal(second.proposal.proposerUserId, secondScope.userId);
    assert.notEqual(second.proposal.payload.sourceConnectionId, "source_user_link_local");
    assert.equal(db.get<{ userId: string }>(
      "SELECT user_id AS userId FROM source_connections WHERE id = ?",
      second.proposal.payload.sourceConnectionId
    )?.userId, secondScope.userId);
    assert.equal(runWithRequestScope(LOCAL_REQUEST_SCOPE, () => new CatalogGovernanceRepository(db).listMine()).length, 0);
  } finally {
    db.close();
  }
});
