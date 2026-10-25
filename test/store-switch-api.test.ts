import assert from "node:assert/strict";
import { officialMsrpFixture } from "./helpers/official-msrp.js";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  PRODUCT_WANT_CONTRACT_VERSION,
  PRODUCT_WANT_PREVIEW_CONFIRMATION,
  PRODUCT_WANT_SAVE_CONFIRMATION,
  STORE_CART_ADDS_TURN_OFF_CONFIRMATION,
  STORE_CART_ADDS_TURN_ON_CONFIRMATION,
  WALMART_ADD_ACTIVATION_CONFIRMATION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  type ProductWantMode,
  type WalmartShadowObservationInput
} from "../packages/contracts/src/index.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { QualificationRepository } from "../packages/database/src/qualification-repository.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";
import { SpendLedgerRepository } from "../packages/database/src/spend-ledger-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";

const VERSION = "store-switch-test";
const EXTENSION_ORIGIN = `chrome-extension://${"a".repeat(32)}`;

function walmartObservation(observedAt: string, retailerSku: string): WalmartShadowObservationInput {
  return {
    adapterVersion: WALMART_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt,
    pageKind: "product",
    retailerId: "walmart",
    retailerSku,
    availability: "in_stock",
    unitPriceCents: 2499,
    currency: "USD",
    sellerName: "Walmart",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: ""
  };
}

/** One product sold first-party at Target (on for cart adds) and Walmart (not yet). */
function product(db: YoinkDatabase, slug: string, title: string, sku: string): { targetId: string; walmartId: string } {
  const catalog = new CatalogRepository(db);
  const listing = (retailerId: string, sku: string, url: string, executionSupported: boolean) => catalog.upsertListing({
    sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    sourceProductId: `switch-${slug}`, sourceListingId: `switch-${slug}-${retailerId}`,
    title, retailerId, retailerSku: sku, canonicalUrl: url, listingStatus: "in_stock",
    executionSupported, msrpCents: 2999, observedPriceCents: 2899, currency: "USD"
  }).listing;
  const result = {
    targetId: listing("target", `95${sku}`, `https://www.target.com/p/-/A-95${sku}`, true).id,
    walmartId: listing("walmart", `66${sku}`, `https://www.walmart.com/ip/66${sku}`, false).id
  };
  for (const id of [result.targetId, result.walmartId]) officialMsrpFixture(db, id, Date.now(), 2999);
  return result;
}

function want(control: ControlRepository, listingId: string, mode: ProductWantMode, targetQuantity = 1): string {
  const input = { contractVersion: PRODUCT_WANT_CONTRACT_VERSION, listingId, mode, maxUnitPriceCents: 2999, targetQuantity, confirmedMsrpCents: 2999 } as const;
  const preview = control.previewProductWant({ ...input, confirmation: PRODUCT_WANT_PREVIEW_CONFIRMATION });
  return control.saveProductWant({
    ...input,
    confirmation: PRODUCT_WANT_SAVE_CONFIRMATION,
    previewFingerprint: preview.previewFingerprint,
    previewedAt: preview.previewedAt
  }).purchaseIntentId;
}

function pairWalmartCompanion(db: YoinkDatabase) {
  const devices = new DeviceRepository(db);
  return devices.pair({
    pairingCode: devices.createPairingCode().code,
    extensionVersion: VERSION,
    capabilities: { readiness: true, jobReconciliation: true, officialMsrpCartV1: true, walmartAddOnly: true, walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION }
  });
}

