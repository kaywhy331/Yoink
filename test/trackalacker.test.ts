import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import type { TrackalackerCatalogItemInput, TrackalackerPushEnvelope } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { SqliteBackgroundWorkerStore } from "../packages/database/src/background-worker-store.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { BackgroundMaintenanceHandler } from "../packages/engine/src/background-maintenance.js";
import { BackgroundWorkerRuntime } from "../packages/engine/src/background-worker-runtime.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import {
  parseTrackalackerNotification,
  trackalackerCanonicalIdentity,
  trackalackerSignalInput,
  validateTrackalackerPushEnvelope
} from "../packages/sources/src/trackalacker.js";

function envelope(overrides: Partial<TrackalackerPushEnvelope["notification"]> = {}): TrackalackerPushEnvelope {
  return {
    schemaVersion: 1,
    signalId: "push:trackalacker:fixture-1234",
    source: {
      provider: "trackalacker",
      transport: "chrome_extension_web_push",
      notificationId: "push:trackalacker:fixture-1234",
      applicationName: "Google Chrome",
      applicationId: "a".repeat(32),
      domain: "trackalacker.com",
      createdAt: "2026-08-23T01:00:00.000Z",
      receivedAt: "2026-08-23T01:00:01.000Z"
    },
    notification: {
      title: "IN STOCK at Target!",
      body: "Pokemon Pitch Black Elite Trainer Box\nIn stock at $60.11 (at MSRP)",
      textElements: [],
      sourceProductId: "138022",
      sourceListingId: "991122",
      sourceProductSlug: "pokemon-pitch-black-elite-trainer-box",
      sourceRetailer: "target",
      sourceRetailerSku: "1011483414",
      ...overrides
    }
  };
}

test("TrackaLacker push parsing handles standalone, sentence, preorder, test, and unsupported events", () => {
  const standalone = parseTrackalackerNotification(envelope());
  assert.equal(standalone.parseState, "parsed");
  assert.equal(standalone.eventType, "in_stock");
  assert.equal(standalone.retailerId, "target");
  assert.equal(standalone.title, "Pokemon Pitch Black Elite Trainer Box");
  assert.equal(standalone.unitPriceCents, 6011);
  assert.equal(standalone.canonicalUrl, "https://www.target.com/p/-/A-1011483414");

  const sentence = parseTrackalackerNotification(envelope({
    title: "Riftbound League of Legends Rumble Champion Deck is in stock at Amazon",
    body: "Available for $21.86",
    sourceRetailer: "amazon",
    sourceRetailerSku: "B0G3GN6Q72"
  }));
  assert.equal(sentence.eventType, "in_stock");
  assert.equal(sentence.retailerId, "amazon");
  assert.equal(sentence.title, "Riftbound League of Legends Rumble Champion Deck");

  const preorder = parseTrackalackerNotification(envelope({
    title: "Available for pre-order!",
    body: "Pokemon Journey Together Booster Bundle\nAvailable at Target for $29.99",
    sourceRetailer: "target"
  }));
  assert.equal(preorder.eventType, "preorder");
  assert.equal(preorder.parseState, "parsed");

  const testSignal = parseTrackalackerNotification(envelope({
    title: "Here is your test restock alert from TrackaLacker",
    body: "This is a test notification",
    sourceRetailer: "",
    sourceRetailerSku: ""
  }));
  assert.equal(testSignal.test, true);
  assert.equal(testSignal.parseState, "unsupported");

  const unsupported = parseTrackalackerNotification(envelope({ title: "A general account notice", body: "No inventory event here" }));
  assert.equal(unsupported.eventType, "unknown");
  assert.equal(unsupported.parseState, "unsupported");
});

