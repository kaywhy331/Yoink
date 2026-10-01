import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  CALL_ADDED_PLANS_REMOVE_CONFIRMATION,
  PRODUCT_WANT_CONTRACT_VERSION,
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  type SignalEventInput
} from "../packages/contracts/src/index.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

const HOUR = 3_600_000;

function call(sku: string, externalEventId: string, now: number): SignalEventInput {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId,
    eventType: "restock",
    observedAt: new Date(now - 1_000).toISOString(),
    identity: {
      sourceProductId: `call-added-${sku}`,
      sourceListingId: `call-added-${sku}-target`,
      retailerId: "target",
      retailerSku: sku,
      canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
      title: `Call Added ${sku}`
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 3999,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      fulfillment: "shipping"
    }
  };
}

test("the shopper removes the plans calls added, keeps their own and busy ones, and can want a removed item again", async () => {
  const db = new YoinkDatabase();
  const start = Date.now() - 10 * HOUR;
  const catalog = new CatalogRepository(db);
  const control = new ControlRepository(db);
  const listing = (sku: string) => catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    sourceProductId: `call-added-${sku}`, sourceListingId: `call-added-${sku}-target`,
    title: `Call Added ${sku}`, retailerId: "target", retailerSku: sku,
    canonicalUrl: `https://www.target.com/p/-/A-${sku}`, listingStatus: "out_of_stock",
    executionSupported: true, msrpCents: 4999, currency: "USD", observedAt: new Date(start).toISOString()
  }, start).listing;
  const plan = (sku: string, origin: string, createdAt: number) => {
    const item = listing(sku);
    return { listing: item, id: control.ensureMission(item.variantId, item.id, origin, createdAt).mission.id };
  };
  // Three plans calls added (newest last), one already finished, and one the shopper chose.
  const removable = plan("95880001", "signal:trackalacker", start + HOUR);
  const pausedCallPlan = plan("95880002", "signal:trackalacker", start + 2 * HOUR);
  const busy = plan("95880003", "signal:trackalacker", start + 3 * HOUR);
  const finished = plan("95880004", "signal:trackalacker", start + 4 * HOUR);
  const chosen = plan("95880005", "user_want", start + 5 * HOUR);
  db.run("UPDATE missions SET status = 'paused' WHERE id = ?", pausedCallPlan.id);
  db.run("UPDATE missions SET status = 'satisfied' WHERE id = ?", finished.id);
  control.setActionsPaused(false, "Test enabled actions");
  // A cart action that may already have changed the store cart keeps its plan.
  const busyCall = new SignalEngine(db).process(call("95880003", "call-added-busy", Date.now()), Date.now());
  assert.ok(busyCall.actionJobId);
  db.run("UPDATE action_jobs SET state = 'manual_review' WHERE id = ?", busyCall.actionJobId);
  // Another shopper's call-added plan is invisible and untouchable.
  const other = new AuthorizationRepository(db).createTenantUser({ displayName: "Other shopper" });
  const otherScope: RequestScope = { tenantId: LOCAL_TENANT_ID, userId: other.user.id, actorKind: "user", actorId: other.user.id };
  const foreignListing = listing("95880006");
  const foreignId = runWithRequestScope(otherScope, () =>
    new ControlRepository(db).ensureMission(foreignListing.variantId, foreignListing.id, "signal:trackalacker", start).mission.id);

  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "call-added-test" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const get = async (path: string) => {
    const response = await fetch(`${origin}/api/v1/user/${path}`);
    assert.equal(response.status, 200, path);
    return await response.json() as any;
  };
  const post = (path: string, body: unknown) => fetch(`${origin}/api/v1/user/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const status = (id: string) => db.get<{ status: string }>("SELECT status FROM missions WHERE id = ?", id)?.status;
  try {
    const overview = await get("overview");
    assert.equal(overview.settings.plansFromCalls, false);
    assert.equal(overview.counts.callAddedPlans, 3);

    const preview = await get("purchase-intents/call-added");
    assert.equal(preview.contractVersion, 1);
    assert.equal(preview.total, 3);
    assert.deepEqual(preview.items.map((item: { id: string }) => item.id), [busy.id, pausedCallPlan.id, removable.id], "newest first");
    assert.deepEqual(preview.items[2], {
      id: removable.id,
      title: "Call Added 95880001",
      status: "active",
      actionCeiling: "notify",
      enabledStoreNames: "Target",
      imageUrl: "",
      maxUnitPriceCents: null,
      createdAt: new Date(start + HOUR).toISOString()
    });
    assert.equal(preview.items[1].status, "paused");

    const unconfirmed = await post("purchase-intents/call-added/remove", { contractVersion: 1, ids: [removable.id], confirmation: "" });
    assert.equal(unconfirmed.status, 400);
    assert.equal((await unconfirmed.json() as { error: string }).error, "call_added_plans_confirmation_required");
    for (const ids of [[], [removable.id, removable.id], Array.from({ length: 501 }, (_, index) => `mission_${index}`), [42]]) {
      const invalid = await post("purchase-intents/call-added/remove", { contractVersion: 1, ids, confirmation: CALL_ADDED_PLANS_REMOVE_CONFIRMATION });
      assert.equal(invalid.status, 400, JSON.stringify(ids).slice(0, 40));
    }
    assert.equal(status(removable.id), "active", "a refused request removes nothing");

    const removed = await post("purchase-intents/call-added/remove", {
      contractVersion: 1,
      ids: [removable.id, pausedCallPlan.id, busy.id, chosen.id, finished.id, foreignId, "mission_missing"],
      confirmation: CALL_ADDED_PLANS_REMOVE_CONFIRMATION
    });
    assert.equal(removed.status, 200);
    const result = await removed.json() as { removed: number; skipped: Array<{ id: string; title: string; reason: string; message: string }> };
    assert.equal(result.removed, 2);
    assert.deepEqual(result.skipped.map(({ id, title, reason }) => ({ id, title, reason })), [
      { id: busy.id, title: "Call Added 95880003", reason: "action_in_progress" },
      { id: chosen.id, title: "Call Added 95880005", reason: "changed" },
      { id: finished.id, title: "Call Added 95880004", reason: "changed" },
      { id: foreignId, title: "", reason: "changed" },
      { id: "mission_missing", title: "", reason: "changed" }
    ]);
    assert.ok(result.skipped.every((item) => item.message.length > 0));
    assert.equal(status(removable.id), "deleted");
    assert.equal(status(pausedCallPlan.id), "deleted");
    assert.equal(status(busy.id), "active");
    assert.equal(status(chosen.id), "active");
    assert.equal(status(finished.id), "satisfied");
    assert.equal(status(foreignId), "active");
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'call_added_plans_removed'"
    )?.count, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'mission_deleted'"
    )?.count, 2);
    const after = await get("purchase-intents/call-added");
    assert.deepEqual([after.total, after.items.map((item: { id: string }) => item.id)], [1, [busy.id]]);
    assert.equal((await get("overview")).counts.callAddedPlans, 1);

    // A later call for a removed item is logged as removed, and Want it brings it back as the shopper's own.
    const later = new SignalEngine(db).process(call("95880001", "call-added-after-removal", Date.now()), Date.now());
    assert.equal(later.decision, "plan_deleted");
    assert.equal(later.actionJobId, "");
    const calls = await get("calls?limit=1");
    assert.equal(calls.items[0].result.reason, "Removed from your list");
    assert.equal(calls.items[0].result.fix, "want_it");
    const wantPreview = await post("purchase-intents/want/preview", {
      contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId: removable.listing.id, mode: "notify",
      maxUnitPriceCents: 4999, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION
    });
    assert.equal(wantPreview.status, 200);
    const { preview: want } = await wantPreview.json() as { preview: { previewFingerprint: string; previewedAt: string } };
    const saved = await post("purchase-intents/want", {
      contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId: removable.listing.id, mode: "notify",
      maxUnitPriceCents: 4999, confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
      previewFingerprint: want.previewFingerprint, previewedAt: want.previewedAt
    });
    assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
    assert.deepEqual({ ...db.get("SELECT status, origin FROM missions WHERE id = ?", removable.id) },
      { status: "active", origin: "user_want" });
    assert.equal(runWithRequestScope(LOCAL_REQUEST_SCOPE, () => control.listCallAddedPlans().total), 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
