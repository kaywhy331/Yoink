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
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { OfficialMsrpRepository } from "../packages/database/src/official-msrp-repository.js";
import { PurchasePolicyRepository } from "../packages/database/src/purchase-policy-repository.js";
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

test("automatic store join binds the current exact review without renewing missing, stale or changed reviews", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    const official = new OfficialMsrpRepository(db);
    const policies = new PurchasePolicyRepository(db);
    const cases = ["current", "missing", "expired", "revoked", "identity_changed", "existing_review_changed"] as const;
    const plans = cases.map((kind, index) => {
      const item = product(db, kind, `Review ${kind}`, `72000${index}`);
      const id = want(control, item.targetId, "add_to_cart");
      // The joining listing gets a newer review after the original plan was saved.
      const review = officialMsrpFixture(db, item.walmartId, Date.now(), 2999);
      if (kind === "missing") db.run("DELETE FROM official_msrp_evidence WHERE listing_id = ?", item.walmartId);
      if (kind === "expired") db.run("UPDATE official_msrp_evidence SET expires_at = ? WHERE listing_id = ?", new Date(Date.now() - 1).toISOString(), item.walmartId);
      if (kind === "revoked") official.revoke(item.walmartId, review.id);
      if (kind === "identity_changed") db.run("UPDATE variants SET attributes_json = ? WHERE id = (SELECT variant_id FROM listings WHERE id = ?)", JSON.stringify({ color: "changed" }), item.walmartId);
      if (kind === "existing_review_changed") officialMsrpFixture(db, item.targetId, Date.now(), 2999);
      return { kind, item, id, review, before: policies.current(id) };
    });
    // Model the store being enabled; the API journey below separately proves its readiness gate.
    db.run("UPDATE listings SET execution_supported = 1 WHERE retailer_id = 'walmart'");
    const evidenceBefore = db.all("SELECT * FROM official_msrp_evidence ORDER BY id");
    const result = control.addStoreToWantedCartPlans("walmart");
    assert.equal(result.updated, 1);
    assert.deepEqual(result.skipped.map(({ id, reason }) => ({ id, reason })).sort((a, b) => a.id.localeCompare(b.id)),
      plans.slice(1).map(({ id }) => ({ id, reason: "needs_review" })).sort((a, b) => a.id.localeCompare(b.id)));
    const joined = plans[0]!;
    const policy = policies.current(joined.id)!;
    assert.equal(policy.revision, joined.before!.revision + 1);
    const target = policy.targets.find(target => target.listingId === joined.item.walmartId)!;
    assert.equal(target.enabled, true);
    assert.equal(target.officialMsrpEvidenceId, joined.review.id);
    assert.equal(target.officialMsrpEvidenceHash, joined.review.evidenceHash);
    assert.equal(target.desiredVariant, joined.review.desiredVariant);
    for (const plan of plans.slice(1)) assert.deepEqual(policies.current(plan.id), plan.before, plan.kind);
    assert.deepEqual(db.all("SELECT * FROM official_msrp_evidence ORDER BY id"), evidenceBefore, "auto-join cannot create or renew a review");
  } finally {
    db.close();
  }
});

