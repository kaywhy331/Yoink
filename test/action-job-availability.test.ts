import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import {
  createActionJobAvailabilityPulse,
  DEVICE_ACTION_HANDOFF_WAIT_MAX_MS,
  DEVICE_ACTION_JOB_FALLBACK_RECHECK_MS,
  DEVICE_ACTION_JOB_RAPID_RECHECK_MS,
  DEVICE_ACTION_JOB_RAPID_RECHECK_WINDOW_MS,
  DEVICE_ACTION_JOB_WAIT_MAX_MS,
  DEVICE_NOTIFICATION_WAIT_MAX_MS,
  USER_ACTION_HANDOFF_WAIT_MAX_MS,
  type ActionJobAvailabilityPulse
} from "../apps/api/src/action-job-availability.js";
import { createYoinkServer } from "../apps/api/src/app.js";
import { TARGET_ADD_ADAPTER_VERSION, type StrategyDefinition } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { RetailerReadinessRepository } from "../packages/database/src/retailer-readiness-repository.js";
import { BackgroundMaintenanceHandler } from "../packages/engine/src/background-maintenance.js";
import { DurableSignalIngressService } from "../packages/engine/src/signal-ingress.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { enablePlansFromCalls } from "./helpers/plans-from-calls.js";

function seedTargetActionJob(db: YoinkDatabase, now: number, options: { createJob?: boolean } = {}): string {
  const listing = new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "handoff-watch-product",
    sourceListingId: "handoff-watch-listing",
    title: "Handoff Watch Product",
    retailerId: "target",
    retailerSku: "95280894",
    canonicalUrl: "https://www.target.com/p/-/A-95280894",
    listingStatus: "in_stock",
    executionSupported: true,
    msrpCents: 5_999,
    currency: "USD"
  }, now);
  new ControlRepository(db).createConfiguredMission({
    contractVersion: 1,
    listingId: listing.listing.id,
    targetQuantity: 1,
    maxUnitPriceCents: 5_999,
    maxAllInCents: 10_000,
    actionCeiling: "add_to_cart",
    sellerPolicy: "first_party_only",
    fulfillment: "shipping",
    substitutionPolicy: "exact_only",
    cooldownSeconds: 0,
    confirmation: "CREATE_EXACT_PURCHASE_PLAN"
  }, now);
  db.run(
    `INSERT INTO retailer_adapter_qualifications(
       tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
       evidence_hash, qualified_at, updated_at, expires_at
     ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    TARGET_ADD_ADAPTER_VERSION,
    "handoff-watch-qualified-evidence",
    new Date(now).toISOString(),
    new Date(now).toISOString(),
    new Date(now + 30 * 24 * 60 * 60_000).toISOString()
  );
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0 WHERE user_id = ?", LOCAL_USER_ID);
  if (options.createJob === false) return "";
  const result = new SignalEngine(db).process({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: "handoff-watch-signal",
    eventType: "restock",
    observedAt: new Date(now - 1_000).toISOString(),
    identity: {
      sourceProductId: "handoff-watch-product",
      sourceListingId: "handoff-watch-listing",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      title: "Handoff Watch Product"
    },
    offer: {
      availability: "in_stock",
      unitPriceCents: 5_000,
      currency: "USD",
      sellerName: "Target",
      sellerType: "first_party",
      orderLimit: 1,
      fulfillment: "shipping"
    },
    parserVersion: "handoff-watch-v1"
  }, now);
  assert.equal(result.actionJobState, "awaiting_executor");
  assert.ok(result.actionJobId);
  return result.actionJobId;
}

test("the action-job availability pulse wakes all current waiters and preserves a monotonic observation", async () => {
  assert.equal(USER_ACTION_HANDOFF_WAIT_MAX_MS, 5_000);
  assert.equal(DEVICE_ACTION_HANDOFF_WAIT_MAX_MS, 25_000);
  assert.equal(DEVICE_ACTION_JOB_WAIT_MAX_MS, 25_000);
  assert.equal(DEVICE_NOTIFICATION_WAIT_MAX_MS, 25_000);
  assert.equal(DEVICE_ACTION_JOB_FALLBACK_RECHECK_MS, 1_000);
  assert.equal(DEVICE_ACTION_JOB_RAPID_RECHECK_MS, 250);
  assert.equal(DEVICE_ACTION_JOB_RAPID_RECHECK_WINDOW_MS, 2_500);
  const pulse = createActionJobAvailabilityPulse();
  assert.match(pulse.currentEpoch(), /^[a-f0-9]{32}$/);
  const first = pulse.waitAfter(0, 1_000);
  const second = pulse.waitAfter(0, 1_000);
  assert.equal(pulse.notify(), 1);
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(await pulse.waitAfter(0, 1_000), 1);
  assert.equal(await pulse.waitAfter(1, 5), 1);
  const rapidStartedAt = Date.now();
  assert.equal(pulse.notify({ rapid: true }), 2);
  assert.ok((pulse.rapidRecheckUntil?.() ?? 0) >= rapidStartedAt + DEVICE_ACTION_JOB_RAPID_RECHECK_WINDOW_MS);
});

test("the device job watch requests rapid rechecks after a signal hint without a job-created pulse", async () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(now);
  const paired = devices.pair({
    pairingCode: pairing.code,
    name: "Cross-process availability test",
    platform: "linux-chrome",
    extensionVersion: "availability-test",
    capabilities: {
      jobReconciliation: true,
      targetAddOnly: true,
      targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
    }
  }, now + 1);
  const pulse = createActionJobAvailabilityPulse();
  const waits: Array<{version:number;timeoutMs:number}> = [];
  let firstWaitStarted!: () => void;
  let rapidWaitStarted!: () => void;
  const firstWait = new Promise<void>(resolve => { firstWaitStarted=resolve; });
  const rapidWait = new Promise<void>(resolve => { rapidWaitStarted=resolve; });
  const originalWait = pulse.waitAfter.bind(pulse);
  pulse.waitAfter = (version,timeoutMs) => {
    waits.push({version,timeoutMs});
    const pending=originalWait(version,timeoutMs);
    firstWaitStarted();
    if(version===1) rapidWaitStarted();
    return pending;
  };
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0 WHERE user_id = ?", LOCAL_USER_ID);
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "cross-process-availability-test",
    actionJobAvailability: pulse
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const extensionOrigin = `chrome-extension://${"c".repeat(32)}`;
  try {
    const waitingLease = fetch(
      `http://127.0.0.1:${address.port}/api/v1/devices/self/jobs/next?wait=2500&retailers=target`,
      {
        headers: {
          Origin: extensionOrigin,
          Authorization: `Bearer ${paired.token}`
        }
      }
    );
    const endedBeforeWait = waitingLease.then(() => { throw new Error("The job watch ended before the expected recheck wait."); });
    await Promise.race([firstWait,endedBeforeWait]);
    pulse.notify({ rapid: true });
    await Promise.race([rapidWait,endedBeforeWait]);
    const jobId = seedTargetActionJob(db, Date.now());
    const response = await waitingLease;
    assert.equal(response.status, 200);
    const payload = await response.json() as { job: { id: string } | null };
    assert.equal(payload.job?.id, jobId);
    assert.equal(pulse.currentVersion(), 2,
      "Leasing may notify after discovery, but the external job write itself must not need a process-local pulse.");
    // Assert the interval actually requested by the HTTP watcher, independent
    // of machine load and synchronous database fixture construction time.
    assert.equal(waits.find(wait=>wait.version===1)?.timeoutMs,DEVICE_ACTION_JOB_RAPID_RECHECK_MS);
    assert.ok(waits.every(wait=>wait.timeoutMs>0),"The watcher must not busy-poll.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("the device notification watch wakes immediately for a newly qualified notify-only job", async () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  enablePlansFromCalls(db);
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(now);
  const paired = devices.pair({
    pairingCode: pairing.code,
    name: "Notification availability test",
    platform: "linux-chrome",
    extensionVersion: "availability-test",
    capabilities: { notifications: true }
  }, now + 1);
  const pulse = createActionJobAvailabilityPulse();
  let releaseWaitStarted: (() => void) | null = null;
  const waitStarted = new Promise<void>((resolve) => { releaseWaitStarted = resolve; });
  const availability: ActionJobAvailabilityPulse = {
    currentEpoch: () => pulse.currentEpoch(),
    currentVersion: () => pulse.currentVersion(),
    rapidRecheckUntil: () => pulse.rapidRecheckUntil?.() ?? 0,
    notify: (options) => pulse.notify(options),
    waitAfter: (version, timeoutMs) => {
      releaseWaitStarted?.();
      return pulse.waitAfter(version, timeoutMs);
    }
  };
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "notification-availability-test",
    actionJobAvailability: availability
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const extensionOrigin = `chrome-extension://${"c".repeat(32)}`;
  try {
    const waitingLease = fetch(
      `http://127.0.0.1:${address.port}/api/v1/devices/self/notifications/next?wait=2000`,
      { headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` } }
    );
    await waitStarted;
    new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "notification-watch-product",
      sourceListingId: "notification-watch-listing",
      title: "Notification Watch Product",
      retailerId: "target",
      retailerSku: "95274163",
      canonicalUrl: "https://www.target.com/p/-/A-95274163",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 2_499,
      currency: "USD"
    }, now);
    const strategy: StrategyDefinition = {
      id: "strategy_notification_watch",
      name: "Notification watch",
      enabled: true,
      position: 1,
      revision: 1,
      sources: ["trackalacker"],
      retailers: ["target"],
      pricePolicy: { kind: "absolute_max", maxPriceCents: 3_000 },
      sellerPolicy: "first_party_only",
      allowedSellers: [],
      includeKeywords: "",
      excludeKeywords: "",
      action: "notify",
      quantity: 1,
      fulfillment: "shipping",
      maxSignalAgeSeconds: 120
    };
    new ControlRepository(db).replaceStrategies([strategy], now);
    const result = new SignalEngine(db).process({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      externalEventId: "notification-watch-event",
      eventType: "restock",
      observedAt: new Date(now).toISOString(),
      identity: {
        sourceProductId: "notification-watch-product",
        sourceListingId: "notification-watch-listing",
        retailerId: "target",
        retailerSku: "95274163",
        canonicalUrl: "https://www.target.com/p/-/A-95274163",
        title: "Notification Watch Product"
      },
      offer: {
        availability: "in_stock",
        unitPriceCents: 2_499,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping"
      }
    }, now);
    assert.equal(result.actionJobState, "notify_only");
    pulse.notify();
    const response = await waitingLease;
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      reason: string;
      notification: { retailerId: string; retailerSku: string } | null;
      availabilityVersion: number;
    };
    assert.equal(payload.reason, "leased");
    assert.equal(payload.notification?.retailerId, "target");
    assert.equal(payload.notification?.retailerSku, "95274163");
    assert.ok(payload.availabilityVersion >= 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("durable signal evaluation pulses action availability before its worker cycle completes", async () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  try {
    // No job yet: the durable signal must create one. A signal that only
    // corroborates an existing job is not counted and does not pulse.
    seedTargetActionJob(db, now, { createJob: false });
    const ingress = new DurableSignalIngressService(db);
    const receipt = ingress.acceptTrackalacker({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      signalId: "push:trackalacker:availability-pulse-1234",
      externalEventId: "availability-pulse-1234",
      eventType: "restock",
      observedAt: new Date(now + 100).toISOString(),
      receivedAt: new Date(now + 100).toISOString(),
      identity: {
        sourceProductId: "handoff-watch-product",
        sourceListingId: "handoff-watch-listing",
        retailerId: "target",
        retailerSku: "95280894",
        canonicalUrl: "https://www.target.com/p/-/A-95280894",
        title: "Handoff Watch Product"
      },
      offer: {
        availability: "in_stock",
        unitPriceCents: 5_000,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        orderLimit: 1,
        fulfillment: "shipping"
      },
      evidence: {},
      parserVersion: "trackalacker-push-v1"
    }, now + 100);
    assert.equal(receipt.processingState, "queued");
    const pulses: number[] = [];
    const result = await new BackgroundMaintenanceHandler(db, {
      onActionJobsCreated(count) {
        pulses.push(count);
      }
    }).execute({
      principal: { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID },
      workerId: "background_worker_availability_test",
      runtimeKind: "local_in_process",
      runtimeVersion: "availability-test",
      deploymentFingerprint: "a".repeat(64)
    }, "hosted_delivery_recovery", now + 200);
    assert.equal(result.signalActionJobsCreated, 1);
    assert.deepEqual(pulses, [1]);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM action_jobs WHERE state = 'awaiting_executor'"
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("a retailer session recovery wakes a waiting executor and leases the preserved job", async () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  const jobId = seedTargetActionJob(db, now);
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(now);
  const paired = devices.pair({
    pairingCode: pairing.code,
    name: "Readiness recovery test",
    platform: "linux-chrome",
    extensionVersion: "availability-test",
    capabilities: {
      jobReconciliation: true,
      targetAddOnly: true,
      targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
    }
  }, now);
  new RetailerReadinessRepository(db).record(paired.id, {
    contractVersion: 1,
    retailerId: "target",
    signedInState: "signed_out",
    cartBaselineState: "unknown",
    adapterVersion: TARGET_ADD_ADAPTER_VERSION,
    errorCode: "signed_out"
  }, now);

  const pulse = createActionJobAvailabilityPulse();
  let releaseWaitStarted: (() => void) | null = null;
  const waitStarted = new Promise<void>((resolve) => { releaseWaitStarted = resolve; });
  const availability: ActionJobAvailabilityPulse = {
    currentEpoch: () => pulse.currentEpoch(),
    currentVersion: () => pulse.currentVersion(),
    notify: () => pulse.notify(),
    waitAfter: (version, timeoutMs) => {
      releaseWaitStarted?.();
      return pulse.waitAfter(version, timeoutMs);
    }
  };
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "readiness-recovery-test",
    actionJobAvailability: availability
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"c".repeat(32)}`;
  const deviceHeaders = {
    "Content-Type": "application/json",
    Origin: extensionOrigin,
    Authorization: `Bearer ${paired.token}`
  };
  try {
    const waitingLease = fetch(`${baseUrl}/api/v1/devices/self/jobs/next?wait=1000`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    });
    await waitStarted;

    const recovered = await fetch(`${baseUrl}/api/v1/devices/self/readiness/target`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({
        contractVersion: 1,
        retailerId: "target",
        signedInState: "ready",
        cartBaselineState: "unknown",
        adapterVersion: TARGET_ADD_ADAPTER_VERSION
      })
    });
    assert.equal(recovered.status, 200);

    const response = await waitingLease;
    assert.equal(response.status, 200);
    const body = await response.json() as { job: { id: string } | null; reason: string };
    assert.equal(body.reason, "leased");
    assert.equal(body.job?.id, jobId);
    assert.ok(pulse.currentVersion() >= 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("the user action-handoff endpoint returns immediately when its bounded availability watch changes", async () => {
  const db = new YoinkDatabase();
  const pulse = createActionJobAvailabilityPulse();
  let releaseWaitStarted: (() => void) | null = null;
  const waitStarted = new Promise<void>((resolve) => { releaseWaitStarted = resolve; });
  let waitCalls = 0;
  const availability: ActionJobAvailabilityPulse = {
    currentEpoch: () => pulse.currentEpoch(),
    currentVersion: () => pulse.currentVersion(),
    notify: () => pulse.notify(),
    waitAfter: (version, timeoutMs) => {
      waitCalls += 1;
      releaseWaitStarted?.();
      return pulse.waitAfter(version, timeoutMs);
    }
  };
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "action-handoff-watch-test",
    actionJobAvailability: availability
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    const replacedProcessResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/user/action-handoff?wait=1000&version=0&epoch=${"0".repeat(32)}`
    );
    assert.equal(replacedProcessResponse.status, 200);
    assert.equal(waitCalls, 0, "A cursor from a replaced API process must return immediately.");
    assert.equal(
      (await replacedProcessResponse.json() as { availabilityEpoch: string }).availabilityEpoch,
      pulse.currentEpoch()
    );

    const waitingResponse = fetch(
      `http://127.0.0.1:${address.port}/api/v1/user/action-handoff?wait=1000&version=0&epoch=${pulse.currentEpoch()}`
    );
    await waitStarted;
    assert.equal(waitCalls, 1);
    assert.equal(pulse.notify(), 1);
    const response = await waitingResponse;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-yoink-api-surface"), "user");
    const body = await response.json() as {
      availabilityEpoch: string;
      availabilityVersion: number;
      actionHandoff: { counts: Record<string, number>; primary: unknown };
    };
    assert.equal(body.availabilityEpoch, pulse.currentEpoch());
    assert.equal(body.availabilityVersion, 1);
    assert.deepEqual(body.actionHandoff.counts, {
      queued: 0,
      checking: 0,
      readyToCheckout: 0,
      needsYou: 0
    });
    assert.equal(body.actionHandoff.primary, null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("a Chrome cart-ready transition wakes the user handoff watch with the exact ready action", async () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  const jobId = seedTargetActionJob(db, now);
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(now);
  const paired = devices.pair({
    pairingCode: pairing.code,
    name: "Cart-ready handoff watch test",
    platform: "linux-chrome",
    extensionVersion: "availability-test",
    capabilities: {
      jobReconciliation: true,
      targetAddOnly: true,
      targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
    }
  }, now + 1_000);
  const otherPairing = devices.createPairingCode(now + 1_001);
  const otherDevice = devices.pair({
    pairingCode: otherPairing.code,
    name: "Different paired Chrome",
    platform: "linux-chrome",
    extensionVersion: "availability-test",
    capabilities: { jobReconciliation: true, targetAddOnly: true }
  }, now + 1_002);
  const pulse = createActionJobAvailabilityPulse();
  let releaseWaitStarted: (() => void) | null = null;
  let releaseDeviceWaitStarted: (() => void) | null = null;
  const waitStarted = new Promise<void>((resolve) => { releaseWaitStarted = resolve; });
  const deviceWaitStarted = new Promise<void>((resolve) => { releaseDeviceWaitStarted = resolve; });
  let deviceWatchExpected = false;
  const availability: ActionJobAvailabilityPulse = {
    currentEpoch: () => pulse.currentEpoch(),
    currentVersion: () => pulse.currentVersion(),
    notify: () => pulse.notify(),
    waitAfter: (version, timeoutMs) => {
      if (deviceWatchExpected) releaseDeviceWaitStarted?.();
      else releaseWaitStarted?.();
      return pulse.waitAfter(version, timeoutMs);
    }
  };
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "cart-ready-handoff-watch-test",
    actionJobAvailability: availability
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"b".repeat(32)}`;
  const deviceHeaders = {
    "Content-Type": "application/json",
    Origin: extensionOrigin,
    Authorization: `Bearer ${paired.token}`
  };
  const otherDeviceHeaders = {
    "Content-Type": "application/json",
    Origin: extensionOrigin,
    Authorization: `Bearer ${otherDevice.token}`
  };
  try {
    const leasedResponse = await fetch(`${baseUrl}/api/v1/devices/self/jobs/next`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    });
    assert.equal(leasedResponse.status, 200);
    const leased = await leasedResponse.json() as { job: { id: string; capabilityToken: string } };
    assert.equal(leased.job.id, jobId);
    assert.equal(availability.currentVersion(), 1);

    const waitingHandoff = fetch(
      `${baseUrl}/api/v1/user/action-handoff?wait=1000&version=1&epoch=${pulse.currentEpoch()}`
    );
    await waitStarted;
    const events = [
      "navigating",
      "verifying_listing",
      "offer_verified",
      "add_authorized",
      "adding",
      "cart_verified",
      "confirmed"
    ].map((state) => ({
      state,
      reasonCode: "cart_ready_watch_test",
      message: "Test Chrome progress.",
      evidence: {}
    }));
    const progressResponse = await fetch(
      `${baseUrl}/api/v1/devices/self/jobs/${encodeURIComponent(jobId)}/events/batch`,
      {
        method: "POST",
        headers: deviceHeaders,
        body: JSON.stringify({ capabilityToken: leased.job.capabilityToken, events })
      }
    );
    assert.equal(progressResponse.status, 200);
    assert.equal((await progressResponse.json() as { applied: number }).applied, events.length);

    const handoffResponse = await waitingHandoff;
    assert.equal(handoffResponse.status, 200);
    const handoff = await handoffResponse.json() as {
      availabilityVersion: number;
      actionHandoff: {
        counts: { readyToCheckout: number };
        primary: { id: string; stage: string; retailerId: string; retailerSku: string } | null;
      };
    };
    assert.equal(handoff.availabilityVersion, 2);
    assert.equal(handoff.actionHandoff.counts.readyToCheckout, 1);
    assert.deepEqual(handoff.actionHandoff.primary, {
      id: jobId,
      stage: "ready_to_checkout",
      statusLabel: "Ready to check out",
      statusSummary: "The item is in the store cart.",
      title: "Handoff Watch Product",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      createdAt: new Date(now).toISOString()
    });

    const bootstrapResponse = await fetch(`${baseUrl}/api/v1/devices/self/action-handoffs/reconcile`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({ contractVersion: 1, jobIds: [jobId] })
    });
    assert.equal(bootstrapResponse.status, 200);
    const bootstrap = await bootstrapResponse.json() as {
      availabilityVersion: number;
      items: Array<{ jobId: string; status: string }>;
    };
    assert.deepEqual(bootstrap.items, [{ jobId, status: "cart_ready" }]);

    const wrongDeviceOutcome = await fetch(`${baseUrl}/api/v1/devices/self/jobs/${encodeURIComponent(jobId)}/outcome`, {
      method: "POST",
      headers: otherDeviceHeaders,
      body: JSON.stringify({
        outcome: "missed_it",
        actualTotalCents: null,
        confirmation: "I_REVIEWED_CHECKOUT_RESULT"
      })
    });
    assert.equal(wrongDeviceOutcome.status, 409);
    const stillOpen = await fetch(`${baseUrl}/api/v1/devices/self/action-handoffs/reconcile`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({ contractVersion: 1, jobIds: [jobId] })
    }).then((response) => response.json()) as { items: Array<{ status: string }> };
    assert.equal(stillOpen.items[0]?.status, "cart_ready");

    const timedOutResponse = await fetch(`${baseUrl}/api/v1/devices/self/action-handoffs/reconcile`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({
        contractVersion: 1,
        jobIds: [jobId],
        availabilityVersion: bootstrap.availabilityVersion,
        waitMs: 10
      })
    });
    assert.equal(timedOutResponse.status, 200);
    assert.deepEqual(await timedOutResponse.json(), {
      contractVersion: 1,
      availabilityVersion: bootstrap.availabilityVersion,
      items: [{ jobId, status: "cart_ready" }]
    });

    deviceWatchExpected = true;
    const waitingDeviceReconciliation = fetch(`${baseUrl}/api/v1/devices/self/action-handoffs/reconcile`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({
        contractVersion: 1,
        jobIds: [jobId],
        availabilityVersion: bootstrap.availabilityVersion,
        waitMs: 1_000
      })
    });
    await deviceWaitStarted;
    const outcomeResponse = await fetch(`${baseUrl}/api/v1/devices/self/jobs/${encodeURIComponent(jobId)}/outcome`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({
        outcome: "missed_it",
        actualTotalCents: null,
        confirmation: "I_REVIEWED_CHECKOUT_RESULT"
      })
    });
    assert.equal(outcomeResponse.status, 200);
    const reconciliationResponse = await waitingDeviceReconciliation;
    assert.equal(reconciliationResponse.status, 200);
    assert.deepEqual(await reconciliationResponse.json(), {
      contractVersion: 1,
      availabilityVersion: bootstrap.availabilityVersion + 1,
      items: [{ jobId, status: "closed" }]
    });
    const versionAfterOutcome = availability.currentVersion();
    const confirmationResponse = await fetch(`${baseUrl}/api/v1/devices/self/order-confirmations`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({
        contractVersion: 1,
        actionJobId: jobId,
        retailerId: "target",
        pageClass: "confirmation",
        observedAt: new Date().toISOString()
      })
    });
    assert.equal(confirmationResponse.status, 202);
    assert.equal(availability.currentVersion(), versionAfterOutcome + 1,
      "An exact confirmation-page observation must wake other handoff surfaces.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("the bounded device job long-poll rechecks immediately after an embedded worker completion pulse", async () => {
  const db = new YoinkDatabase();
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode();
  const paired = devices.pair({
    pairingCode: pairing.code,
    name: "Action job availability test",
    platform: "linux-chrome",
    extensionVersion: "availability-test",
    capabilities: {
      jobReconciliation: true,
      targetAddOnly: true,
      targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
    }
  });
  db.run(
    "UPDATE app_settings SET execution_mode = 'live', actions_paused = 0 WHERE user_id = 'user_local'"
  );

  const pulse = createActionJobAvailabilityPulse();
  let waitCalls = 0;
  const availability: ActionJobAvailabilityPulse = {
    currentEpoch: () => pulse.currentEpoch(),
    currentVersion: () => pulse.currentVersion(),
    notify: () => pulse.notify(),
    waitAfter: (version, timeoutMs) => {
      waitCalls += 1;
      const waiting = pulse.waitAfter(version, timeoutMs);
      if (waitCalls === 1) setImmediate(() => pulse.notify());
      return waiting;
    }
  };
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "action-job-availability-test",
    actionJobAvailability: availability
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
  try {
    const requestStartedAt = Date.now();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/devices/self/jobs/next?wait=350`,
      {
        headers: {
          Origin: extensionOrigin,
          Authorization: `Bearer ${paired.token}`
        }
      }
    );
    const elapsedMs = Date.now() - requestStartedAt;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { job: null, reason: "no_jobs" });
    assert.ok(waitCalls >= 2, "The worker pulse should interrupt the first wait and force an immediate lease recheck.");
    assert.ok(elapsedMs >= 300, "The device request must hold its bounded availability watch open.");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const recorded = db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM operational_request_rollups WHERE route_key = 'device.jobs'"
      );
      if (Number(recorded?.count ?? 0) > 0) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const telemetry = db.get<{ maxDurationMs: number }>(
      `SELECT MAX(max_duration_ms) AS maxDurationMs
       FROM operational_request_rollups WHERE route_key = 'device.jobs' AND method = 'GET'`
    );
    assert.ok(Number(telemetry?.maxDurationMs ?? elapsedMs) < elapsedMs - 200,
      "Intentional device job-watch time must not be reported as API service latency.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("a shopper records an over-cap Got it through the user outcome route", async () => {
  const now = Date.now();
  const db = new YoinkDatabase();
  const jobId = seedTargetActionJob(db, now);
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(now);
  const paired = devices.pair({
    pairingCode: pairing.code,
    name: "Over-cap outcome test",
    platform: "linux-chrome",
    extensionVersion: "availability-test",
    capabilities: {
      jobReconciliation: true,
      targetAddOnly: true,
      targetAddAdapterVersion: TARGET_ADD_ADAPTER_VERSION
    }
  }, now + 1_000);
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "over-cap-outcome-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const extensionOrigin = `chrome-extension://${"c".repeat(32)}`;
  const deviceHeaders = {
    "Content-Type": "application/json",
    Origin: extensionOrigin,
    Authorization: `Bearer ${paired.token}`
  };
  try {
    const leased = await fetch(`${baseUrl}/api/v1/devices/self/jobs/next`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    }).then((response) => response.json()) as { job: { id: string; capabilityToken: string } };
    assert.equal(leased.job.id, jobId);
    const progress = await fetch(`${baseUrl}/api/v1/devices/self/jobs/${encodeURIComponent(jobId)}/events/batch`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({
        capabilityToken: leased.job.capabilityToken,
        events: [
          "navigating", "verifying_listing", "offer_verified", "add_authorized", "adding", "cart_verified", "confirmed"
        ].map((state) => ({ state, reasonCode: "over_cap_outcome_test", message: "Test Chrome progress.", evidence: {} }))
      })
    });
    assert.equal(progress.status, 200);

    const reviewedMaximumCents = Number(db.get<{ maximum: number }>(
      "SELECT max_order_total_cents AS maximum FROM action_jobs WHERE id = ?", jobId
    )?.maximum);
    assert.ok(reviewedMaximumCents > 0);
    const actualTotalCents = reviewedMaximumCents + 2_000;
    const outcomeResponse = await fetch(`${baseUrl}/api/v1/user/jobs/${encodeURIComponent(jobId)}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ outcome: "got_it", actualTotalCents, confirmation: "I_REVIEWED_CHECKOUT_RESULT" })
    });
    assert.equal(outcomeResponse.status, 200);
    assert.equal(outcomeResponse.headers.get("x-yoink-api-surface"), "user");
    const outcome = (await outcomeResponse.json() as {
      outcome: { jobId: string; outcome: string; actualTotalCents: number; reviewedMaximumCents: number; overCap: boolean; overCapAmountCents: number };
    }).outcome;
    assert.equal(outcome.jobId, jobId);
    assert.equal(outcome.outcome, "got_it");
    assert.equal(outcome.actualTotalCents, actualTotalCents);
    assert.equal(outcome.reviewedMaximumCents, reviewedMaximumCents);
    assert.equal(outcome.overCap, true, "a Got it above the reviewed cap is accepted and flagged (D1)");
    assert.equal(outcome.overCapAmountCents, 2_000);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM action_events WHERE job_id = ? AND reason_code = 'user_reported_order'", jobId
    )?.count, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