test("TrackaLacker signal conversion enforces idempotency and exposes only canonical identity", () => {
  const signal = trackalackerSignalInput(envelope(), "push:trackalacker:fixture-1234");
  assert.equal(signal.sourceConnectionId, "source_trackalacker_local");
  assert.equal(signal.identity.globalIdentifiers?.trackalacker_slug, "pokemon-pitch-black-elite-trainer-box");
  assert.equal(signal.offer?.unitPriceCents, 6011);
  assert.equal(signal.offer?.sellerType, "unknown");
  assert.equal(signal.evidence?.clickUrl, "https://www.target.com/p/-/A-1011483414");
  assert.throws(() => trackalackerSignalInput(envelope(), "wrong-idempotency-key"), /Idempotency-Key/);
  assert.throws(() => validateTrackalackerPushEnvelope({ ...envelope(), source: { ...envelope().source, domain: "attacker.example" } }), /domain/);
  assert.deepEqual(trackalackerCanonicalIdentity("https://www.bestbuy.com/site/example/6571234.p?skuId=6571234"), {
    retailerId: "bestbuy",
    retailerSku: "6571234",
    canonicalUrl: "https://www.bestbuy.com/site/example/6571234.p"
  });
  const additional = [
    ["https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html?CMP=tracking", "disney", "409914998395", "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html"],
    ["https://www.ravensburger.us/en-US/products/games/oh-my-pigeons-22893?tracking=1", "ravensburger", "22893", "https://www.ravensburger.us/en-US/products/games/oh-my-pigeons-22893"],
    ["https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/?tracking=1", "riot", "RIFTBOUND-UNLEASHED-VAULT", "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/"],
    ["https://www.booksamillion.com/p/-/F019649505470?tracking=1", "booksamillion", "F019649505470", "https://www.booksamillion.com/p/-/F019649505470"],
    ["https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803?tracking=1", "fanatics", "350174258", "https://www.fanatics.com/marvel/marvel-comics/2026-topps-marvel-comics-chrome-factory-sealed-value-box/o-1256627133+t-1223526399+p-350174258+z-9-955555803"],
    ["https://www.kohls.com/product/prd-3384298/product.jsp?tracking=1", "kohls", "3384298", "https://www.kohls.com/product/prd-3384298/product.jsp"],
    ["https://www.macys.com/shop/product/example?ID=16569610&tracking=1", "macys", "16569610", "https://www.macys.com/shop/product/example?ID=16569610"],
    ["https://p-bandai.com/us/item/N2884150001?tracking=1", "pbandai", "N2884150001", "https://p-bandai.com/us/item/N2884150001"],
    ["https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder?tracking=1", "pokemoncenter", "10-10320-101", "https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder"]
  ] as const;
  for (const [url, retailerId, retailerSku, canonicalUrl] of additional) {
    assert.deepEqual(trackalackerCanonicalIdentity(url), { retailerId, retailerSku, canonicalUrl });
  }
  assert.deepEqual(trackalackerCanonicalIdentity("https://merch.riotgames.com/en-us/category/riftbound/?page=1"), {
    retailerId: "", retailerSku: "", canonicalUrl: ""
  });
});

