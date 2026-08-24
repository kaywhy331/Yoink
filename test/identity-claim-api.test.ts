import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("identity claim HTTP workflow stays same-origin, provenance-bearing, and non-remapping", async () => {
  const db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  const target = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "identity-api-target",
    sourceListingId: "identity-api-target-listing",
    title: "Identity API Exact Product",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: "https://www.target.com/p/-/A-1011483414",
    listingStatus: "unknown",
    executionSupported: true,
    msrpCents: 1999
  }).listing;
  const walmart = catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "identity-api-walmart",
    sourceListingId: "identity-api-walmart-listing",
    title: "Identity API Exact Product",
    retailerId: "walmart",
    retailerSku: "17354421975",
    canonicalUrl: "https://www.walmart.com/ip/17354421975",
    listingStatus: "unknown",
    executionSupported: false,
    msrpCents: 1999
  }).listing;
  const initialVariant = target.variantId;
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const created = await fetch(`${baseUrl}/api/v1/identity/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: 1,
        listingId: target.id,
        referenceListingId: walmart.id,
        identifierKind: "upc",
        identifierValue: "036000291452",
        attributes: { edition: "standard", condition: "new" },
        provenanceNote: "manual_catalog_review",
        confirmation: "PROPOSE_EXACT_PRODUCT_EQUIVALENCE",
        rawDom: "DO_NOT_STORE"
      })
    });
    assert.equal(created.status, 201);
    const claim = (await created.json() as { claim: Record<string, unknown> }).claim;
    assert.equal(claim.claimState, "pending_review");
    assert.equal(claim.claimedVariantId, walmart.variantId);
    assert.equal(db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM listings WHERE id = ?",
      target.id
    )?.variantId, initialVariant);

    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      identityGovernance: {
        catalogRemappingEnabled: boolean;
        claims: Array<Record<string, unknown>>;
        projections: Array<Record<string, unknown>>;
      };
    };
    assert.equal(snapshot.counts.identityClaims, 1);
    assert.equal(snapshot.identityGovernance.catalogRemappingEnabled, false);
    assert.equal(snapshot.identityGovernance.claims.length, 1);
    assert.equal(snapshot.identityGovernance.projections[0]?.siblingAvailabilityEligible, false);
    assert.equal(JSON.stringify(snapshot).includes("DO_NOT_STORE"), false);

    const review = await fetch(`${baseUrl}/api/v1/identity/claims/${encodeURIComponent(String(claim.id))}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        outcome: "reviewed",
        note: "exact_identifier_checked",
        confirmation: "REVIEW_IDENTITY_CLAIM_WITHOUT_REMAP"
      })
    });
    assert.equal(review.status, 200);
    assert.equal((await review.json() as { claim: { claimState: string } }).claim.claimState, "reviewed");
    assert.equal(db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM listings WHERE id = ?",
      target.id
    )?.variantId, initialVariant);

    const deleted = await fetch(`${baseUrl}/api/v1/identity/claims`, {
      method: "DELETE",
      headers: { Origin: baseUrl }
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deletedClaims: 1, deletedReviews: 1 });
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
