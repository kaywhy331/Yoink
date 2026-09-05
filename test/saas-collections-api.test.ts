import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

test("all 1,001 plans remain reachable, filters precede paging, calls carry exact actor-owned plans, and browser revocation works", async () => {
  const db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  const control = new ControlRepository(db);
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "saas-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<any>;
  };
  try {
    assert.equal((await get("/api/v1/user/purchase-intents")).total, 0);
    const listings: Array<{ id: string; variantId: string; sku: string }> = [];
    db.transaction(() => {
      for (let index = 0; index < 1001; index += 1) {
        const sku = String(97000000 + index);
        const result = catalog.upsertListing({
          sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
          sourceProductId: `saas-${index}`, sourceListingId: `saas-listing-${index}`,
          title: `Collection product ${String(index).padStart(4, "0")}`, retailerId: "target",
          retailerSku: sku, canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
          listingStatus: "in_stock", executionSupported: true, observedPriceCents: 1999, currency: "USD"
        });
        control.ensureUserMission(result.listing.variantId, result.listing.id);
        listings.push({ id: result.listing.id, variantId: result.listing.variantId, sku });
      }
    });
    const all = new Set<string>();
    for (let offset = 0; offset < 1001; offset += 50) {
      const page = await get(`/api/v1/user/purchase-intents?limit=50&offset=${offset}`);
      assert.equal(page.total, 1001);
      assert.ok(page.items.length <= 50);
      for (const plan of page.items) { assert.equal(all.has(plan.id), false); all.add(plan.id); }
    }
    assert.equal(all.size, 1001);
    const exact = listings[0]!;
    const searched = await get(`/api/v1/user/purchase-intents?q=${exact.sku}&limit=50`);
    assert.equal(searched.total, 1);
    const missionId = searched.items[0].id;
    db.run("UPDATE missions SET status = 'paused' WHERE id = ?", missionId);
    const attention = await get("/api/v1/user/purchase-intents?readiness=attention&limit=50");
    assert.equal(attention.total, 1);
    assert.equal(attention.items[0].id, missionId);
    assert.equal((await get("/api/v1/user/purchase-intents?readiness=monitoring&offset=950&limit=50")).items.length, 50);
    assert.equal((await get("/api/v1/user/purchase-intents?q=Target&limit=1")).total, 1001);
    assert.deepEqual(runWithRequestScope({ tenantId: "tenant_elsewhere", userId: "user_elsewhere", actorKind: "user", actorId: "user_elsewhere" }, () => control.planSummariesForVariants([exact.variantId])), []);
    const engine = new SignalEngine(db);
    for (let index = 0; index < 105; index += 1) {
      engine.process({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
        externalEventId: `saas-event-${index}`, eventType: "restock", observedAt: new Date(Date.now() - 1000).toISOString(),
        identity: { sourceProductId: "saas-0", sourceListingId: "saas-listing-0", retailerId: "target", retailerSku: exact.sku, canonicalUrl: `https://www.target.com/p/-/A-${exact.sku}`, title: "Collection product 0000" },
        offer: { availability: "in_stock", unitPriceCents: 1999, currency: "USD", sellerName: "Target", sellerType: "first_party", fulfillment: "shipping" },
        evidence: { headline: "Collection product restock", body: "Fixture" }, parserVersion: "saas-test"
      });
    }
    const first = await get("/api/v1/user/calls?offset=0");
    const older = await get(`/api/v1/user/calls?offset=${first.nextSignalOffset}`);
    assert.equal(first.hasMore, true);
    assert.equal(older.hasMore, false);
    assert.equal(first.signalTotal, 105);
    assert.equal(new Set([...first.items, ...older.items].map((item) => item.id)).size, 105);
    for (const item of [...first.items, ...older.items]) {
      assert.equal(item.product.listingId, exact.id);
      assert.equal(item.purchaseIntent.id, missionId);
      assert.equal(item.purchaseIntent.status, "paused");
    }
    const devices = new DeviceRepository(db);
    const pairing = devices.createPairingCode();
    const paired = devices.pair({ pairingCode: pairing.code, name: "Audit browser", extensionVersion: "saas-test" });
    const inventory = await get("/api/v1/user/devices");
    assert.equal(inventory.items[0].name, "Audit browser");
    assert.equal(JSON.stringify(inventory).includes(paired.token), false);
    assert.equal(Object.hasOwn(inventory.items[0], "credential"), false);
    const revoke = await fetch(`${base}/api/v1/user/devices/${paired.id}/revoke`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(revoke.status, 200);
    assert.equal(devices.authenticate(paired.token), null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("static content revalidates by content hash and compresses while private responses remain no-store", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "saas-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const script = await fetch(`${base}/user.js`, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(script.status, 200);
    assert.equal(script.headers.get("content-encoding"), "gzip");
    assert.match(script.headers.get("cache-control") || "", /must-revalidate/);
    assert.match(await script.text(), /function renderPlans/);
    const cached = await fetch(`${base}/user.js`, { headers: { "If-None-Match": script.headers.get("etag")! } });
    assert.equal(cached.status, 304);
    const plain = await fetch(`${base}/user.js`, { headers: { "Accept-Encoding": "gzip;q=0" } });
    assert.equal(plain.headers.get("content-encoding"), null);
    for (const path of ["/", "/api/v1/user/overview", "/api/v1/user/devices"]) {
      const response = await fetch(base + path);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await response.arrayBuffer();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("profile impact review rejects a changed linked-plan set before applying edits", async () => {
  const db = new YoinkDatabase();
  const control = new ControlRepository(db);
  const profile = control.savePurchaseProfile({ name: "Review fixture", targetQuantity: 1, actionCeiling: "notify", priceMode: "store_price" }).profiles[0]!;
  const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker", sourceProductId: "impact", sourceListingId: "impact", title: "Impact product", retailerId: "target", retailerSku: "97001001", canonicalUrl: "https://www.target.com/p/-/A-97001001", listingStatus: "in_stock", executionSupported: true, observedPriceCents: 1999, currency: "USD" }).listing;
  const mission = control.ensureUserMission(listing.variantId, listing.id).mission;
  db.run("UPDATE missions SET quick_add_profile_id = ? WHERE id = ?", profile.id, mission.id);
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "saas-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const reviewed = await (await fetch(`${base}/api/v1/user/purchase-profiles`)).json() as { items: Array<{ impactFingerprint: string; linkedMissionCount: number }> };
    assert.equal(reviewed.items[0]!.linkedMissionCount, 1);
    db.run("UPDATE missions SET quick_add_profile_id = '' WHERE id = ?", mission.id);
    const changed = await fetch(`${base}/api/v1/user/purchase-profiles`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ ...profile, name: "Changed fixture", impactFingerprint: reviewed.items[0]!.impactFingerprint }) });
    assert.equal(changed.status, 409);
    assert.equal(control.listPurchaseProfiles()[0]!.name, "Review fixture");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