test("extension enrollment payload uses live subscription keys and strips signed notification URLs", () => {
  const context = createContext({
    URL,
    Date,
    Object,
    Array,
    ArrayBuffer,
    Uint8Array,
    TextEncoder,
    crypto: globalThis.crypto,
    atob,
    btoa
  });
  runInContext(readFileSync(join(process.cwd(), "apps", "extension", "trackalacker-push.js"), "utf8"), context);
  const bridge = (context as unknown as { YoinkTrackalackerPush: Record<string, (...args: unknown[]) => unknown> }).YoinkTrackalackerPush;
  const subscription = {
    endpoint: "https://push.example/runtime-endpoint-secret",
    getKey: (name: string) => name === "p256dh" ? Uint8Array.from([1, 2, 3]) : Uint8Array.from([4, 5, 6])
  };
  const registration = bridge.deviceRegistrationPayload?.(subscription, "Desktop - Windows - Chrome") as {
    ok: boolean;
    payload: { device: Record<string, string> };
  };
  assert.equal(registration.ok, true);
  assert.deepEqual(Object.keys(registration.payload.device), ["platform", "endpoint", "p256dh", "auth", "nickname"]);
  assert.equal(registration.payload.device.endpoint, subscription.endpoint);
  assert.equal(registration.payload.device.p256dh, btoa(String.fromCharCode(1, 2, 3)));
  assert.equal(registration.payload.device.auth, btoa(String.fromCharCode(4, 5, 6)));

  const sanitized = bridge.signalEnvelopeFromPush?.({
    title: "Riftbound Deck is in stock at Amazon",
    body: "Available for $21.86",
    url: "https://www.trackalacker.com/products/showcase/riftbound-deck?notification_id=SIGNED_SECRET&utm_term=138022"
  }, "push:trackalacker:runtime-1234", "2026-08-23T01:00:00.000Z", "a".repeat(32)) as Record<string, unknown>;
  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes("SIGNED_SECRET"), false);
  assert.equal(serialized.includes("notification_id"), false);
  assert.equal((sanitized.notification as Record<string, unknown>).sourceProductId, "138022");
  assert.equal((sanitized.notification as Record<string, unknown>).sourceProductSlug, "riftbound-deck");

  const directRetailer = bridge.signalEnvelopeFromPush?.({
    title: "Riftbound Unleashed Vault is in stock at Riot Games Merch",
    body: "Available for $89.99",
    url: "https://merch.riotgames.com/en-us/product/riftbound-unleashed-vault/?tracking=discard"
  }, "push:trackalacker:runtime-5678", "2026-08-23T01:00:00.000Z", "a".repeat(32)) as Record<string, unknown>;
  assert.equal((directRetailer.notification as Record<string, unknown>).sourceRetailer, "riot");
  assert.equal((directRetailer.notification as Record<string, unknown>).sourceRetailerSku, "RIFTBOUND-UNLEASHED-VAULT");

  for (const [url, retailer, sku] of [
    ["https://p-bandai.com/us/item/N2884150001?tracking=discard", "pbandai", "N2884150001"],
    ["https://www.pokemoncenter.com/product/10-10320-101/pokemon-tcg-mewtwo-and-mew-dna-premium-zip-binder?tracking=discard", "pokemoncenter", "10-10320-101"]
  ] as const) {
    const directReadOnlyRetailer = bridge.signalEnvelopeFromPush?.({
      title: "Fixture item is in stock",
      body: "Available now",
      url
    }, `push:trackalacker:runtime-${retailer}`, "2026-08-23T01:00:00.000Z", "a".repeat(32)) as Record<string, unknown>;
    assert.equal((directReadOnlyRetailer.notification as Record<string, unknown>).sourceRetailer, retailer);
    assert.equal((directReadOnlyRetailer.notification as Record<string, unknown>).sourceRetailerSku, sku);
  }

  const preservedRetailer = bridge.signalEnvelopeFromPush?.({
    title: "Gap underwear is in stock at Macy's",
    body: "Available for $18.00",
    url: "https://www.trackalacker.com/products/showcase/gap-underwear"
  }, "push:trackalacker:runtime-9012", "2026-08-23T01:00:00.000Z", "a".repeat(32), {
    retailer: "macys",
    sku: "16569610"
  }) as Record<string, unknown>;
  assert.equal((preservedRetailer.notification as Record<string, unknown>).sourceRetailer, "macys");
  assert.equal((preservedRetailer.notification as Record<string, unknown>).sourceRetailerSku, "16569610");
});

