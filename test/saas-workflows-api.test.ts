import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { LOCAL_TENANT_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { PurchasePolicyRepository } from "../packages/database/src/purchase-policy-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { CatalogLinkRepository } from "../packages/database/src/catalog-link-repository.js";
import { CatalogGovernanceRepository } from "../packages/database/src/catalog-governance-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";

const foreign = { tenantId: "tenant_other", userId: "user_other", actorKind: "user" as const, actorId: "user_other" };
async function fixture() {
  const db = new YoinkDatabase();
  const control = new ControlRepository(db); const catalog = new CatalogRepository(db);
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "workflow-test" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown) => fetch(base + path, { method: body ? "POST" : "GET", headers: { Origin: base, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { db, control, catalog, request, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); } };
}
function seed(f: Awaited<ReturnType<typeof fixture>>, index: number, retailerId = "target") {
  if (retailerId === "audioadvice") f.db.run("UPDATE retailers SET execution_supported = 1 WHERE id = ?", retailerId);
  const sku = String((retailerId === "audioadvice" ? 41907724615764 : 98900000) + index);
  const listing = f.catalog.upsertListing({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker", sourceProductId: `workflow-${index}`, sourceListingId: `workflow-listing-${index}`, title: `Workflow product ${String(index).padStart(3, "0")}`, retailerId, retailerSku: sku, canonicalUrl: retailerId === "target" ? `https://www.target.com/p/-/A-${sku}` : retailerId === "audioadvice" ? `https://www.audioadvice.com/products/fixture?variant=${sku}` : `https://www.walmart.com/ip/${sku}`, listingStatus: "in_stock", executionSupported: true, observedPriceCents: 1999, msrpCents: 2499, currency: "USD" }).listing;
  return { listing, mission: f.control.ensureUserMission(listing.variantId, listing.id).mission };
}

test("plan filters apply before pages; reviewed bulk status changes preserve limits and skip stale, expired and foreign plans", async () => {
  const f = await fixture();
  try {
    const records = Array.from({ length: 65 }, (_, index) => seed(f, index, index % 2 ? "walmart" : "target"));
    const response = await f.request("/api/v1/user/purchase-intents?sort=title&action=notify&limit=50&offset=50");
    assert.equal(response.status, 200);
    const page = await response.json() as any;
    assert.equal(page.total, 65); assert.equal(page.items.length, 15); assert.equal(page.items[0].title, "Workflow product 050");
    assert.equal(page.stores.length, 2);
    const filtered = await (await f.request("/api/v1/user/purchase-intents?store=walmart&sort=title&limit=10&offset=20")).json() as any;
    assert.equal(filtered.total, 32); assert.equal(filtered.items[0].title, "Workflow product 041");
    assert.equal((await f.request("/api/v1/user/purchase-intents?status=unexpected")).status, 400);
    assert.equal((await f.request("/api/v1/user/purchase-intents?action=observe")).status, 400);
    const ids = records.slice(0, 3).map(item => item.mission.id);
    const before = f.control.missionDetail(ids[0]!) as any;
    const preview = await (await f.request("/api/v1/user/purchase-intents/status-preview", { ids, status: "paused" })).json() as any;
    f.db.run("UPDATE missions SET target_quantity = target_quantity + 1 WHERE id = ?", ids[1]!);
    const body = { items: preview.items, status: "paused", confirmation: "CHANGE_SELECTED_PLAN_STATUSES" };
    assert.equal((await f.request("/api/v1/user/purchase-intents/status", { ...body, confirmation: "" })).status, 400);
    const result = await (await f.request("/api/v1/user/purchase-intents/status", body)).json() as any;
    assert.deepEqual(result.items.map((item: any) => item.outcome), ["updated", "skipped", "updated"]);
    const after = f.control.missionDetail(ids[0]!) as any;
    assert.equal(after.status, "paused"); assert.equal(after.targetQuantity, before.targetQuantity);
    assert.equal(after.intentPolicy.actionCeiling, before.intentPolicy.actionCeiling);
    assert.equal(after.intentPolicy.maxAllInCents, before.intentPolicy.maxAllInCents);
    assert.equal(after.targets[0].maxUnitPriceCents, before.targets[0].maxUnitPriceCents);
    const repeated = await (await f.request("/api/v1/user/purchase-intents/status", body)).json() as any;
    assert.equal(repeated.items[0].outcome, "unchanged");
    assert.equal((f.control.missionDetail(ids[0]!) as any).intentPolicy.revision, after.intentPolicy.revision);
    new PurchasePolicyRepository(f.db).revise(ids[0]!, { expectedRevision: after.intentPolicy.revision, expiresAt: new Date(Date.now() - 5000).toISOString() }, Date.now() - 10000);
    const expired = f.control.previewMissionStatus([ids[0]!], "active")[0]!;
    assert.equal(expired.eligible, false);
    assert.equal((await (await f.request("/api/v1/user/purchase-intents?status=expired")).json() as any).total, 1);
    assert.equal(runWithRequestScope(foreign, () => f.control.previewMissionStatus([ids[0]!], "paused"))[0]?.fingerprint, "");
    const denied = runWithRequestScope(foreign, () => f.control.changeMissionStatuses({ ...body, items: [preview.items[0]], status: "active" }));
    assert.equal(denied[0]?.outcome, "skipped"); assert.equal((f.control.missionDetail(ids[0]!) as any).status, "paused");
    assert.equal((await f.request("/api/v1/user/purchase-intents/status-preview", { ids: records.map(item => item.mission.id), status: "paused" })).status, 400);
  } finally { await f.close(); }
});

test("setup impact is read-only, identifies every skipped plan and rejects changes to reviewed evidence before applying", async () => {
  const f = await fixture();
  try {
    const records = Array.from({ length: 7 }, (_, index) => seed(f, index, "audioadvice"));
    const profile = f.control.savePurchaseProfile({ name: "Reviewed setup", targetQuantity: 1, actionCeiling: "notify", priceMode: "fixed_cap", maxUnitPriceCents: 2000 }).profiles[0]!;
    for (const record of records) f.db.run("UPDATE missions SET quick_add_profile_id = ? WHERE id = ?", profile.id, record.mission.id);
    f.db.run("UPDATE listings SET msrp_cents = NULL WHERE id = ?", records[1]!.listing.id);
    f.db.run("UPDATE mission_targets SET enabled = 0 WHERE mission_id = ?", records[2]!.mission.id);
    f.db.run("UPDATE missions SET status = 'satisfied' WHERE id = ?", records[3]!.mission.id);
    new PurchasePolicyRepository(f.db).revise(records[4]!.mission.id, { expiresAt: new Date(Date.now() - 5000).toISOString() }, Date.now() - 10000);
    f.db.run("UPDATE mission_targets SET currency = 'EUR' WHERE mission_id = ?", records[5]!.mission.id);
    f.db.run("UPDATE listings SET msrp_cents = 100000000 WHERE id = ?", records[6]!.listing.id);
    const input = { ...profile, actionCeiling: "add_to_cart", priceMode: "msrp", targetQuantity: 2, fulfillment: "pickup" };
    const before = records.map(item => f.control.missionDetail(item.mission.id));
    const audits = f.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_events")!.count;
    const response = await f.request("/api/v1/user/purchase-profiles/preview", input);
    assert.equal(response.status, 200, await response.clone().text());
    const { preview } = await response.json() as any;
    assert.equal(preview.updatedCount, 1, JSON.stringify(preview)); assert.equal(preview.skippedCount, 6);
    assert.deepEqual(new Set(preview.plans.map((item: any) => item.reasonCode)), new Set(["will_update", "msrp_unavailable", "no_enabled_target", "plan_not_active_or_paused", "plan_expired", "unsupported_currency", "limit_out_of_range"]));
    assert.deepEqual(records.map(item => f.control.missionDetail(item.mission.id)), before);
    assert.equal(f.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_events")!.count, audits);
    assert.equal((await (await f.request("/api/v1/user/purchase-profiles/preview", input)).json() as any).preview.fingerprint, preview.fingerprint);
    f.db.run("UPDATE listings SET msrp_cents = 2599 WHERE id = ?", records[0]!.listing.id);
    assert.equal((await f.request("/api/v1/user/purchase-profiles", { ...input, previewFingerprint: preview.fingerprint })).status, 409);
    assert.equal(f.control.listPurchaseProfiles()[0]?.targetQuantity, 1);
    const fresh = (await (await f.request("/api/v1/user/purchase-profiles/preview", input)).json() as any).preview;
    const saved = await f.request("/api/v1/user/purchase-profiles", { ...input, previewFingerprint: fresh.fingerprint });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await saved.json() as any).propagation.updatedMissionCount, 1);
    assert.equal((f.control.missionDetail(records[0]!.mission.id) as any).targetQuantity, 2);
    assert.equal((f.control.missionDetail(records[1]!.mission.id) as any).targetQuantity, 1);
    assert.equal((await f.request("/api/v1/user/purchase-profiles/preview", { ...input, targetQuantity: 0 })).status, 400);
  } finally { await f.close(); }
});

test("product review totals include old decisions and respect ownership; recognized catalog links expose approved names", async () => {
  const f = await fixture();
  try {
    const links = new CatalogLinkRepository(f.db);
    const governance = new CatalogGovernanceRepository(f.db);
    for (let index = 0; index < 61; index++) {
      const { proposal } = links.propose({ url: `https://www.target.com/p/-/A-${98800000 + index}`, title: `Review product ${index}`, confirmation: "PROPOSE_EXACT_PRODUCT_LINK" }, Date.now() + index);
      if (index % 2) f.db.run("UPDATE catalog_change_proposals SET status = 'rejected', review_note = 'Correct the product name' WHERE id = ?", proposal.id);
    }
    const seen = new Set<string>();
    for (const offset of [0, 25, 50]) {
      const page = await (await f.request(`/api/v1/user/catalog/proposals?limit=25&offset=${offset}`)).json() as any;
      assert.equal(page.total, 61); page.items.forEach((item: any) => seen.add(item.id));
    }
    assert.equal(seen.size, 61);
    const other = new AuthorizationRepository(f.db).createTenantUser({ displayName: "Other shopper" });
    const otherScope = { tenantId: LOCAL_TENANT_ID, userId: other.user.id, actorKind: "user" as const, actorId: other.user.id };
    assert.equal(runWithRequestScope(otherScope, () => governance.mineCount()), 0);
    assert.deepEqual(runWithRequestScope(otherScope, () => governance.listMine()), []);
    const { listing } = seed(f, 0);
    const preview = links.preview(listing.canonicalUrl);
    assert.equal(preview.catalogTitle, "Workflow product 000"); assert.equal(preview.alreadyInProducts, true);
    assert.equal(preview.stockEvidenceAccepted, false);
  } finally { await f.close(); }
});
