import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { UserActionConnectorRepository } from "../packages/database/src/user-action-connector-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";

const foreign = { tenantId: "tenant_other", userId: "user_other", actorKind: "user" as const, actorId: "user_other" };
const bindings = { fixture_delivery: "a".repeat(64), changed_delivery: "b".repeat(64) };

async function fixture() {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "followup-test", userActionConnectorBindings: bindings });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { db, base, request: async (path: string, method = "GET", body?: unknown) => fetch(base + path, {
    method, headers: { Origin: base, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), close: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); } };
}

test("browser naming is actor-owned, validated and does not change credentials; re-pair restores access under a new identity", async () => {
  const f = await fixture();
  try {
    const devices = new DeviceRepository(f.db);
    const first = devices.pair({ pairingCode: devices.createPairingCode().code, name: "Old browser", extensionVersion: "test" });
    assert.equal(runWithRequestScope(foreign, () => devices.rename(first.id, "Not mine")), false);
    assert.equal((await f.request(`/api/v1/user/devices/${first.id}`, "PATCH", { name: "Laptop Chrome" })).status, 200);
    assert.equal(devices.listDevices()[0]?.name, "Laptop Chrome");
    assert.ok(devices.authenticate(first.token));
    assert.equal((await f.request(`/api/v1/user/devices/${first.id}`, "PATCH", { name: " " })).status, 400);
    devices.revoke(first.id);
    const next = devices.pair({ pairingCode: devices.createPairingCode().code, name: "Laptop Chrome", extensionVersion: "test" });
    assert.notEqual(first.id, next.id);
    assert.equal(devices.authenticate(first.token), null);
    assert.ok(devices.authenticate(next.token));
    assert.equal(devices.listDevices().length, 2);
  } finally { await f.close(); }
});

test("delivery history pages beyond 100; retries preserve attempts and binding, reject stale recovery, and removal cannot interrupt a live lease", async () => {
  const f = await fixture();
  try {
    const repository = new UserActionConnectorRepository(f.db, bindings);
    const input = { contractVersion: 1 as const, kind: "webhook" as const, name: "Fixture updates", endpointReference: "fixture_delivery", events: ["test" as const] };
    const connector = repository.save(input);
    const start = Date.now() - 10_000;
    for (let index = 0; index < 105; index++) repository.queueTest(connector.id, start + index);
    const ids = new Set<string>();
    for (const offset of [0, 50, 100]) {
      const response = await f.request(`/api/v1/user/connectors/deliveries?offset=${offset}`);
      assert.equal(response.status, 404);
      const page = repository.listDeliveries(50, offset);
      assert.equal(repository.deliveryCount(), 105);
      for (const item of page) ids.add(item.id);
    }
    assert.equal(ids.size, 105);
    assert.equal((await f.request("/api/v1/user/connectors/deliveries?offset=Infinity")).status, 404);
    assert.equal(runWithRequestScope(foreign, () => repository.deliveryCount()), 0);
    assert.throws(() => runWithRequestScope(foreign, () => repository.remove(connector.id)));
    const lease = repository.leaseNext()!;
    assert.ok(lease);
    assert.throws(() => repository.remove(connector.id), /being delivered/);
    const failed = repository.fail(lease.id, lease.capabilityToken, "test_connection_lost", false);
    const body = { confirmation: "RETRY_NOTIFICATION", updatedAt: failed.updatedAt, attemptCount: failed.attemptCount };
    assert.equal((await f.request(`/api/v1/user/connectors/deliveries/${failed.id}/retry`, "POST", body)).status, 404);
    assert.equal((await f.request(`/api/v1/user/connectors/deliveries/${failed.id}/retry`, "POST", body)).status, 404);
    assert.equal(repository.retry(failed.id, failed.updatedAt, failed.attemptCount).state, "pending");
    assert.equal(repository.retry(failed.id, failed.updatedAt, failed.attemptCount).attemptCount, 1);
    assert.equal(repository.listDeliveries(500).find((item) => item.id === failed.id)?.attemptCount, 1);
    const retried = repository.leaseNext()!;
    assert.equal(retried.id, failed.id);
    assert.equal(retried.attempt, 2);
    const failedAgain = repository.fail(retried.id, retried.capabilityToken, "test_failed_again", false, Date.now() + 10);
    assert.equal((await f.request(`/api/v1/user/connectors/deliveries/${failed.id}/retry`, "POST", body)).status, 404);
    assert.throws(() => repository.retry(failed.id, failed.updatedAt, failed.attemptCount), /This delivery changed\. Refresh its history before retrying\./);
    repository.save({ ...input, endpointReference: "changed_delivery" }, connector.id);
    assert.throws(() => repository.retry(failedAgain.id, failedAgain.updatedAt, failedAgain.attemptCount), /changed/);
    assert.equal((await f.request(`/api/v1/user/connectors/${connector.id}`, "DELETE", {})).status, 404);
    assert.equal((await f.request(`/api/v1/user/connectors/${connector.id}`, "DELETE", { confirmation: "REMOVE_DESTINATION" })).status, 404);
    repository.remove(connector.id);
    assert.equal(repository.list().length, 0);
    assert.equal(repository.deliveryCount(), 0);
    assert.equal(repository.leaseNext(), null);
  } finally { await f.close(); }
});

