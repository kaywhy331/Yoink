import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_IDENTITY_APPROVAL_CONFIRMATION,
  CATALOG_IDENTITY_OPERATION_CONFIRMATION,
  IDENTITY_CLAIM_CONFIRMATION,
  IDENTITY_CLAIM_CONTRACT_VERSION,
  IDENTITY_CLAIM_REVIEW_CONFIRMATION
} from "../packages/contracts/src/index.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import {
  CatalogIdentityGovernanceError,
  CatalogIdentityGovernanceRepository
} from "../packages/database/src/catalog-identity-governance-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { IdentityClaimRepository } from "../packages/database/src/identity-claim-repository.js";
import {
  HOSTED_PRINCIPAL_CONFIRMATION,
  PrincipalRepository
} from "../packages/database/src/principal-repository.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-24T20:00:00.000Z").getTime();
const AT = new Date(NOW).toISOString();
const SECOND_CURATOR: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: "user_catalog_curator_two",
  actorKind: "user",
  actorId: "catalog_curator_two"
};

function addSecondCurator(db: YoinkDatabase): void {
  db.run(
    "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
    SECOND_CURATOR.userId,
    LOCAL_TENANT_ID,
    "Second catalog curator",
    AT
  );
  new AuthorizationRepository(db).grantRole(SECOND_CURATOR.userId, "catalog_curator", NOW + 1);
}

function seedMergePair(db: YoinkDatabase): { source: string; target: string; sourceListing: string; targetListing: string; claimId: string } {
  const source = "variant_merge_source";
  const target = "variant_merge_target";
  const sourceListing = "listing_merge_source";
  const targetListing = "listing_merge_target";
  db.exec(`
    INSERT INTO product_families(id, title, brand, created_at, updated_at)
    VALUES ('family_merge_source', 'Exact product', 'Example', '${AT}', '${AT}'),
           ('family_merge_target', 'Exact product', 'Example', '${AT}', '${AT}');
    INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
    VALUES ('${source}', 'family_merge_source', 'Exact product', '{"edition":"Standard"}', '${AT}', '${AT}'),
           ('${target}', 'family_merge_target', 'Exact product', '{"edition":"Standard"}', '${AT}', '${AT}');
    INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, currency, created_at, updated_at)
    VALUES ('${sourceListing}', '${source}', 'target', '99110011', 'https://www.target.com/p/-/A-99110011', 'out_of_stock', 0, 'USD', '${AT}', '${AT}'),
           ('${targetListing}', '${target}', 'walmart', '99110022', 'https://www.walmart.com/ip/99110022', 'out_of_stock', 0, 'USD', '${AT}', '${AT}');
    INSERT INTO identifiers(id, variant_id, kind, value, verified, created_at)
    VALUES ('identifier_merge_source', '${source}', 'internal_exact', 'merge-source-proof', 1, '${AT}');
    INSERT INTO source_product_refs(id, source_connection_id, external_product_id, variant_id, source_url, source_title, observed_at)
    VALUES ('source_product_merge', 'source_trackalacker_local', 'merge-product', '${source}', '', 'Exact product', '${AT}');
    INSERT INTO source_product_aliases(id, source_connection_id, alias_kind, alias_value, variant_id, observed_at)
    VALUES ('source_alias_merge', 'source_trackalacker_local', 'slug', 'merge-product', '${source}', '${AT}');
    INSERT INTO source_listing_candidates(id, source_connection_id, external_product_id, external_listing_id, variant_id, store_name, retailer_id, retailer_sku, source_url, observed_at, updated_at)
    VALUES ('source_candidate_merge', 'source_trackalacker_local', 'merge-product', 'merge-listing', '${source}', 'Target', 'target', '99110011', '', '${AT}', '${AT}');
    INSERT INTO source_variant_retailer_refs(source_connection_id, variant_id, retailer_id, listing_id, observed_at)
    VALUES ('source_trackalacker_local', '${source}', 'target', '${sourceListing}', '${AT}');
    INSERT INTO missions(id, tenant_id, user_id, variant_id, status, origin, target_quantity, fulfilled_quantity, created_at, updated_at)
    VALUES ('mission_merge_source', '${LOCAL_TENANT_ID}', '${LOCAL_USER_ID}', '${source}', 'active', 'fixture', 1, 0, '${AT}', '${AT}');
    INSERT INTO mission_targets(id, mission_id, listing_id, enabled, currency, seller_policy, fulfillment, created_at, updated_at)
    VALUES ('mission_target_merge_source', 'mission_merge_source', '${sourceListing}', 1, 'USD', 'inherit', 'inherit', '${AT}', '${AT}');
  `);
  const identities = new IdentityClaimRepository(db);
  const claim = identities.create({
    contractVersion: IDENTITY_CLAIM_CONTRACT_VERSION,
    listingId: sourceListing,
    referenceListingId: targetListing,
    identifierKind: "upc",
    identifierValue: "036000291452",
    attributes: { edition: "Standard" },
    provenanceNote: "independent_exact_identifier",
    confirmation: IDENTITY_CLAIM_CONFIRMATION
  }, NOW + 2) as { id: string };
  identities.review(claim.id, {
    outcome: "reviewed",
    note: "exact_identifier_verified",
    confirmation: IDENTITY_CLAIM_REVIEW_CONFIRMATION
  }, NOW + 3);
  return { source, target, sourceListing, targetListing, claimId: claim.id };
}