test("extension enrollment prefers silent push and preserves a visible fallback only when required", async () => {
  const context = createContext({
    URL,
    Date,
    Object,
    Array,
    ArrayBuffer,
    Uint8Array,
    TextEncoder,
    crypto: globalThis.crypto,
    atob,
    btoa
  });
  runInContext(readFileSync(join(process.cwd(), "apps", "extension", "trackalacker-push.js"), "utf8"), context);
  const bridge = (context as unknown as { YoinkTrackalackerPush: Record<string, (...args: never[]) => unknown> }).YoinkTrackalackerPush;
  const applicationServerKey = (bridge.vapidApplicationServerKey as unknown as Function)() as Uint8Array;
  const existingSilent = {
    endpoint: "https://push.invalid/existing-fixture",
    options: { userVisibleOnly: false, applicationServerKey }
  };
  let subscriptionCalls = 0;
  const reused = await (bridge.ensureSilentPushSubscription as unknown as Function)({
    getSubscription: async () => existingSilent,
    subscribe: async () => { subscriptionCalls += 1; return null; }
  }, applicationServerKey) as Record<string, unknown>;
  assert.equal(reused.ok, true);
  assert.equal(reused.silent, true);
  assert.equal(subscriptionCalls, 0);

  const visible = {
    endpoint: "https://push.invalid/visible-fixture",
    options: { userVisibleOnly: true, applicationServerKey },
    unsubscribe: async () => true
  };
  const migratedSilent = { endpoint: "https://push.invalid/silent-fixture", options: { userVisibleOnly: false, applicationServerKey } };
  const subscribeModes: boolean[] = [];
  const migrated = await (bridge.ensureSilentPushSubscription as unknown as Function)({
    getSubscription: async () => visible,
    subscribe: async ({ userVisibleOnly }: { userVisibleOnly: boolean }) => {
      subscribeModes.push(userVisibleOnly);
      return migratedSilent;
    }
  }, applicationServerKey) as Record<string, unknown>;
  assert.equal(migrated.ok, true);
  assert.equal(migrated.silent, true);
  assert.deepEqual(subscribeModes, [false]);

  const fallbackModes: boolean[] = [];
  const fallback = await (bridge.ensureSilentPushSubscription as unknown as Function)({
    getSubscription: async () => visible,
    subscribe: async ({ userVisibleOnly }: { userVisibleOnly: boolean }) => {
      fallbackModes.push(userVisibleOnly);
      if (!userVisibleOnly) throw new Error("fixture silent push unavailable");
      return { endpoint: "https://push.invalid/fallback-fixture", options: { userVisibleOnly: true, applicationServerKey } };
    }
  }, applicationServerKey) as Record<string, unknown>;
  assert.equal(fallback.ok, true);
  assert.equal(fallback.silent, false);
  assert.equal(fallback.warning, "silent_push_unavailable");
  assert.deepEqual(fallbackModes, [false, true]);
});

test("page-world enrollment recognizes success, duplicate, failure, and missing subscription without returning secrets", async () => {
  const context = createContext({
    URL,
    Date,
    Object,
    Array,
    ArrayBuffer,
    Uint8Array,
    TextEncoder,
    crypto: globalThis.crypto,
    atob,
    btoa
  });
  runInContext(readFileSync(join(process.cwd(), "apps", "extension", "trackalacker-push.js"), "utf8"), context);
  const bridge = (context as unknown as { YoinkTrackalackerPush: Record<string, (...args: never[]) => unknown> }).YoinkTrackalackerPush;
  const missing = bridge.deviceRegistrationPayload?.() as { ok: boolean; reason: string };
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_subscription");

  const payload = {
    device: {
      platform: "web",
      endpoint: "https://push.example/runtime-only",
      p256dh: "runtime-p256dh",
      auth: "runtime-auth",
      nickname: "Desktop - Windows - Chrome"
    }
  };
  const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
  const runtime = (status: number, body: Record<string, unknown>) => ({
    document: { querySelector: () => ({ getAttribute: () => "runtime-csrf" }) },
    navigator: { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => ({}) } }) } },
    fetch: async (url: string, options: Record<string, unknown>) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }
  });
  const register = bridge.registerDeviceInPage as unknown as (
    value: typeof payload,
    runtimeValue: ReturnType<typeof runtime>
  ) => Promise<Record<string, unknown>>;
  const success = await register(payload, runtime(200, { message: "Device enrolled successfully" }));
  assert.equal(success.ok, true);
  assert.equal(success.status, 200);
  assert.equal(calls[0]?.url, "https://www.trackalacker.com/api/v1/users/devices");
  assert.equal(calls[0]?.options.credentials, "include");
  assert.deepEqual(JSON.parse(String(calls[0]?.options.body)), payload);
  const headers = calls[0]?.options.headers as Record<string, string>;
  assert.equal(headers["X-CSRF-Token"], "runtime-csrf");

  const duplicate = await register(payload, runtime(422, { errors: { endpoint: ["has already been taken"] } }));
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  const failure = await register(payload, runtime(403, { error: "forbidden" }));
  assert.equal(failure.ok, false);
  assert.equal(failure.status, 403);
  assert.equal(JSON.stringify(success).includes("runtime-only"), false);
  assert.equal(JSON.stringify(duplicate).includes("runtime-auth"), false);
  assert.equal(JSON.stringify(failure).includes("runtime-csrf"), false);
});