/** Walmart's store check: two first-party samples and one passing no-click check from this companion. */
function passWalmartStoreCheck(db: YoinkDatabase, deviceId: string, suffix = ""): void {
  const now = Date.now();
  const shadows = new ShadowObservationRepository(db);
  const first = shadows.record(deviceId, walmartObservation(new Date(now - 5_000).toISOString(), `17354421${suffix || "975"}`), now - 4_000);
  shadows.record(deviceId, walmartObservation(new Date(now - 3_000).toISOString(), `98765432${suffix || "101"}`), now - 2_000);
  new QualificationRepository(db).recordWalmartAddRehearsal(deviceId, {
    adapterVersion: WALMART_ADD_ADAPTER_VERSION,
    observerVersion: WALMART_OBSERVER_VERSION,
    contractVersion: 1,
    shadowObservationId: first.id,
    observedAt: new Date(now - 1_000).toISOString(),
    outcome: "passed",
    reasonCode: "verified"
  }, now);
}

function startServer(db: YoinkDatabase, requestScopeResolver?: Parameters<typeof createYoinkServer>[0]["requestScopeResolver"]) {
  const server = createYoinkServer({
    db, webRoot: join(process.cwd(), "apps/web"), version: VERSION, ...(requestScopeResolver ? { requestScopeResolver } : {})
  });
  return new Promise<{ origin: string; close: () => Promise<void> }>((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    resolve({
      origin: `http://127.0.0.1:${address.port}`,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
      }
    });
  }));
}

const walmartStore = (body: { stores: Array<{ retailerId: string; cartAdds: Record<string, unknown> }> }) =>
  body.stores.find((store) => store.retailerId === "walmart")!;