function seedSplitVariant(db: YoinkDatabase, suffix = ""): {
  source: string;
  selectedListing: string;
  retainedListing: string;
  missionId: string;
} {
  const source = `variant_split_source${suffix}`;
  const family = `family_split_source${suffix}`;
  const selectedListing = `listing_split_selected${suffix}`;
  const retainedListing = `listing_split_retained${suffix}`;
  const missionId = `mission_split${suffix}`;
  db.run("INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", family, "Split product", "Example", AT, AT);
  db.run(
    "INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    source,
    family,
    "Split product",
    JSON.stringify({ edition: "Standard" }),
    AT,
    AT
  );
  db.run(
    `INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, currency, created_at, updated_at)
     VALUES (?, ?, 'target', ?, ?, 'out_of_stock', 0, 'USD', ?, ?)`,
    selectedListing,
    source,
    `77220011${suffix}`,
    `https://www.target.com/p/-/A-77220011${suffix}`,
    AT,
    AT
  );
  db.run(
    `INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, currency, created_at, updated_at)
     VALUES (?, ?, 'walmart', ?, ?, 'out_of_stock', 0, 'USD', ?, ?)`,
    retainedListing,
    source,
    `77220022${suffix}`,
    `https://www.walmart.com/ip/77220022${suffix}`,
    AT,
    AT
  );
  db.run(
    `INSERT INTO source_product_refs(id, source_connection_id, external_product_id, variant_id, source_url, source_title, observed_at)
     VALUES (?, 'source_trackalacker_local', ?, ?, '', 'Split product', ?)`,
    `source_product_split${suffix}`,
    `split-product${suffix}`,
    source,
    AT
  );
  db.run(
    `INSERT INTO source_listing_candidates(id, source_connection_id, external_product_id, external_listing_id, variant_id, store_name, retailer_id, retailer_sku, source_url, observed_at, updated_at)
     VALUES (?, 'source_trackalacker_local', ?, ?, ?, 'Target', 'target', ?, '', ?, ?)`,
    `source_candidate_split${suffix}`,
    `split-product${suffix}`,
    `split-listing${suffix}`,
    source,
    `77220011${suffix}`,
    AT,
    AT
  );
  db.run(
    `INSERT INTO source_variant_retailer_refs(source_connection_id, variant_id, retailer_id, listing_id, observed_at)
     VALUES ('source_trackalacker_local', ?, 'target', ?, ?)`,
    source,
    selectedListing,
    AT
  );
  db.run(
    `INSERT INTO missions(id, tenant_id, user_id, variant_id, status, origin, target_quantity, fulfilled_quantity, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', 'fixture', 1, 0, ?, ?)`,
    missionId,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    source,
    AT,
    AT
  );
  db.run(
    `INSERT INTO mission_targets(id, mission_id, listing_id, enabled, currency, seller_policy, fulfillment, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'USD', 'inherit', 'inherit', ?, ?)`,
    `mission_target_split${suffix}`,
    missionId,
    selectedListing,
    AT,
    AT
  );
  return { source, selectedListing, retainedListing, missionId };
}