test("followed-library import retains out-of-stock, Best Buy, and unresolved source listings", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const item: TrackalackerCatalogItemInput = {
      sourceProductId: "138022",
      sourceProductSlug: "pokemon-pitch-black-elite-trainer-box",
      sourceProductUrl: "https://www.trackalacker.com/products/showcase/pokemon-pitch-black-elite-trainer-box?private=discard",
      title: "Pokemon Pitch Black Elite Trainer Box",
      msrpCents: 6999,
      observedAt: "2026-08-23T01:00:00.000Z",
      listings: [
        {
          sourceListingId: "901",
          storeName: "Target",
          retailerId: "target",
          retailerSku: "1011483414",
          canonicalUrl: "https://www.target.com/p/name/-/A-1011483414?tracking=discard",
          sourceListingUrl: "https://www.trackalacker.com/products/showcase/pokemon-pitch-black-elite-trainer-box/listings/901/item",
          availability: "out_of_stock",
          unitPriceCents: null
        },
        {
          sourceListingId: "902",
          storeName: "Best Buy",
          retailerId: "bestbuy",
          retailerSku: "6571234",
          canonicalUrl: "https://www.bestbuy.com/site/example/6571234.p",
          sourceListingUrl: "https://www.trackalacker.com/products/showcase/pokemon-pitch-black-elite-trainer-box/listings/902/item",
          availability: "out_of_stock",
          unitPriceCents: null
        },
        {
          sourceListingId: "903",
          storeName: "GameStop",
          sourceListingUrl: "https://www.trackalacker.com/products/showcase/pokemon-pitch-black-elite-trainer-box/listings/903/item",
          outboundUrl: "https://www.trackalacker.com/outbound/903?signed=discard",
          availability: "unknown"
        }
      ]
    };
    const result = catalog.upsertTrackalackerItem(item, new Date("2026-08-23T01:00:01.000Z").getTime());
    assert.equal(result.candidatesAccepted, 3);
    assert.equal(result.listingsMapped, 2);
    assert.equal(catalog.listLibrary().length, 2);
    assert.equal(db.get<{ status: string }>("SELECT status FROM listings WHERE retailer_id = 'target'")?.status, "out_of_stock");
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM listings WHERE retailer_id = 'bestbuy'")?.execution_supported, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM source_listing_candidates")?.count, 3);
    assert.equal(db.get<{ source_url: string }>("SELECT source_url FROM source_product_refs WHERE external_product_id = '138022'")?.source_url.includes("private="), false);

    db.run("UPDATE retailers SET execution_supported = 1 WHERE id = 'bestbuy'");
    catalog.upsertTrackalackerItem(item, new Date("2026-08-23T01:00:01.500Z").getTime());
    assert.equal(db.get<{ execution_supported: number }>("SELECT execution_supported FROM listings WHERE retailer_id = 'bestbuy'")?.execution_supported, 1);

    const engine = new SignalEngine(db);
    const nonActionable = engine.process({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      externalEventId: "unsupported-event-1",
      eventType: "unknown",
      observedAt: "2026-08-23T01:00:02.000Z",
      identity: {
        retailerId: "target",
        globalIdentifiers: { trackalacker_slug: "pokemon-pitch-black-elite-trainer-box" },
        title: "Pokemon Pitch Black Elite Trainer Box"
      },
      offer: { availability: "unknown", currency: "USD" }
    }, new Date("2026-08-23T01:00:03.000Z").getTime());
    assert.equal(nonActionable.resolutionMethod, "source_product_slug_preferred_retailer");
    assert.equal(nonActionable.decision, "non_actionable_event");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 0);
  } finally {
    db.close();
  }
});

