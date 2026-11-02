import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { TARGET_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";
import { LOCAL_TENANT_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE } from "../packages/database/src/request-scope.js";

test("dashboard permission uses the latest matching heartbeat and clears omitted telemetry", async () => {
  const db = new YoinkDatabase();
  const devices = new DeviceRepository(db);
  const capabilities = { readiness: true, jobReconciliation: true, officialMsrpCartV1: true,
    targetAddOnly: true, targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION } as const;
  const device = devices.pair({ pairingCode: devices.createPairingCode().code,
    extensionVersion: "setup-test", capabilities });
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "setup-test" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const target = async () => {
    const response = await fetch(`${base}/api/v1/user/readiness`);
    assert.equal(response.status, 200);
    const data = await response.json() as any;
    return data.stores.find((store: any) => store.retailerId === "target");
  };
  const heartbeat = (report: Record<string, unknown>, at = Date.now()) => devices.heartbeat(device.id,
    { extensionVersion: "setup-test", capabilities, ...report }, at);
  try {
    assert.equal((await target()).permissionEvidence.state, "unknown", "pairing is not a permission report");
    heartbeat({ accessibleRetailers: ["target"] }, Date.now() - 30_000);
    let store = await target();
    assert.equal(store.permissionEvidence.state, "granted");
    assert.equal(store.permissionEvidence.deviceId, device.id);
    assert.ok(store.permissionEvidence.ageMs >= 30_000 && store.permissionEvidence.ageMs < 90_000);
    assert.equal(store.steps.find((step: any) => step.id === "permission").state, "passed");
    heartbeat({ accessibleRetailers: [] });
    assert.equal((await target()).permissionEvidence.state, "denied");
    heartbeat({});
    assert.equal((await target()).permissionEvidence.state, "unknown", "a missing report cannot reuse old permission");
    heartbeat({ accessibleRetailers: ["target"] }, Date.now() - 91_000);
    assert.equal((await target()).permissionEvidence.state, "unknown");
    heartbeat({ accessibleRetailers: ["target"] }, Date.now() + 60_000);
    store = await target();
    assert.equal(store.permissionEvidence.state, "unknown");
    assert.equal(store.permissionEvidence.ageMs, null);
    heartbeat({ accessibleRetailers: ["target"] });
    assert.equal((await target()).permissionEvidence.state, "granted");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});

test("store setup is actor-owned, read-only, and returns the current plan without activating or resuming it", async () => {
  const db = new YoinkDatabase();
  const control = new ControlRepository(db);
  const other = new AuthorizationRepository(db).createTenantUser({ displayName: "Other shopper" });
  const otherScope = { tenantId: LOCAL_TENANT_ID, userId: other.user.id, actorKind: "user" as const, actorId: other.user.id };
  const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    sourceProductId: "setup-api-product", sourceListingId: "setup-api-listing", title: "Setup API product", retailerId: "target", retailerSku: "97900001",
    canonicalUrl: "https://www.target.com/p/-/A-97900001", listingStatus: "in_stock", executionSupported: true, observedPriceCents: 1999, currency: "USD" }).listing;
  const mission = control.ensureUserMission(listing.variantId, listing.id).mission;
  db.run("UPDATE missions SET status = 'paused' WHERE id = ?", mission.id);
  const devices = new DeviceRepository(db);
  const device = devices.pair({ pairingCode: devices.createPairingCode().code, extensionVersion: "setup-test", capabilities: {
    readiness: true, jobReconciliation: true, officialMsrpCartV1: true, targetAddOnly: true, targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION } });
  new RetailerReadinessRepository(db).record(device.id, { contractVersion: 1, retailerId: "target", signedInState: "signed_out",
    cartBaselineState: "unknown", adapterVersion: ADD_LANES.target.contractVersion });
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "setup-test",
    requestScopeResolver: request => request.headers["x-test-principal"] === "other" ? otherScope : LOCAL_REQUEST_SCOPE });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, other = false) => fetch(base + path, { headers: other ? { "X-Test-Principal": "other" } : {} });
  const snapshot = () => ({ mission: control.missionDetail(mission.id), settings: control.settings(), qualifications: db.all("SELECT * FROM retailer_adapter_qualifications") });
  const before = snapshot();
  try {
    const response = await request(`/api/v1/user/readiness?planId=${mission.id}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const data = await response.json() as any;
    assert.equal(data.purchaseIntent.id, mission.id);
    assert.equal(data.purchaseIntent.status, "paused");
    assert.equal(data.purchaseIntent.automationReadiness.state, "inactive");
    assert.equal(data.stores.length, 12);
    const target = data.stores.find((store: any) => store.retailerId === "target");
    assert.equal(target.steps.find((step: any) => step.id === "companion").state, "passed");
    assert.equal(target.steps.find((step: any) => step.id === "sign_in").state, "attention");
    assert.equal(target.nextAction, "sign_in");
    assert.equal(target.canActivate, false, "customer surface never offers business activation, even to an administrator");
    const platform = await (await request("/api/v1/user/action-platform")).json() as any;
    assert.equal(platform.storeSetup[0].summary, data.stores[0].summary);
    const foreign = await (await request("/api/v1/user/readiness", true)).json() as any;
    assert.equal(foreign.purchaseIntent, null);
    assert.equal(foreign.stores[0].steps.find((step: any) => step.id === "companion").state, "attention");
    assert.equal(foreign.stores[0].steps.find((step: any) => step.id === "sign_in").state, "unknown");
    assert.equal(foreign.stores[0].canActivate, false);
    assert.equal(foreign.stores[0].canManageExecution, false);
    assert.equal((await request(`/api/v1/user/readiness?planId=${mission.id}`, true)).status, 404);
    assert.equal((await request("/api/v1/user/readiness?planId=mission_missing")).status, 404);
    assert.deepEqual(snapshot(), before);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