test("Admin turns a store on with a current check, goes live, brings wanted cart items along, and turning it off sticks", async () => {
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
  const post = (path: string, body: unknown) => fetch(`${origin}/api/v1/admin/${path}`, {
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
      needsAdmin: true,
      status: "Off · your Yoink administrator turns this store on",
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
    assert.equal(offline.status, "Off · your Yoink administrator turns this store on");
    const noCompanion = await turnOn();
    assert.equal(noCompanion.status, 409);
    assert.equal((await noCompanion.json() as { error: string }).error, "companion_needed");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM retailer_adapter_qualifications")?.count, 0);
    assert.equal(control.settings().executionMode, "shadow");

    const readinessNow = Date.now();
    new DeviceRepository(db).heartbeat(device.id, { extensionVersion: VERSION, capabilities: { readiness: true, jobReconciliation: true, officialMsrpCartV1: true, walmartAddOnly: true, walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION }, accessibleRetailers: ["walmart"] }, readinessNow);
    new RetailerReadinessRepository(db).record(device.id, { contractVersion: 1, retailerId: "walmart", signedInState: "ready", cartBaselineState: "unknown", adapterVersion: WALMART_ADD_ADAPTER_VERSION }, readinessNow);
    const ready = walmartStore(await get("readiness")).cartAdds;
    assert.equal(ready.canTurnOn, false);
    assert.equal(ready.status, "Off · your Yoink administrator turns this store on");

    const turnedOn = await turnOn();
    assert.equal(turnedOn.status, 200, JSON.stringify(await turnedOn.clone().json()));
    const onBody = await turnedOn.json() as any;
    assert.equal(onBody.disposition, "turned_on");
    assert.equal(onBody.store.retailerId, "walmart");
    assert.deepEqual(onBody.store.cartAdds, {
      state: "on",
      ready: false,
      canTurnOn: false,
      canTurnOff: true,
      needsAdmin: false,
      status: "On · Auto-cart is paused",
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
    )?.reason, "administrator_turned_off");

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
    // Customer routes cannot activate or retire stores, regardless of the principal.
    assert.equal(denied.status, 404);
    // Retiring business infrastructure is also admin-only.
    const off = await fetch(`${origin}/api/v1/user/stores/walmart/turn-off`, {
      method: "POST", headers, body: JSON.stringify({ confirmation: STORE_CART_ADDS_TURN_OFF_CONFIRMATION })
    });
    assert.equal(off.status, 404);
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
    assert.equal(walmartStore(readiness).cartAdds.canTurnOn, false);
    const pending = await post("requester", "/api/v1/admin/stores/walmart/turn-on", { confirmation: STORE_CART_ADDS_TURN_ON_CONFIRMATION });
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
    const applied = await post("requester", "/api/v1/admin/stores/walmart/turn-on", { confirmation: STORE_CART_ADDS_TURN_ON_CONFIRMATION });
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

// RESOLVE-5: queued and already-leased work keep a single reservation when a store joins.
for (const phase of ['queued', 'leased', 'adding'] as const) {
  test(`admin store join preserves cart safety with ${phase} work`, async () => {
    const { ADD_LANES } = await import('../packages/contracts/src/add-lanes.js');
    const { ExecutionRepository } = await import('../packages/database/src/execution-repository.js');
    const db = new YoinkDatabase();
    const now = Date.now();
    try {
      const control = new ControlRepository(db);
      control.updateSettings({ dedupeWindowSeconds: 300, affiliateMode: 'prefer_fallback', taxBps: 0, storeAllowancesCents: {} });
      const item = product(db, `safety-${phase}`, 'Join safety item', '732001');
      const missionId = want(control, item.targetId, 'add_to_cart');
      const lane = ADD_LANES.target;
      db.run("UPDATE source_connections SET status='connected' WHERE id='source_trackalacker_local'");
      db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,evidence_hash,qualified_at,updated_at,expires_at)
        VALUES(?,?,?,?,'add_to_cart','qualified','fixture-only',?,?,?)`, LOCAL_TENANT_ID, LOCAL_USER_ID, 'target', lane.contractVersion,
        new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + 60_000).toISOString());
      db.run("UPDATE app_settings SET execution_mode='live',actions_paused=0");
      const signal = { sourceConnectionId: 'source_trackalacker_local', source: 'trackalacker' as const,
        externalEventId: `safety-${phase}`, eventType: 'restock' as const, observedAt: new Date(now).toISOString(),
        identity: { sourceProductId: `switch-safety-${phase}`, sourceListingId: `switch-safety-${phase}-target`,
          retailerId: 'target', retailerSku: '95732001', title: 'Join safety item' },
        offer: { availability: 'in_stock' as const, unitPriceCents: 2499, currency: 'USD', sellerName: 'Target', sellerType: 'first_party' as const, fulfillment: 'shipping' as const } };
      const queued = new SignalEngine(db).process(signal, now + 100);
      assert.equal(queued.actionJobState, 'awaiting_executor', JSON.stringify(queued));
      const devices = new DeviceRepository(db);
      const device = devices.pair({ pairingCode: devices.createPairingCode(now).code, capabilities: { jobReconciliation: true, officialMsrpCartV1: true,
        [lane.capability.enabled]: true, [lane.capability.version]: lane.contractVersion } }, now);
      const executor = new ExecutionRepository(db);
      const lease = phase === 'queued' ? null : executor.leaseNextJob(device.id, now + 200);
      if (lease) {
        assert.equal(lease.reason, 'leased');
        if (phase === 'adding') {
          for (const state of ['navigating', 'verifying_listing', 'offer_verified', 'add_authorized', 'adding'] as const)
            executor.reconcileJob(device.id, lease.job!.id, lease.job!.capabilityToken, state, 'fixture_progress', '',
              { unitPriceCents: 2499, retailerId: 'target', retailerSku: '95732001' }, now + 300);
        }
      }
      const reservation = () => db.all('SELECT action_job_id, status, reserved_amount_cents FROM spend_reservations ORDER BY id');
      const before = reservation();
      assert.equal(before.length, 1);
      db.run("UPDATE listings SET execution_supported=1 WHERE retailer_id='walmart'");
      const walmartLane = ADD_LANES.walmart;
      db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,evidence_hash,qualified_at,updated_at,expires_at)
        VALUES(?,?,?,?,'add_to_cart','qualified','fixture-only',?,?,?)`, LOCAL_TENANT_ID, LOCAL_USER_ID, 'walmart', walmartLane.contractVersion,
        new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + 60_000).toISOString());
      const joined = control.addStoreToWantedCartPlans('walmart', now + 400);
      assert.equal(joined.updated + joined.skipped.length, 1);
      const policy = new PurchasePolicyRepository(db).current(missionId)!;
      assert.deepEqual(control.addStoreToWantedCartPlans('walmart', now + 401), { updated: 0, skipped: [] });
      assert.equal(new PurchasePolicyRepository(db).current(missionId)!.revision, policy.revision, 'repeated enable does not revise again');
      const row = db.get<{ state: string }>('SELECT state FROM action_jobs WHERE id=?', queued.actionJobId)!;
      if (phase === 'queued') {
        assert.equal(row.state, 'cancelled');
        assert.equal((reservation()[0] as { status: string }).status, 'released');
      } else {
        assert.equal(row.state, phase);
        assert.deepEqual(reservation(), before, 'a potentially mutating lease keeps its reservation');
      }
      assert.notEqual(executor.leaseNextJob(device.id, now + 500).reason, 'leased');
      const again = new SignalEngine(db).process({ ...signal, externalEventId: `safety-repeat-${phase}`, observedAt: new Date(now + 600).toISOString(),
        identity: { ...signal.identity, sourceListingId: `switch-safety-${phase}-walmart`, retailerId: 'walmart', retailerSku: '66732001' },
        offer: { ...signal.offer, sellerName: 'Walmart' } }, now + 600);
      if (phase !== 'queued') {
        assert.notEqual(again.actionJobState, 'awaiting_executor', 'the newly enabled store cannot duplicate the old store’s in-flight cart action');
        assert.equal(reservation().length, 1);
      } else {
        assert.equal(again.actionJobState, 'awaiting_executor', 'the qualified new store can replace cancelled queued work');
      }
      assert.equal(db.get<{ n: number }>("SELECT count(*) AS n FROM action_jobs WHERE mission_id=? AND action='add_to_cart' AND state NOT IN ('cancelled','expired')", missionId)!.n, 1);
      assert.equal(db.get<{ n: number }>("SELECT count(*) AS n FROM action_jobs WHERE action IN ('submit_order','prepare_checkout')")!.n, 0);
    } finally { db.close(); }
  });
}

test('admin store join changes only its own Wanted plans and reports referenced server denials', async () => {
  const { initializeTenantUserWorkspace } = await import('../packages/database/src/authorization-repository.js');
  const db = new YoinkDatabase();
  const control = new ControlRepository(db);
  const item = product(db, 'scope', 'Scoped Wanted item', '742001');
  const own = want(control, item.targetId, 'add_to_cart');
  const sibling = new AuthorizationRepository(db).createTenantUser({ displayName: 'Other shopper' });
  const siblingScope: RequestScope = { tenantId: LOCAL_TENANT_ID, userId: sibling.user.id, actorKind: 'user', actorId: sibling.user.id };
  const other: RequestScope = { tenantId: 'tenant_join_other', userId: 'user_join_other', actorKind: 'user', actorId: 'user_join_other' };
  const at = new Date().toISOString();
  db.run('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)', other.tenantId, 'Other tenant', at);
  db.run('INSERT INTO users(id,tenant_id,display_name,created_at) VALUES (?,?,?,?)', other.userId, other.tenantId, 'Other user', at);
  initializeTenantUserWorkspace(db, { ...other, pauseReason: 'Fixture pause' });
  const scopedWant = (scope: RequestScope, sku: string) => runWithRequestScope(scope, () => {
    const source = db.get<{ id: string }>("SELECT id FROM source_connections WHERE user_id=? AND source='trackalacker'", scope.userId)!;
    const listing = new CatalogRepository(db).upsertListing({ sourceConnectionId: source.id, source: 'trackalacker',
      sourceProductId: `scoped-${sku}`, sourceListingId: `scoped-target-${sku}`, title: 'Other scoped item',
      retailerId: 'target', retailerSku: sku, canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
      listingStatus: 'in_stock', executionSupported: true, msrpCents: 2999, observedPriceCents: 2499, currency: 'USD' }).listing;
    new CatalogRepository(db).upsertListing({ sourceConnectionId: source.id, source: 'trackalacker',
      sourceProductId: `scoped-${sku}`, sourceListingId: `scoped-walmart-${sku}`, title: 'Other scoped item',
      retailerId: 'walmart', retailerSku: sku, canonicalUrl: `https://www.walmart.com/ip/${sku}`,
      listingStatus: 'in_stock', executionSupported: false, msrpCents: 2999, observedPriceCents: 2499, currency: 'USD' });
    return want(control, listing.id, 'add_to_cart');
  });
  const siblingPlan = scopedWant(siblingScope, '95742002');
  const otherPlan = scopedWant(other, '95742003');
  const policies = new PurchasePolicyRepository(db);
  const before = [runWithRequestScope(siblingScope, () => policies.current(siblingPlan)), runWithRequestScope(other, () => policies.current(otherPlan))];
  const { origin, close } = await startServer(db, req => req.headers['x-test-principal'] === 'shopper' ? siblingScope : LOCAL_REQUEST_SCOPE);
  const post = (path: string, confirmation: string, shopper = false) => fetch(origin + path, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Test-Principal': shopper ? 'shopper' : 'admin' }, body: JSON.stringify({ confirmation }) });
  try {
    const path = '/api/v1/admin/stores/walmart/turn-on';
    assert.equal((await post(path, STORE_CART_ADDS_TURN_ON_CONFIRMATION, true)).status, 403);
    for (const [confirmation, status] of [['NO', 400], [STORE_CART_ADDS_TURN_ON_CONFIRMATION, 409]] as const) {
      const response = await post(path, confirmation); assert.equal(response.status, status);
      assert.ok((await response.json() as any).correlationId);
    }
    for (const suffix of ['turn-on', 'turn-off']) assert.equal((await post(`/api/v1/user/stores/walmart/${suffix}`, STORE_CART_ADDS_TURN_ON_CONFIRMATION)).status, 404);
    const device = pairWalmartCompanion(db); passWalmartStoreCheck(db, device.id);
    const enabled = await post(path, STORE_CART_ADDS_TURN_ON_CONFIRMATION); assert.equal(enabled.status, 200);
    assert.equal((await enabled.json() as any).wants.updated, 1);
    assert.equal(policies.current(own)!.targets.find(t => t.listingId === item.walmartId)!.enabled, true);
    assert.deepEqual([runWithRequestScope(siblingScope, () => policies.current(siblingPlan)), runWithRequestScope(other, () => policies.current(otherPlan))], before);
    const repeat = await post(path, STORE_CART_ADDS_TURN_ON_CONFIRMATION); assert.equal(repeat.status, 200);
    assert.deepEqual((await repeat.json() as any).wants, { updated: 0, skipped: [] });
  } finally { await close(); db.close(); }
});

test('unpaused store readiness requires current matching sign-in, permissions, device and evidence', async () => {
  const db = new YoinkDatabase();
  const control = new ControlRepository(db);
  product(db, 'readiness', 'Ready item', '752001');
  const device = pairWalmartCompanion(db);
  const devices = new DeviceRepository(db);
  const readiness = new RetailerReadinessRepository(db);
  const capabilities = { readiness: true, jobReconciliation: true, officialMsrpCartV1: true, walmartAddOnly: true, walmartAddAdapterVersion: WALMART_ADD_ADAPTER_VERSION } as const;
  const readyDevice = () => devices.heartbeat(device.id, { extensionVersion: VERSION, capabilities, accessibleRetailers: ['walmart'] });
  const readySession = () => readiness.record(device.id, { contractVersion: 1, retailerId: 'walmart', signedInState: 'ready', cartBaselineState: 'unknown', adapterVersion: WALMART_ADD_ADAPTER_VERSION });
  passWalmartStoreCheck(db, device.id); readyDevice(); readySession();
  const { origin, close } = await startServer(db);
  const get = async () => walmartStore(await (await fetch(origin + '/api/v1/user/readiness')).json() as any).cartAdds;
  try {
    const enabled = await fetch(origin + '/api/v1/admin/stores/walmart/turn-on', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: STORE_CART_ADDS_TURN_ON_CONFIRMATION }) });
    assert.equal(enabled.status, 200);
    assert.equal((await get()).ready, false);
    control.setActionsPaused(false, 'Explicit unpaused readiness fixture');
    assert.equal((await get()).ready, true);
    assert.equal((await get()).status, 'On · signed in at Walmart in Chrome');
    for (const signedInState of ['signed_out', 'challenged'] as const) {
      readiness.record(device.id, { contractVersion: 1, retailerId: 'walmart', signedInState, cartBaselineState: 'unknown', adapterVersion: WALMART_ADD_ADAPTER_VERSION });
      assert.equal((await get()).ready, false);
    }
    readySession();
    devices.heartbeat(device.id, { extensionVersion: VERSION, capabilities, accessibleRetailers: ['target'] });
    assert.equal((await get()).ready, false, 'a different store permission cannot satisfy Walmart');
    readyDevice();
    readiness.record(device.id, { contractVersion: 1, retailerId: 'walmart', signedInState: 'ready', cartBaselineState: 'unknown', adapterVersion: 'walmart-add-v0' });
    assert.equal((await get()).ready, false);
    readySession();
    db.run('UPDATE extension_devices SET last_seen_at=? WHERE id=?', new Date(Date.now() - 24 * 60 * 60_000).toISOString(), device.id);
    assert.equal((await get()).ready, false);
    readyDevice();
    readiness.record(device.id, { contractVersion: 1, retailerId: 'walmart', signedInState: 'ready', cartBaselineState: 'unknown', adapterVersion: WALMART_ADD_ADAPTER_VERSION }, Date.now() - 24 * 60 * 60_000);
    assert.equal((await get()).ready, false);
    assert.equal(db.get<{ n: number }>('SELECT count(*) AS n FROM action_jobs')!.n, 0);
  } finally { await close(); db.close(); }
});
