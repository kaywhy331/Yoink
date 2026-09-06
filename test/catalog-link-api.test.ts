import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION } from "../packages/database/src/catalog-link-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("exact product-link API previews identity and queues review without catalog mutation", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "0.32.0-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: Record<string, unknown>) => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(body)
  });
  try {
    const previewResponse = await post("/api/v1/user/catalog/link-preview", {
      url: "https://www.amazon.com/Card-Game/dp/B0DCGQ6CJD/ref=tracking"
    });
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers.get("x-yoink-api-surface"), "user");
    const preview = await previewResponse.json() as {
      preview: Record<string, unknown>;
    };
    assert.deepEqual(preview.preview, {
      retailerId: "amazon",
      retailerName: "Amazon",
      retailerSku: "B0DCGQ6CJD",
      canonicalUrl: "https://www.amazon.com/dp/B0DCGQ6CJD",
      postReviewCapability: "monitor_only",
      capabilityLabel: "Monitoring and notifications only unless this retailer's separate guarded lane is qualified later.",
      reviewRequired: true,
      stockEvidenceAccepted: false,
      purchasePlanCreated: false
    });

    const proposalResponse = await post("/api/v1/user/catalog/link-proposals", {
      url: "https://www.amazon.com/Card-Game/dp/B0DCGQ6CJD/ref=tracking",
      title: "Card Game Family Travel Kids",
      msrpCents: 2499,
      confirmation: PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION
    });
    assert.equal(proposalResponse.status, 202);
    const proposal = await proposalResponse.json() as {
      disposition: string;
      proposal: { status: string; payload: Record<string, unknown> };
    };
    assert.equal(proposal.disposition, "created");
    assert.equal(proposal.proposal.status, "pending");
    assert.equal(proposal.proposal.payload.canonicalUrl, "https://www.amazon.com/dp/B0DCGQ6CJD");
    assert.equal(proposal.proposal.payload.msrpCents, 2499);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM offer_observations")?.count, 0);

    const overview = await fetch(`${baseUrl}/api/v1/user/overview`).then((response) => response.json()) as {
      counts: { products: number; pendingCatalogProposals: number };
      setup: { level: string; companion: { downloadUrl: string }; steps: Array<{ id: string; summary: string }> };
    };
    assert.equal(overview.counts.products, 0);
    assert.equal(overview.counts.pendingCatalogProposals, 1);
    assert.equal(overview.setup.level, "product_in_review");
    assert.equal(overview.setup.companion.downloadUrl, "/api/v1/extension/release/download");
    assert.match(overview.setup.steps.find((step) => step.id === "product")?.summary ?? "", /waiting for independent catalog review/);

    const invalid = await post("/api/v1/user/catalog/link-preview", {
      url: "https://www.walmart.com/shop/collectibles/draw"
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { error: string }).error, "exact_product_link_invalid");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM catalog_change_proposals")?.count, 1);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