test("paired Chrome can report sanitized push status, import catalog, and deliver idempotent signals", async () => {
  const db = new YoinkDatabase();
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode();
  const paired = devices.pair({ pairingCode: pairing.code, name: "Desktop - Windows - Chrome" });
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "trackalacker-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const root = `http://127.0.0.1:${address.port}`;
  const headers = {
    "Content-Type": "application/json",
    Origin: `chrome-extension://${"a".repeat(32)}`,
    Authorization: `Bearer ${paired.token}`
  };
  try {
    const statusResponse = await fetch(`${root}/api/v1/devices/self/sources/trackalacker/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        state: "ready",
        ready: true,
        subscriptionPresent: true,
        pendingSignals: 0,
        lastHttpStatus: 200,
        errorCode: "",
        lastRegistrationAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        endpoint: "MUST_NOT_BE_STORED",
        auth: "MUST_NOT_BE_STORED"
      })
    });
    assert.equal(statusResponse.status, 200);

    const catalogResponse = await fetch(`${root}/api/v1/devices/self/sources/trackalacker/catalog`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceProductId: "138022",
        sourceProductSlug: "pokemon-pitch-black-elite-trainer-box",
        sourceProductUrl: "https://www.trackalacker.com/products/showcase/pokemon-pitch-black-elite-trainer-box",
        title: "Pokemon Pitch Black Elite Trainer Box",
        msrpCents: 6999,
        observedAt: new Date().toISOString(),
        listings: [{
          sourceListingId: "991122",
          storeName: "Target",
          retailerId: "target",
          retailerSku: "1011483414",
          canonicalUrl: "https://www.target.com/p/-/A-1011483414",
          sourceListingUrl: "https://www.trackalacker.com/products/showcase/pokemon-pitch-black-elite-trainer-box/listings/991122/item",
          availability: "out_of_stock",
          unitPriceCents: null
        }]
      })
    });
    assert.equal(catalogResponse.status, 202);

    const liveEnvelope = envelope();
    const signalResponse = await fetch(`${root}/api/v1/devices/self/sources/trackalacker/signals`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": liveEnvelope.signalId },
      body: JSON.stringify(liveEnvelope)
    });
    assert.equal(signalResponse.status, 202);
    const signal = await signalResponse.json() as Record<string, unknown>;
    assert.equal(signal.accepted, true);
    assert.equal(signal.duplicate, false);
    assert.equal(signal.processingState, "queued");
    assert.equal(signal.backgroundTaskCreated, true);
    assert.equal(signal.backgroundWakeState, "created");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);

    const runtime = new BackgroundWorkerRuntime({
      store: new SqliteBackgroundWorkerStore(db),
      handler: new BackgroundMaintenanceHandler(db),
      version: "trackalacker-test",
      workerId: "background_worker_trackalacker_test"
    });
    const cycle = await runtime.runOnce();
    assert.equal(cycle.failed, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, 1);
    assert.equal(db.get<{ status: string }>("SELECT resolution_status AS status FROM signal_events")?.status, "matched");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 1);

    const duplicateResponse = await fetch(`${root}/api/v1/devices/self/sources/trackalacker/signals`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": liveEnvelope.signalId },
      body: JSON.stringify(liveEnvelope)
    });
    assert.equal(duplicateResponse.status, 202);
    const duplicate = await duplicateResponse.json() as Record<string, unknown>;
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.processingState, "processed");
    assert.equal(duplicate.backgroundTaskCreated, false);
    assert.equal(duplicate.backgroundWakeState, "not_required");

    const mismatch = await fetch(`${root}/api/v1/devices/self/sources/trackalacker/signals`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "another-key" },
      body: JSON.stringify({ ...liveEnvelope, signalId: "push:trackalacker:another-1234" })
    });
    assert.equal(mismatch.status, 400);

    const snapshot = await fetch(`${root}/api/v1/snapshot`).then((response) => response.json()) as {
      trackalacker: { ready: boolean; mappedProducts: number; candidateListings: number };
    };
    assert.equal(snapshot.trackalacker.ready, true);
    assert.equal(snapshot.trackalacker.mappedProducts, 1);
    assert.equal(snapshot.trackalacker.candidateListings, 1);
    const durable = JSON.stringify(db.all("SELECT * FROM source_device_states"));
    assert.equal(durable.includes("MUST_NOT_BE_STORED"), false);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