test("reviewed exact identity merge requires an independent approver and compensates exactly", () => {
  const db = new YoinkDatabase();
  try {
    const fixture = seedMergePair(db);
    addSecondCurator(db);
    const governance = new CatalogIdentityGovernanceRepository(db);
    const proposal = governance.propose({
      kind: "merge_variants",
      sourceVariantId: fixture.source,
      targetVariantId: fixture.target,
      reviewedIdentityClaimId: fixture.claimId,
      reasonCode: "reviewed_exact_identifier",
      confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
    }, NOW + 4).operation;
    assert.equal(proposal.requiresDistinctApprover, true);
    assert.throws(
      () => governance.decide(proposal.id, {
        outcome: "approve",
        note: "Same actor must not approve this merge.",
        confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
      }, NOW + 5),
      (error) => error instanceof CatalogIdentityGovernanceError
        && error.code === "catalog_identity_independent_approval_required"
    );

    const applied = runWithRequestScope(SECOND_CURATOR, () => governance.decide(proposal.id, {
      outcome: "approve",
      note: "Reviewed exact identifier and variant dimensions agree.",
      confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
    }, NOW + 6).operation);
    assert.equal(applied.status, "applied");
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM listings WHERE id = ?", fixture.sourceListing)?.variantId, fixture.target);
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM identifiers WHERE id = 'identifier_merge_source'")?.variantId, fixture.target);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM catalog_identity_operation_snapshots WHERE operation_id = ?", proposal.id)?.count, 2);
    assert.throws(() => db.run(
      "UPDATE catalog_identity_operation_snapshots SET snapshot_hash = 'tampered' WHERE operation_id = ?",
      proposal.id
    ), /immutable/);
    assert.throws(() => db.run(
      "UPDATE catalog_identity_operation_events SET sequence = 99 WHERE operation_id = ?",
      proposal.id
    ), /append-only/);
    assert.throws(() => db.run(
      "DELETE FROM catalog_identity_operation_events WHERE operation_id = ?",
      proposal.id
    ), /append-only/);

    const rollback = runWithRequestScope(SECOND_CURATOR, () => governance.propose({
      kind: "rollback",
      reversedOperationId: proposal.id,
      reasonCode: "compensating_exact_rollback",
      confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
    }, NOW + 7).operation);
    assert.equal(rollback.requiresDistinctApprover, false);
    runWithRequestScope(SECOND_CURATOR, () => governance.decide(rollback.id, {
      outcome: "approve",
      note: "Restore the immutable pre-merge topology.",
      confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
    }, NOW + 8));
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM listings WHERE id = ?", fixture.sourceListing)?.variantId, fixture.source);
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM identifiers WHERE id = 'identifier_merge_source'")?.variantId, fixture.source);
    assert.equal(governance.detail(proposal.id).operation instanceof Object, true);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("split moves only explicit identity rows and split rollback requires independent approval", () => {
  const db = new YoinkDatabase();
  try {
    const fixture = seedSplitVariant(db);
    addSecondCurator(db);
    const governance = new CatalogIdentityGovernanceRepository(db);
    const split = governance.propose({
      kind: "split_variant",
      sourceVariantId: fixture.source,
      listingIds: [fixture.selectedListing],
      newTitle: "Split product — Collector edition",
      newBrand: "Example",
      newVariantAttributes: { edition: "Collector" },
      reasonCode: "incorrect_variant_grouping",
      confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
    }, NOW + 10).operation;
    const applied = governance.decide(split.id, {
      outcome: "approve",
      note: "The selected listing is a distinct collector edition.",
      confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
    }, NOW + 11).operation;
    const newVariantId = String(applied.result.newVariantId);
    assert.match(newVariantId, /^variant_/);
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM listings WHERE id = ?", fixture.selectedListing)?.variantId, newVariantId);
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM listings WHERE id = ?", fixture.retainedListing)?.variantId, fixture.source);
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM missions WHERE id = ?", fixture.missionId)?.variantId, newVariantId);
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM source_listing_candidates WHERE id = 'source_candidate_split'")?.variantId, newVariantId);
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM source_product_refs WHERE id = 'source_product_split'")?.variantId, fixture.source);

    const rollback = governance.propose({
      kind: "rollback",
      reversedOperationId: split.id,
      reasonCode: "split_evidence_reversed",
      confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
    }, NOW + 12).operation;
    assert.equal(rollback.requiresDistinctApprover, true);
    assert.throws(() => governance.decide(rollback.id, {
      outcome: "approve",
      note: "Same user cannot expand equivalence again.",
      confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
    }, NOW + 13), /different authorized user/);
    runWithRequestScope(SECOND_CURATOR, () => governance.decide(rollback.id, {
      outcome: "approve",
      note: "Independent review confirms the compensating expansion.",
      confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
    }, NOW + 14));
    assert.equal(db.get<{ variantId: string }>("SELECT variant_id AS variantId FROM listings WHERE id = ?", fixture.selectedListing)?.variantId, fixture.source);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM variants WHERE id = ?", newVariantId)?.count, 0);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("stale topology and ambiguous purchase-intent splits fail closed", () => {
  const db = new YoinkDatabase();
  try {
    const fixture = seedSplitVariant(db, "_stale");
    db.run(
      `INSERT INTO mission_targets(id, mission_id, listing_id, enabled, currency, seller_policy, fulfillment, created_at, updated_at)
       VALUES ('mission_target_split_stale_retained', ?, ?, 1, 'USD', 'inherit', 'inherit', ?, ?)`,
      fixture.missionId,
      fixture.retainedListing,
      AT,
      AT
    );
    const governance = new CatalogIdentityGovernanceRepository(db);
    assert.throws(() => governance.propose({
      kind: "split_variant",
      sourceVariantId: fixture.source,
      listingIds: [fixture.selectedListing],
      newTitle: "Ambiguous split",
      newVariantAttributes: { edition: "Collector" },
      reasonCode: "ambiguous_intent_test",
      confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
    }, NOW + 20), /purchase intent spans listings/);

    db.run("DELETE FROM mission_targets WHERE id = 'mission_target_split_stale_retained'");
    const proposal = governance.propose({
      kind: "split_variant",
      sourceVariantId: fixture.source,
      listingIds: [fixture.selectedListing],
      newTitle: "Fresh split",
      newVariantAttributes: { edition: "Collector" },
      reasonCode: "topology_drift_test",
      confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
    }, NOW + 21).operation;
    db.run(
      `INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, currency, created_at, updated_at)
       VALUES ('listing_split_drift', ?, 'bestbuy', '66770099', 'https://www.bestbuy.com/site/-/66770099.p', 'unknown', 0, 'USD', ?, ?)`,
      fixture.source,
      AT,
      AT
    );
    assert.throws(() => governance.decide(proposal.id, {
      outcome: "approve",
      note: "This approval is based on stale topology.",
      confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
    }, NOW + 22), (error) => error instanceof CatalogIdentityGovernanceError
      && error.code === "catalog_identity_topology_stale");
  } finally {
    db.close();
  }
});

test("active purchase work blocks identity changes until the job reaches a safe terminal state", () => {
  const db = new YoinkDatabase();
  try {
    const fixture = seedSplitVariant(db, "_active");
    db.exec(`
      INSERT INTO signal_incidents(
        id, tenant_id, user_id, listing_id, event_type, semantic_key, status, currency,
        first_observed_at, last_observed_at, created_at, updated_at
      ) VALUES (
        'incident_identity_active', '${LOCAL_TENANT_ID}', '${LOCAL_USER_ID}',
        '${fixture.selectedListing}', 'restock',
        'identity-active-test', 'open', 'USD', '${AT}', '${AT}', '${AT}', '${AT}'
      );
      INSERT INTO action_jobs(
        id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
        state, action, quantity, currency, seller_policy, fulfillment,
        listing_id, canonical_url, idempotency_key, capability_nonce_hash,
        expires_at, created_at, updated_at
      ) VALUES (
        'job_identity_active', '${LOCAL_TENANT_ID}', '${LOCAL_USER_ID}', '${fixture.missionId}',
        'mission_target_split_active', 'incident_identity_active', 'shadow_ready',
        'add_to_cart', 1, 'USD', 'first_party_only', 'shipping',
        '${fixture.selectedListing}', 'https://www.target.com/p/-/A-77220011_active',
        'identity-active-job', 'no-capability', '2026-08-25T20:00:00.000Z', '${AT}', '${AT}'
      );
    `);
    const governance = new CatalogIdentityGovernanceRepository(db);
    const proposalInput: Parameters<typeof governance.propose>[0] = {
      kind: "split_variant",
      sourceVariantId: fixture.source,
      listingIds: [fixture.selectedListing],
      newTitle: "Active work split",
      newVariantAttributes: { edition: "Collector" },
      reasonCode: "active_work_test",
      confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
    };
    assert.throws(
      () => governance.propose(proposalInput, NOW + 25),
      (error) => error instanceof CatalogIdentityGovernanceError
        && error.code === "catalog_identity_active_work"
    );
    db.run("UPDATE action_jobs SET state = 'cancelled' WHERE id = 'job_identity_active'");
    assert.equal(governance.propose(proposalInput, NOW + 26).operation.status, "pending");
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("catalog identity application stays closed when shared catalog has multiple tenants", () => {
  const db = new YoinkDatabase();
  try {
    const fixture = seedSplitVariant(db, "_hosted");
    const governance = new CatalogIdentityGovernanceRepository(db);
    const proposal = governance.propose({
      kind: "split_variant",
      sourceVariantId: fixture.source,
      listingIds: [fixture.selectedListing],
      newTitle: "Hosted split",
      newVariantAttributes: { edition: "Collector" },
      reasonCode: "hosted_authority_test",
      confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
    }, NOW + 30).operation;
    runWithRequestScope({
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID,
      actorKind: "service",
      actorId: "identity_sync",
      internalServiceCapability: "internal.principal"
    }, () => new PrincipalRepository(db).provision({
      tenantId: "tenant_catalog_other",
      userId: "user_catalog_other",
      tenantName: "Other tenant",
      displayName: "Other user",
      confirmation: HOSTED_PRINCIPAL_CONFIRMATION
    }, NOW + 31));
    assert.throws(() => governance.decide(proposal.id, {
      outcome: "approve",
      note: "Tenant-local authority must not mutate a shared catalog.",
      confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
    }, NOW + 32), (error) => error instanceof CatalogIdentityGovernanceError
      && error.code === "catalog_identity_global_authority_required"
      && error.status === 403);
    assert.equal(db.get<{ status: string }>("SELECT status FROM catalog_identity_operations WHERE id = ?", proposal.id)?.status, "pending");
  } finally {
    db.close();
  }
});