test("Insights, export and drill-through use the same product/store/time cohort; exact product lookup ignores first-page limits", async () => {
  const f = await fixture();
  try {
    const catalog = new CatalogRepository(f.db);
    const control = new ControlRepository(f.db);
    const engine = new SignalEngine(f.db);
    const jobs: string[] = [];
    let variant = "";
    const now = Date.now();
    for (let index = 0; index < 3; index++) {
      const sku = String(97900000 + index);
      const listing = catalog.upsertListing({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker", sourceProductId: `filter-${index}`, sourceListingId: `filter-listing-${index}`, title: `Filter product ${index}`, retailerId: "target", retailerSku: sku, canonicalUrl: `https://www.target.com/p/-/A-${sku}`, listingStatus: "in_stock", executionSupported: true, observedPriceCents: 1999, currency: "USD" }).listing;
      control.ensureUserMission(listing.variantId, listing.id);
      variant = listing.variantId;
      const created = engine.process({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker", externalEventId: `filter-event-${index}`, eventType: "restock", observedAt: new Date(now).toISOString(), identity: { sourceProductId: `filter-${index}`, sourceListingId: `filter-listing-${index}`, retailerId: "target", retailerSku: sku, canonicalUrl: listing.canonicalUrl, title: `Filter product ${index}` }, offer: { availability: "in_stock", unitPriceCents: 1999, currency: "USD", sellerName: "Target", sellerType: "first_party", fulfillment: "shipping" }, evidence: { headline: "Fixture restock", body: "Test" }, parserVersion: "test" }, now);
      assert.ok(created.actionJobId);
      jobs.push(created.actionJobId);
    }
    f.db.run("UPDATE action_jobs SET created_at = ? WHERE id = ?", new Date(now - 60 * 86_400_000).toISOString(), jobs[0]!);
    const query = new URLSearchParams({ window: "7d", store: "target", product: "Filter product", asOf: new Date(now + 1).toISOString() });
    const response = await f.request(`/api/v1/user/analytics?${query}`);
    assert.equal(response.status, 200, await response.clone().text());
    const { analytics } = await response.json() as any;
    assert.equal(Object.values(analytics.funnel).reduce((a: number, b: any) => a + Number(b), 0), 2);
    const page = await (await f.request(`/api/v1/user/jobs?${query}&limit=1&offset=1`)).json() as any;
    assert.equal(page.total, 2); assert.equal(page.items.length, 1); assert.ok(!page.items.some((item: any) => item.id === jobs[0]));
    const csv = await (await f.request(`/api/v1/user/analytics.csv?${query}`)).text();
    assert.match(csv, /Filter product/); assert.match(csv, /target/);
    const exact = await (await f.request(`/api/v1/user/library/products?variant=${variant}&limit=1`)).json() as any;
    assert.equal(exact.total, 1); assert.equal(exact.items[0].variantId, variant);
    const missing = await (await f.request('/api/v1/user/library/products?variant=variant_missing')).json() as any;
    assert.equal(missing.total, 0);
    query.set("store", "walmart");
    assert.equal((await (await f.request(`/api/v1/user/jobs?${query}`)).json() as any).total, 0);
    assert.equal((await f.request('/api/v1/user/analytics?window=invalid')).status, 400);
    assert.equal((await f.request('/api/v1/user/analytics?window=constructor')).status, 400);
    assert.match(await (await f.request('/api/v1/user/analytics.csv?product=%3Dformula')).text(), /'=formula/);
  } finally { await f.close(); }
});