test("Setup turns a store on with Admin's own check, goes live, brings wanted cart items along, and turning it off sticks", async () => {
  const db = new YoinkDatabase();
  const control = new ControlRepository(db);
  // No tax or store reserve, so every all-in below is just max x quantity.
  control.updateSettings({ dedupeWindowSeconds: 300, affiliateMode: "prefer_fallback", taxBps: 0, storeAllowancesCents: {} });
  const alpha = product(db, "alpha", "Switch Alpha Bundle", "710001");
  const bravo = product(db, "bravo", "Switch Bravo Bundle", "710002");
  const charlie = product(db, "charlie", "Switch Charlie Bundle", "710003");
  const delta = product(db, "delta", "Switch Delta Bundle", "710004");
  const echo = product(db, "echo", "Switch Echo Bundle", "710005");
  const active = want(control, alpha.targetId, "add_to_cart");
  const paused = want(control, bravo.targetId, "add_to_cart");
  const overLimit = want(control, charlie.targetId, "add_to_cart", 4);
  const alertsOnly = want(control, delta.targetId, "notify");
  const callAdded = want(control, echo.targetId, "add_to_cart");
  db.run("UPDATE missions SET status = 'paused' WHERE id = ?", paused);
  db.run("UPDATE missions SET origin = 'signal:trackalacker' WHERE id = ?", callAdded);
  // A store listing synced after the plan was made has no target row yet.
  db.run("DELETE FROM mission_targets WHERE mission_id = ? AND listing_id = ?", paused, bravo.walmartId);
  // The four-unit plan's all-in no longer fits once a per-order limit exists.
  const spend = new SpendLedgerRepository(db);
  spend.updatePolicy({ expectedRevision: spend.policy().revision, perOrderCapCents: 5_000, dailyCapCents: null, monthlyCapCents: null });

  const target = (missionId: string, listingId: string) => ({ ...db.get<{ enabled: number; cap: number | null; seller: string; fulfillment: string }>(
    `SELECT enabled, max_unit_price_cents AS cap, seller_policy AS seller, fulfillment
     FROM mission_targets WHERE mission_id = ? AND listing_id = ?`,
    missionId,
    listingId
  ) });
  const planState = () => db.all(
    `SELECT m.id, m.status, m.origin, mt.listing_id AS listingId, mt.enabled, mt.max_unit_price_cents AS cap,
            (SELECT revision FROM mission_intent_revisions ir WHERE ir.mission_id = m.id ORDER BY revision DESC LIMIT 1) AS revision
     FROM missions m JOIN mission_targets mt ON mt.mission_id = m.id ORDER BY m.id, mt.listing_id`
  ).map((row) => ({ ...row }));
  const { origin, close } = await startServer(db);
  const get = async (path: string) => {
    const response = await fetch(`${origin}/api/v1/user/${path}`);
    assert.equal(response.status, 200, path);
    return await response.json() as any;
  };
  const post = (path: string, body: unknown) => fetch(`${origin}/api/v1/user/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const turnOn = () => post("stores/walmart/turn-on", { confirmation: STORE_CART_ADDS_TURN_ON_CONFIRMATION });
  try {
    const before = walmartStore(await get("readiness"));
    assert.deepEqual(before.cartAdds, {
      state: "off",
      ready: false,
      canTurnOn: false,
      canTurnOff: false,
      needsAdmin: false,
      status: "Off · run Walmart's store check in Chrome first",
      wantsToJoin: 3
    });
    assert.ok(Array.isArray((before as any).steps), "the store setup dialog keeps its steps");
    const platform = await get("action-platform");
    assert.deepEqual(platform.storeSetup.find((store: { retailerId: string }) => store.retailerId === "walmart").cartAdds, before.cartAdds);

    assert.equal((await post("stores/walmart/turn-on", { confirmation: "YES" })).status, 400);
    assert.equal((await post("stores/nowhere/turn-on", { confirmation: STORE_CART_ADDS_TURN_ON_CONFIRMATION })).status, 404);
    const noCheck = await turnOn();
    assert.equal(noCheck.status, 409);
    const noCheckBody = await noCheck.json() as { error: string; message: string };
    assert.equal(noCheckBody.error, "store_check_needed");
    assert.match(noCheckBody.message, /^Run Walmart's store check in Chrome first: in the Yoink extension, open Settings and choose Check again\.$/);

    const device = pairWalmartCompanion(db);
    passWalmartStoreCheck(db, device.id);
    db.run("UPDATE extension_devices SET last_seen_at = ? WHERE id = ?", new Date(Date.now() - 10 * 60_000).toISOString(), device.id);
    const offline = walmartStore(await get("readiness")).cartAdds;
    assert.equal(offline.canTurnOn, false);
    assert.equal(offline.status, "Off · open Chrome with the Yoink companion to turn this on");
    const noCompanion = await turnOn();
    assert.equal(noCompanion.status, 409);
    assert.equal((await noCompanion.json() as { error: string }).error, "companion_needed");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_qualifications")?.count, 0);
    assert.equal(control.settings().executionMode, "shadow");

    db.run("UPDATE extension_devices SET last_seen_at = ? WHERE id = ?", new Date().toISOString(), device.id);
    const ready = walmartStore(await get("readiness")).cartAdds;
    assert.equal(ready.canTurnOn, true);
    assert.equal(ready.status, "Off · ready to turn on");

    const turnedOn = await turnOn();
    assert.equal(turnedOn.status, 200, JSON.stringify(await turnedOn.clone().json()));
    const onBody = await turnedOn.json() as any;
    assert.equal(onBody.disposition, "turned_on");
    assert.equal(onBody.store.retailerId, "walmart");
    assert.deepEqual(onBody.store.cartAdds, {
      state: "on",
      ready: true,
      canTurnOn: false,
      canTurnOff: true,
      needsAdmin: false,
      status: "On · ready in Chrome",
      wantsToJoin: 1
    }, JSON.stringify(onBody));
    assert.deepEqual(onBody.wants, {
      updated: 2,
      skipped: [{ id: overLimit, title: "Switch Charlie Bundle", reason: "spending_limit" }]
    });
    assert.deepEqual({ ...db.get("SELECT status, highest_action AS action FROM retailer_adapter_qualifications WHERE retailer_id = 'walmart'") },
      { status: "qualified", action: "add_to_cart" });
    assert.equal(control.settings().executionMode, "live", "turning a store on ends test mode");
    assert.equal(control.settings().actionsPaused, true, "the pause switch is left alone");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'execution_mode_changed'")?.count, 1);
    const sameAsAdmin = db.get<{ data: string }>(
      "SELECT data_json AS data FROM audit_events WHERE event_type = 'retailer_adapter_qualified' ORDER BY created_at DESC LIMIT 1"
    );
    assert.equal(JSON.parse(sameAsAdmin?.data ?? "{}").adapterVersion, WALMART_ADD_ADAPTER_VERSION);

    // Wanted cart items now add to cart at Walmart too, at their own max; everything else is untouched.
    for (const missionId of [active, paused]) {
      const listingId = missionId === active ? alpha.walmartId : bravo.walmartId;
      assert.deepEqual(target(missionId, listingId), { enabled: 1, cap: 2999, seller: "first_party_only", fulfillment: "shipping" });
      assert.deepEqual(target(missionId, missionId === active ? alpha.targetId : bravo.targetId),
        { enabled: 1, cap: 2999, seller: "first_party_only", fulfillment: "shipping" });
    }
    assert.equal(db.get<{ status: string }>("SELECT status FROM missions WHERE id = ?", active)?.status, "active");
    assert.equal(db.get<{ status: string }>("SELECT status FROM missions WHERE id = ?", paused)?.status, "paused", "a paused item stays paused");
    assert.deepEqual({ ...db.get(
      `SELECT max_all_in_cents AS maxAllIn, change_reason AS reason FROM mission_intent_revisions
       WHERE mission_id = ? ORDER BY revision DESC LIMIT 1`, active) },
      { maxAllIn: 2999, reason: "Walmart was turned on in Setup, so this item adds to cart there too." });
    assert.equal(target(overLimit, charlie.walmartId).enabled, 0);
    assert.equal(target(callAdded, echo.walmartId).enabled, 0, "a plan a call added never follows a store");
    assert.equal(target(alertsOnly, delta.walmartId).enabled, 1, "an alerts-only plan already watches every store");
    assert.equal(walmartStore(await get("readiness")).cartAdds.wantsToJoin, 1);

    // Turning the store off retires it for good and leaves every plan as it is.
    const plansBeforeOff = planState();
    assert.equal((await post("stores/walmart/turn-off", { confirmation: "" })).status, 400);
    const turnedOff = await post("stores/walmart/turn-off", { confirmation: STORE_CART_ADDS_TURN_OFF_CONFIRMATION });
    assert.equal(turnedOff.status, 200);
    const offBody = await turnedOff.json() as any;
    assert.equal(offBody.disposition, "turned_off");
    assert.equal(offBody.store.cartAdds.state, "off");
    assert.equal(offBody.store.cartAdds.canTurnOn, true);
    assert.deepEqual(planState(), plansBeforeOff);
    assert.deepEqual({ ...db.get("SELECT status FROM retailer_adapter_qualifications WHERE retailer_id = 'walmart'") }, { status: "retired" });
    assert.equal(db.get<{ reason: string }>(
      "SELECT reason_code AS reason FROM audit_events WHERE event_type = 'retailer_lane_retired' ORDER BY created_at DESC LIMIT 1"
    )?.reason, "shopper_turned_off");

    // A later passing store check from the companion does not turn it back on.
    const shadow = await fetch(`${origin}/api/v1/devices/self/shadow-observations/walmart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: EXTENSION_ORIGIN, Authorization: `Bearer ${device.token}` },
      body: JSON.stringify(walmartObservation(new Date().toISOString(), "17354421976"))
    });
    assert.equal(shadow.status, 201);
    const rehearsal = await fetch(`${origin}/api/v1/devices/self/qualification-trials/walmart-add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: EXTENSION_ORIGIN, Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        adapterVersion: WALMART_ADD_ADAPTER_VERSION,
        observerVersion: WALMART_OBSERVER_VERSION,
        contractVersion: 1,
        shadowObservationId: (await shadow.json() as { observation: { id: string } }).observation.id,
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified"
      })
    });
    assert.equal(rehearsal.status, 201);
    assert.deepEqual((await rehearsal.json() as { renewal: { renewed: boolean; reasonCode: string } }).renewal,
      { retailerId: "walmart", renewed: false, reasonCode: "lane_manually_retired", promotedJobs: 0 });
    assert.equal(walmartStore(await get("readiness")).cartAdds.state, "off");

    // In live mode a match at a store that is off becomes an alert, not a cart add.
    control.setActionsPaused(false, "Test enabled actions");
    const call = new SignalEngine(db).process({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      externalEventId: "switch-alpha-walmart-restock",
      eventType: "restock",
      observedAt: new Date(Date.now() - 1_000).toISOString(),
      identity: {
        sourceProductId: "switch-alpha",
        sourceListingId: "switch-alpha-walmart",
        retailerId: "walmart",
        retailerSku: db.get<{ sku: string }>("SELECT retailer_sku AS sku FROM listings WHERE id = ?", alpha.walmartId)!.sku,
        title: "Switch Alpha Bundle"
      },
      offer: {
        availability: "in_stock",
        unitPriceCents: 2499,
        currency: "USD",
        sellerName: "Walmart",
        sellerType: "first_party",
        fulfillment: "shipping"
      }
    });
    assert.equal(call.missionId, active);
    assert.equal(call.decision, "guarded_add_lane_not_qualified");
    assert.equal(call.actionJobState, "notify_only");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM notification_deliveries WHERE job_id = ?", call.actionJobId)?.count, 1);
  } finally {
    await close();
    db.close();
  }
});

test("a shopper without the activation permission sees an administrator's store and cannot turn it on", async () => {
  const db = new YoinkDatabase();
  const shopper = new AuthorizationRepository(db).createTenantUser({ displayName: "Hosted shopper" });
  const shopperScope: RequestScope = { tenantId: LOCAL_TENANT_ID, userId: shopper.user.id, actorKind: "user", actorId: shopper.user.id };
  const { origin, close } = await startServer(db, (request) => request.headers["x-test-principal"] === "shopper" ? shopperScope : LOCAL_REQUEST_SCOPE);
  const headers = { "Content-Type": "application/json", "X-Test-Principal": "shopper" };
  try {
    const readiness = await (await fetch(`${origin}/api/v1/user/readiness`, { headers })).json() as any;
    assert.deepEqual(walmartStore(readiness).cartAdds, {
      state: "off",
      ready: false,
      canTurnOn: false,
      canTurnOff: false,
      needsAdmin: true,
      status: "Off · your Yoink administrator turns this store on",
      wantsToJoin: 0
    });
    const denied = await fetch(`${origin}/api/v1/user/stores/walmart/turn-on`, {
      method: "POST", headers, body: JSON.stringify({ confirmation: STORE_CART_ADDS_TURN_ON_CONFIRMATION })
    });
    // The route exists on the shopper surface; only the permission is missing.
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as { error: string }).error, "permission_denied");
    // Turning off is the shopper's own setting; with nothing on it changes nothing.
    const off = await fetch(`${origin}/api/v1/user/stores/walmart/turn-off`, {
      method: "POST", headers, body: JSON.stringify({ confirmation: STORE_CART_ADDS_TURN_OFF_CONFIRMATION })
    });
    assert.equal(off.status, 200);
    assert.equal((await off.json() as any).store.cartAdds.state, "off");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'retailer_lane_retired'")?.count, 0);
  } finally {
    await close();
    db.close();
  }
});

test("on a hosted Yoink the store switch waits for an independent approval of Admin's exact activation", async () => {
  const db = new YoinkDatabase();
  const authorization = new AuthorizationRepository(db);
  runWithRequestScope(LOCAL_REQUEST_SCOPE, () => authorization.grantRole(LOCAL_USER_ID, "tenant_admin"));
  const timestamp = new Date().toISOString();
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES ('user_switch_approver', ?, 'Approver', ?)", LOCAL_TENANT_ID, timestamp);
  db.run(
    `INSERT INTO authorization_memberships(tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at)
     VALUES (?, 'user_switch_approver', 'security_admin', 'active', 'test_fixture', ?, ?)`,
    LOCAL_TENANT_ID, timestamp, timestamp
  );
  const stepUp = (userId: string, actorId: string): RequestScope => ({
    tenantId: LOCAL_TENANT_ID, userId, actorKind: "user", actorId,
    authenticationAssurance: "step_up", authenticationTime: Math.floor(Date.now() / 1_000) - 5, sessionId: `session_${actorId}`
  });
  const scopes: Record<string, RequestScope> = {
    requester: stepUp(LOCAL_USER_ID, "actor_switch_requester"),
    approver: stepUp("user_switch_approver", "actor_switch_approver")
  };
  const device = pairWalmartCompanion(db);
  passWalmartStoreCheck(db, device.id);
  const evidenceHash = new ShadowObservationRepository(db).walmartQualificationReadiness().qualificationEvidenceHash;
  const { origin, close } = await startServer(db, (request) => scopes[String(request.headers["x-test-principal"] ?? "")] ?? LOCAL_REQUEST_SCOPE);
  const post = (principal: string, path: string, body: unknown) => fetch(`${origin}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Test-Principal": principal, Origin: origin }, body: JSON.stringify(body)
  });
  try {
    const readiness = await (await fetch(`${origin}/api/v1/user/readiness`, { headers: { "X-Test-Principal": "requester" } })).json() as any;
    assert.equal(walmartStore(readiness).cartAdds.canTurnOn, true);
    const pending = await post("requester", "/api/v1/user/stores/walmart/turn-on", { confirmation: STORE_CART_ADDS_TURN_ON_CONFIRMATION });
    assert.equal(pending.status, 202);
    const pendingBody = await pending.json() as { disposition: string; changeRequest: { id: string; operationType: string; targetKey: string; status: string } };
    assert.equal(pendingBody.disposition, "pending_approval");
    assert.equal(pendingBody.changeRequest.operationType, "retailer_lane_activate");
    assert.equal(pendingBody.changeRequest.targetKey, "walmart");
    // Admin's own activation of the same evidence is the very same pending request.
    const adminRoute = await post("requester", "/api/v1/admin/qualifications/walmart-add/activate", {
      adapterVersion: WALMART_ADD_ADAPTER_VERSION, evidenceHash, confirmation: WALMART_ADD_ACTIVATION_CONFIRMATION
    });
    assert.equal(adminRoute.status, 202);
    assert.equal((await adminRoute.json() as { changeRequest: { id: string } }).changeRequest.id, pendingBody.changeRequest.id);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_qualifications")?.count, 0);

    const approval = await post("approver", `/api/v1/admin/change-requests/${pendingBody.changeRequest.id}/decision`, {
      decision: "approve", confirmation: "APPROVE_HIGH_RISK_CHANGE"
    });
    assert.equal(approval.status, 200);
    const applied = await post("requester", "/api/v1/user/stores/walmart/turn-on", { confirmation: STORE_CART_ADDS_TURN_ON_CONFIRMATION });
    assert.equal(applied.status, 200, JSON.stringify(await applied.clone().json()));
    const appliedBody = await applied.json() as any;
    assert.equal(appliedBody.disposition, "turned_on");
    assert.equal(appliedBody.store.cartAdds.state, "on");
    assert.deepEqual(appliedBody.wants, { updated: 0, skipped: [] });
    assert.equal(db.get<{ status: string }>("SELECT status FROM admin_change_requests WHERE id = ?", pendingBody.changeRequest.id)?.status, "consumed");
    assert.equal(new ControlRepository(db).settings().executionMode, "live");
  } finally {
    await close();
    db.close();
  }
});
