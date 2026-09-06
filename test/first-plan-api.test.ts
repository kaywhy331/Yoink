import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";

test("a reviewed reserve-adjusted first plan saves without Chrome; price and live gate changes invalidate its preview", async () => {
  const db = new YoinkDatabase();
  const listing = new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    sourceProductId: "first-plan", sourceListingId: "first-plan-target",
    title: "First plan product", retailerId: "target", retailerSku: "97000999",
    canonicalUrl: "https://www.target.com/p/-/A-97000999", listingStatus: "in_stock",
    executionSupported: true, observedPriceCents: 1999, currency: "USD"
  }).listing;
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "test" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(`${origin}/api/v1/user/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const draft = { contractVersion: 2, listingId: listing.id, targetQuantity: 1,
    maxUnitPriceCents: 1999, maxAllInCents: 1999, actionCeiling: "add_to_cart",
    sellerPolicy: "first_party_only", fulfillment: "shipping", substitutionPolicy: "exact_only",
    cooldownSeconds: 0, expiresAt: "", confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN" };
  try {
    const previewResponse = await post("purchase-intents/preflight", draft);
    assert.equal(previewResponse.status, 200);
    const { preflight } = await previewResponse.json() as any;
    assert.equal(preflight.cost.autoRaised, true);
    assert.ok(preflight.draft.maxAllInCents > draft.maxAllInCents);
    assert.equal(preflight.automationReadiness.readyForGuardedAdd, false);
    const reviewed = { ...preflight.draft, contractVersion: 2, confirmation: "CREATE_EXACT_PURCHASE_PLAN",
      preflightedAt: preflight.preflightedAt, preflightFingerprint: preflight.preflightFingerprint };
    const changedPrice = await post("purchase-intents", { ...reviewed, maxUnitPriceCents: 1998 });
    assert.equal(changedPrice.status, 409);
    assert.equal((await changedPrice.json() as any).error, "purchase_intent_preflight_required");
    const settings = db.get<any>("SELECT tax_bps FROM app_settings")!;
    db.run("UPDATE app_settings SET tax_bps = tax_bps + 100");
    assert.equal((await post("purchase-intents", reviewed)).status, 409);
    db.run("UPDATE app_settings SET tax_bps = ?", settings.tax_bps);
    const missingReview = await post("purchase-intents", { ...reviewed, confirmation: "" });
    assert.equal(missingReview.status, 400);
    const saved = await post("purchase-intents", reviewed);
    assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
    const result = await saved.json() as any;
    assert.equal(result.purchaseIntent.intentPolicy.maxAllInCents, preflight.draft.maxAllInCents);
    assert.equal(result.purchaseIntent.automationReadiness.readyForGuardedAdd, false);
    const overview = await (await fetch(`${origin}/api/v1/user/overview`)).json() as any;
    assert.equal(overview.setup.savedPlanCount, 1);
    assert.equal(overview.setup.readyForMonitoring, false);
    assert.equal(overview.counts.actions, 0);
    assert.equal(overview.settings.actionsPaused, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
