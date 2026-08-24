import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  CATALOG_IDENTITY_APPROVAL_CONFIRMATION,
  CATALOG_IDENTITY_OPERATION_CONFIRMATION
} from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const AT = "2026-08-24T22:00:00.000Z";

test("catalog identity HTTP operations are reviewed, reversible records with immutable history", async () => {
  const db = new YoinkDatabase();
  db.exec(`
    INSERT INTO product_families(id, title, brand, created_at, updated_at)
    VALUES ('family_identity_api', 'API split product', 'Example', '${AT}', '${AT}');
    INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
    VALUES ('variant_identity_api', 'family_identity_api', 'API split product', '{"edition":"Standard"}', '${AT}', '${AT}');
    INSERT INTO listings(id, variant_id, retailer_id, retailer_sku, canonical_url, status, execution_supported, currency, created_at, updated_at)
    VALUES ('listing_identity_api_selected', 'variant_identity_api', 'target', '93456781', 'https://www.target.com/p/-/A-93456781', 'out_of_stock', 0, 'USD', '${AT}', '${AT}'),
           ('listing_identity_api_retained', 'variant_identity_api', 'walmart', '93456782', 'https://www.walmart.com/ip/93456782', 'out_of_stock', 0, 'USD', '${AT}', '${AT}');
  `);
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "catalog-identity-api-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const mutationHeaders = { "Content-Type": "application/json", Origin: baseUrl };
  try {
    const invalid = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations`, {
      method: "POST",
      headers: { ...mutationHeaders, "X-Request-ID": "identity_api_invalid_001" },
      body: JSON.stringify({ kind: "split_variant" })
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      error: "catalog_identity_confirmation_required",
      message: "Explicit catalog identity proposal confirmation is required.",
      correlationId: "identity_api_invalid_001"
    });

    const proposedResponse = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        kind: "split_variant",
        sourceVariantId: "variant_identity_api",
        listingIds: ["listing_identity_api_selected"],
        newTitle: "API split product — Collector",
        newBrand: "Example",
        newVariantAttributes: { edition: "Collector" },
        reasonCode: "incorrect_variant_grouping",
        confirmation: CATALOG_IDENTITY_OPERATION_CONFIRMATION
      })
    });
    assert.equal(proposedResponse.status, 201);
    const proposed = await proposedResponse.json() as {
      disposition: string;
      operation: { id: string; status: string; baseStateHash: string };
    };
    assert.equal(proposed.disposition, "created");
    assert.equal(proposed.operation.status, "pending");
    assert.match(proposed.operation.baseStateHash, /^[a-f0-9]{64}$/);

    const pendingList = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations?status=pending`).then((response) => response.json()) as {
      items: Array<{ id: string }>;
    };
    assert.deepEqual(pendingList.items.map((item) => item.id), [proposed.operation.id]);
    const invalidStatus = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations?status=unexpected`);
    assert.equal(invalidStatus.status, 400);
    assert.equal((await invalidStatus.json() as { error: string }).error, "catalog_identity_input_invalid");

    const decision = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations/${encodeURIComponent(proposed.operation.id)}/decision`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        outcome: "approve",
        note: "The exact listing represents a separately identified collector edition.",
        confirmation: CATALOG_IDENTITY_APPROVAL_CONFIRMATION
      })
    });
    assert.equal(decision.status, 200);
    const applied = await decision.json() as { operation: { status: string; result: { newVariantId: string } } };
    assert.equal(applied.operation.status, "applied");
    assert.match(applied.operation.result.newVariantId, /^variant_/);
    assert.equal(db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM listings WHERE id = 'listing_identity_api_selected'"
    )?.variantId, applied.operation.result.newVariantId);
    assert.equal(db.get<{ variantId: string }>(
      "SELECT variant_id AS variantId FROM listings WHERE id = 'listing_identity_api_retained'"
    )?.variantId, "variant_identity_api");

    const detailResponse = await fetch(`${baseUrl}/api/v1/admin/catalog/identity-operations/${encodeURIComponent(proposed.operation.id)}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as {
      operation: { status: string };
      snapshots: Array<{ phase: string; snapshotHash: string }>;
      events: Array<{ sequence: number; eventType: string }>;
    };
    assert.equal(detail.operation.status, "applied");
    assert.deepEqual(detail.snapshots.map((snapshot) => snapshot.phase).sort(), ["after", "before"]);
    assert.equal(detail.snapshots.every((snapshot) => /^[a-f0-9]{64}$/.test(snapshot.snapshotHash)), true);
    assert.deepEqual(detail.events.map((event) => event.sequence), [1, 2, 3]);
    assert.deepEqual(detail.events.map((event) => event.eventType), ["proposed", "approved", "applied"]);

    const snapshot = await fetch(`${baseUrl}/api/v1/admin/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      identityGovernance: Record<string, boolean>;
      catalogGovernance: { identityOperations: Array<{ id: string }> };
    };
    assert.equal(snapshot.counts.catalogIdentityOperations, 1);
    assert.equal(snapshot.counts.pendingCatalogIdentityOperations, 0);
    assert.equal(snapshot.counts.appliedCatalogIdentityOperations, 1);
    assert.equal(snapshot.identityGovernance.reversibleLocalCatalogOperations, true);
    assert.equal(snapshot.identityGovernance.hostedGlobalCatalogAuthority, false);
    assert.deepEqual(snapshot.catalogGovernance.identityOperations.map((operation) => operation.id), [proposed.operation.id]);
    db.assertIntegrity();
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
