import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createActionJobAvailabilityPulse } from "../apps/api/src/action-job-availability.js";
import { createYoinkServer } from "../apps/api/src/app.js";
import { loadBuildInfo } from "../apps/api/src/build-info.js";
import { TARGET_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../packages/contracts/src/signal-ingress.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import type { BackgroundWorkerTaskHandler } from "../packages/contracts/src/background-worker.js";
import { SqliteBackgroundWorkerStore } from "../packages/database/src/background-worker-store.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeliveryHealthRepository } from "../packages/database/src/delivery-health-repository.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { HostedDeliveryRepository } from "../packages/database/src/hosted-delivery-repository.js";
import { NotificationRepository } from "../packages/database/src/notification-repository.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";
import { SignalProviderRepository } from "../packages/database/src/signal-provider-repository.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import { buildDeliveryHealth, type DeliveryHealthInput } from "../packages/domain/src/delivery-health.js";
import { buildResumePreflight, RESUME_CONFIRMATION_TOKEN_PATTERN, type ResumePreflightInput } from "../packages/domain/src/resume-preflight.js";
import { BackgroundMaintenanceHandler } from "../packages/engine/src/background-maintenance.js";
import { BackgroundWorkerRuntime } from "../packages/engine/src/background-worker-runtime.js";
import { DurableSignalIngressProcessor } from "../packages/engine/src/signal-ingress.js";

const NOW = new Date("2026-09-25T12:00:00.000Z").getTime();
const WORKER_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "int_srv_worker",
  internalServiceCapability: "internal.delivery"
};

async function withServer<T>(db: YoinkDatabase, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "int-srv-test",
    actionJobAvailability: createActionJobAvailabilityPulse()
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

// ---- 1. Build stamp: buildId and untrackedFiles --------------------------

test("the build stamp carries buildId and untrackedFiles, and a source run counts untracked files as dirty", () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-build-info-"));
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "build-info.json"), JSON.stringify({
      version: "9.9.9",
      commit: "abc123",
      committedAt: "2026-09-25T00:00:00Z",
      dirty: true,
      untrackedFiles: 3,
      buildId: "f".repeat(64),
      builtAt: "2026-09-25T01:00:00Z"
    }));
    const dist = loadBuildInfo(root, { runningFromDist: true, version: "0.0.0", startedAt: "2026-09-25T02:00:00Z" });
    assert.equal(dist.kind, "dist");
    assert.equal(dist.buildId, "f".repeat(64));
    assert.equal(dist.untrackedFiles, 3);

    writeFileSync(join(root, "dist", "build-info.json"), JSON.stringify({ commit: "abc", untrackedFiles: -4, buildId: 7 }));
    const malformed = loadBuildInfo(root, { runningFromDist: true, version: "0.0.0" });
    assert.equal(malformed.buildId, "");
    assert.equal(malformed.untrackedFiles, 0);

    const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (git("init", "-q").status !== 0) return; // git unavailable: the dist half above still ran
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
    // dist/ is untracked here, so the only change in the tree is an untracked file.
    const source = loadBuildInfo(root, { runningFromDist: false, version: "1.0.0" });
    assert.equal(source.kind, "source");
    assert.equal(source.dirty, true, "an untracked file makes a source run dirty");
    assert.equal(source.untrackedFiles, 1);
    assert.equal(source.buildId, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local health serves buildId and untrackedFiles in the build block", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "int-srv-test",
    build: {
      kind: "dist",
      version: "int-srv-test",
      commit: "abc",
      committedAt: "",
      dirty: false,
      builtAt: "",
      startedAt: new Date(NOW).toISOString(),
      sourceCommit: "abc",
      sourceCommittedAt: "",
      staleAgainstSource: false,
      buildId: "e".repeat(64),
      untrackedFiles: 2
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const health = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/health`)
      .then((response) => response.json()) as { build?: { buildId: string; untrackedFiles: number } };
    assert.equal(health.build?.buildId, "e".repeat(64));
    assert.equal(health.build?.untrackedFiles, 2);
  } finally {
    server.close();
    db.close();
  }
});

// ---- 2. Heartbeat loop health and store access --------------------------

function deliveryInput(overrides: Partial<DeliveryHealthInput["devices"][number]>): DeliveryHealthInput {
  return {
    now: NOW,
    lastSignalAt: "",
    lastJobAt: "",
    lastLeaseAt: "",
    lastDeliveredAt: "",
    lastCartReadyAt: "",
    notifications: { windowDays: 7, created: 0, delivered: 0, expired: 0, failed: 0, pending: 0 },
    pendingNotifications: 0,
    consecutiveUndelivered: 0,
    dominantFailureCode: "",
    devices: [{
      id: "device_1",
      name: "Desk Chrome",
      online: true,
      lastSeenAt: new Date(NOW).toISOString(),
      lastNotificationPollAt: "",
      lastJobPollAt: "",
      notificationsCapable: true,
      ...overrides
    }],
    connectors: { total: 0, enabled: 0, bound: 0 },
    activePlans: 1,
    cartFreshnessSeconds: 120,
    notifyLifetimeSeconds: 86_400,
    testAlert: null
  };
}

test("delivery health tells a refused or store-less companion from one that never polls", () => {
  const never = buildDeliveryHealth(deliveryInput({}));
  assert.equal(never.channel.pollState, "never");

  const refused = buildDeliveryHealth(deliveryInput({
    loopHealth: {
      notifications: {
        at: new Date(NOW - 60_000).toISOString(), reason: "cycle_failed", ok: false, status: 409, code: "companion_incompatible", consecutiveFailures: 4
      }
    },
    accessibleRetailers: ["target"]
  }));
  assert.equal(refused.channel.pollState, "refused");
  assert.match(refused.headline, /refused/);
  assert.match(refused.summary, /HTTP 409/);
  assert.equal(refused.nextAction?.code, "reload_companion");

  const unauthorized = buildDeliveryHealth(deliveryInput({
    loopHealth: { jobs: { at: new Date(NOW - 1_000).toISOString(), reason: "cycle_failed", ok: false, status: 401, code: "", consecutiveFailures: 1 } }
  }));
  assert.equal(unauthorized.channel.pollState, "refused");
  assert.equal(unauthorized.nextAction?.code, "pair_companion");

  const staleRefusal = buildDeliveryHealth(deliveryInput({
    loopHealth: { jobs: { at: new Date(NOW - 60 * 60_000).toISOString(), reason: "cycle_failed", ok: false, status: 500, code: "", consecutiveFailures: 1 } }
  }));
  assert.equal(staleRefusal.channel.pollState, "never", "an hour-old refusal explains nothing");

  const noStores = buildDeliveryHealth(deliveryInput({ accessibleRetailers: [] }));
  assert.equal(noStores.channel.pollState, "no_store_access");
  assert.equal(noStores.nextAction?.code, "grant_store_access");

  const polling = buildDeliveryHealth(deliveryInput({
    lastNotificationPollAt: new Date(NOW - 10_000).toISOString(),
    accessibleRetailers: [],
    loopHealth: { jobs: { at: new Date(NOW - 1_000).toISOString(), reason: "cycle_failed", ok: false, status: 500, code: "", consecutiveFailures: 1 } }
  }));
  assert.equal(polling.channel.pollState, "polling", "a device that polls is polling whatever it reports");
});

test("the heartbeat stores bounded loop health and store access, and an expired call records a refusal", () => {
  const db = new YoinkDatabase();
  try {
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
      const devices = new DeviceRepository(db);
      const paired = devices.pair({ pairingCode: devices.createPairingCode(NOW).code, extensionVersion: "t" }, NOW);
      assert.throws(() => devices.heartbeat(paired.id, { loopHealth: [] }, NOW), /loopHealth must be an object/);
      assert.throws(() => devices.heartbeat(paired.id, { accessibleRetailers: "target" }, NOW), /accessibleRetailers/);
      devices.heartbeat(paired.id, {
        extensionVersion: "t",
        loopHealth: {
          notifications: {
            at: new Date(NOW + 5_000).toISOString(), reason: "cycle_failed", ok: false, status: 403, code: "permission_denied", consecutiveFailures: 2
          },
          jobs: { at: "not a time", reason: "x", ok: true },
          bogus: { at: new Date(NOW).toISOString() }
        },
        accessibleRetailers: ["target", "not-a-store", "TARGET", "walmart"]
      }, NOW + 6_000);
      const listed = devices.listDevices(NOW + 6_000)[0]!;
      assert.deepEqual(listed.accessibleRetailers, ["target", "walmart"]);
      assert.deepEqual(Object.keys(listed.loopHealth as object), ["notifications"]);
      assert.equal((listed.loopHealth as { notifications: { status: number } }).notifications.status, 403);
      // Declared capabilities still parse from the shared column.
      assert.equal(typeof (listed.capabilities as { notifications: boolean }).notifications, "boolean");

      const health = new DeliveryHealthRepository(db).snapshot({ devices: devices.listDevices(NOW + 6_000), connectors: [], now: NOW + 6_000 });
      assert.equal(health.channel.pollState, "refused");

      // A pending call created before the refusal expires as device_poll_refused.
      const listing = new CatalogRepository(db).upsertListing({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        sourceProductId: "int-srv-product",
        sourceListingId: "int-srv-listing",
        title: "Int Srv Product",
        retailerId: "target",
        retailerSku: "95280894",
        canonicalUrl: "https://www.target.com/p/-/A-95280894",
        listingStatus: "in_stock",
        executionSupported: true,
        msrpCents: 5_999,
        currency: "USD"
      }, NOW);
      new ControlRepository(db).createConfiguredMission({
        contractVersion: 1,
        listingId: listing.listing.id,
        targetQuantity: 1,
        maxUnitPriceCents: 5_999,
        maxAllInCents: 10_000,
        actionCeiling: "notify",
        sellerPolicy: "first_party_only",
        fulfillment: "shipping",
        substitutionPolicy: "exact_only",
        cooldownSeconds: 0,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      } as never, NOW);
      const alert = new DeliveryHealthRepository(db).createTestAlert({ devices: devices.listDevices(NOW) }, NOW);
      db.run("UPDATE action_jobs SET expires_at = ? WHERE id = ?", new Date(NOW + 1_000).toISOString(), alert.jobId);
      const deliveryId = alert.deliveryId;
      new NotificationRepository(db).recoverExpired(NOW + 10_000);
      assert.equal(db.get<{ failureCode: string }>(
        "SELECT failure_code AS failureCode FROM notification_deliveries WHERE id = ?", deliveryId
      )?.failureCode, "device_poll_refused");
    });
  } finally {
    db.close();
  }
});

// ---- 3. Resume confirmation token ----------------------------------------

function preflightInput(overrides: Partial<ResumePreflightInput> = {}): ResumePreflightInput {
  return {
    actionsPaused: true,
    pauseReason: "",
    pausedAt: "",
    pausedBy: "shopper",
    executionMode: "live",
    readyStores: [{ retailerId: "target", name: "Target" }],
    storeToSetUp: null,
    savedPlanCount: 2,
    cartPlanCount: 1,
    notifyPlanCount: 1,
    dailyCapCents: 10_000,
    availableTodayCents: 10_000,
    pendingRequest: null,
    tenantPause: null,
    ...overrides
  };
}

test("the resume confirmation token is stable for one scope and changes when the scope does", () => {
  const base = buildResumePreflight(preflightInput()).confirmationToken;
  assert.match(base, RESUME_CONFIRMATION_TOKEN_PATTERN);
  assert.equal(buildResumePreflight(preflightInput({ availableTodayCents: 4_000, pauseReason: "x" })).confirmationToken, base);
  assert.notEqual(buildResumePreflight(preflightInput({ readyStores: [] })).confirmationToken, base);
  assert.notEqual(buildResumePreflight(preflightInput({ cartPlanCount: 2 })).confirmationToken, base);
  assert.notEqual(buildResumePreflight(preflightInput({ dailyCapCents: null })).confirmationToken, base);
  assert.notEqual(buildResumePreflight(preflightInput({ pendingRequest: { id: "r", createdAt: "", expiresAt: "" } })).confirmationToken, base);
});

test("a resume carrying a stale confirmation token is refused with a fresh preflight; no token keeps the old path", async () => {
  const db = new YoinkDatabase();
  try {
    db.run(
      `INSERT INTO retailer_adapter_qualifications(
         tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
         evidence_hash, qualified_at, updated_at, expires_at
       ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', 'int-srv-evidence', ?, ?, ?)`,
      LOCAL_TENANT_ID, LOCAL_USER_ID, TARGET_ADD_ADAPTER_VERSION,
      new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString()
    );
    await withServer(db, async (baseUrl) => {
      const headers = { "Content-Type": "application/json", Origin: baseUrl };
      const settings = await fetch(`${baseUrl}/api/v1/user/overview`).then((response) => response.json()) as {
        settings: { resume: { confirmationToken: string; allowed: boolean } };
      };
      const token = settings.settings.resume.confirmationToken;
      assert.match(token, RESUME_CONFIRMATION_TOKEN_PATTERN);

      const invalid = await fetch(`${baseUrl}/api/v1/user/settings/actions`, {
        method: "PATCH", headers, body: JSON.stringify({ paused: false, confirmationToken: "no" })
      });
      assert.equal(invalid.status, 400);

      const stale = await fetch(`${baseUrl}/api/v1/user/settings/actions`, {
        method: "PATCH", headers, body: JSON.stringify({ paused: false, confirmationToken: "rp1:0000000000000000000000000000000000000000" })
      });
      assert.equal(stale.status, 409);
      const staleBody = await stale.json() as { error: string; details: { resume: { confirmationToken: string } } };
      assert.equal(staleBody.error, "resume_scope_changed");
      assert.equal(staleBody.details.resume.confirmationToken, token);

      const current = await fetch(`${baseUrl}/api/v1/user/settings/actions`, {
        method: "PATCH", headers, body: JSON.stringify({ paused: false, confirmationToken: token })
      });
      assert.ok([200, 202].includes(current.status), `current token resumes (got ${current.status})`);

      // Without a token the request behaves exactly as before (pause is never gated).
      const pause = await fetch(`${baseUrl}/api/v1/user/settings/actions`, {
        method: "PATCH", headers, body: JSON.stringify({ paused: true })
      });
      assert.equal(pause.status, 200);
      const noToken = await fetch(`${baseUrl}/api/v1/user/settings/actions`, {
        method: "PATCH", headers, body: JSON.stringify({ paused: false })
      });
      assert.ok([200, 202].includes(noToken.status));
    });
  } finally {
    db.close();
  }
});

// ---- 4. Strategies revision -------------------------------------------------

test("GET strategies and the admin snapshot carry a revision that a stale PUT is refused against", async () => {
  const db = new YoinkDatabase();
  try {
    await withServer(db, async (baseUrl) => {
      const headers = { "Content-Type": "application/json", Origin: baseUrl };
      const listed = await fetch(`${baseUrl}/api/v1/user/strategies`).then((response) => response.json()) as {
        items: Array<Record<string, unknown>>;
        strategiesRevision: string;
      };
      assert.match(listed.strategiesRevision, /^[a-f0-9]{64}$/);
      const snapshot = await fetch(`${baseUrl}/api/v1/admin/snapshot?view=strategies`).then((response) => response.json()) as { strategiesRevision?: string };
      assert.equal(snapshot.strategiesRevision, listed.strategiesRevision);

      const stale = await fetch(`${baseUrl}/api/v1/user/strategies`, {
        method: "PUT", headers, body: JSON.stringify({ strategies: listed.items, expectedRevision: "0".repeat(64) })
      });
      assert.equal(stale.status, 409);
      const staleBody = await stale.json() as { error: string; details: { strategiesRevision: string } };
      assert.equal(staleBody.error, "strategies_changed");
      assert.equal(staleBody.details.strategiesRevision, listed.strategiesRevision);

      const malformed = await fetch(`${baseUrl}/api/v1/user/strategies`, {
        method: "PUT", headers, body: JSON.stringify({ strategies: listed.items, expectedRevision: 5 })
      });
      assert.equal(malformed.status, 400);

      const saved = await fetch(`${baseUrl}/api/v1/user/strategies`, {
        method: "PUT", headers, body: JSON.stringify({ strategies: listed.items, expectedRevision: listed.strategiesRevision })
      });
      assert.equal(saved.status, 200);
      assert.match((await saved.json() as { strategiesRevision: string }).strategiesRevision, /^[a-f0-9]{64}$/);

      const legacy = await fetch(`${baseUrl}/api/v1/user/strategies`, {
        method: "PUT", headers, body: JSON.stringify({ strategies: listed.items })
      });
      assert.equal(legacy.status, 200, "a PUT without expectedRevision keeps working");
    });
  } finally {
    db.close();
  }
});

// ---- 5. Source freshness from server time -----------------------------------

test("a signal stamps source freshness with server time, not the payload's received_at", () => {
  const db = new YoinkDatabase();
  try {
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
      new SignalRepository(db).insertEvent({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        signalId: "sig_int_srv_clock",
        externalEventId: "int-srv-clock",
        transportHash: "t".repeat(64),
        schemaVersion: 1,
        eventType: "restock",
        test: false,
        observedAt: "2020-01-01T00:00:00.000Z",
        receivedAt: "2020-01-01T00:00:00.000Z",
        identity: { sourceProductId: "p", retailerId: "target", retailerSku: "1", canonicalUrl: "https://www.target.com/p/-/A-1", title: "T" },
        offer: { availability: "in_stock" },
        evidence: {},
        parserVersion: "trackalacker-push-v1"
      } as never, NOW);
      assert.equal(db.get<{ at: string }>(
        "SELECT last_event_at AS at FROM source_connections WHERE id = 'source_trackalacker_local'"
      )?.at, new Date(NOW).toISOString());
      const health = new DeliveryHealthRepository(db).snapshot({ devices: [], connectors: [], now: NOW + 1_000 });
      assert.equal(health.receipts.find((receipt) => receipt.key === "signal")?.at, new Date(NOW).toISOString());
    });
  } finally {
    db.close();
  }
});

// ---- 6. Discord envelope rejection is counted ------------------------------

test("a Discord message the envelope builder rejects is counted on the channel", async () => {
  const db = new YoinkDatabase();
  try {
    const channel = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => new SignalProviderRepository(db).createChannel({
      provider: "discord",
      name: "Collector alerts",
      externalReference: "112233445566778899",
      trustLevel: "informational",
      replayWindowSeconds: 900
    }));
    await withServer(db, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/internal/delivery/discord/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl },
        body: JSON.stringify({ contractVersion: 1, channelId: channel.id, messageId: "x", observedAt: new Date().toISOString(), summary: "", facts: null })
      });
      assert.equal(response.status >= 400 && response.status < 500, true, `rejected as a client error (got ${response.status})`);
    });
    const row = db.get<{ rejected: number; code: string }>(
      "SELECT rejected_event_count AS rejected, last_error_code AS code FROM signal_provider_channels WHERE id = ?",
      channel.id
    );
    assert.equal(row?.rejected, 1);
    assert.equal(row?.code, "invalid_signal");
  } finally {
    db.close();
  }
});

// ---- 7. Permanent signal failures dead-letter at once ---------------------

test("a permanently invalid durable signal is dead-lettered on its first failure", () => {
  const db = new YoinkDatabase();
  try {
    runWithRequestScope(WORKER_SCOPE, () => {
      const delivery = new HostedDeliveryRepository(db);
      delivery.acceptInbox({
        source: "trackalacker",
        messageKey: "int-srv-invalid-signal",
        eventType: SIGNAL_INGRESS_EVENT_TYPE,
        payload: { garbage: true }
      }, NOW);
      const result = new DurableSignalIngressProcessor(db).processBatch(NOW + 1);
      assert.equal(result.signalMessagesDeadLettered, 1);
      assert.equal(result.signalMessagesRetried, 0);
      assert.equal(db.get<{ state: string; code: string }>(
        "SELECT state, last_error_code AS code FROM inbox_messages WHERE message_key = 'int-srv-invalid-signal'"
      )?.state, "dead_letter");

      // The repository method on its own: a leased message goes straight to dead_letter.
      delivery.acceptInbox({ source: "trackalacker", messageKey: "int-srv-direct", eventType: "stock_update", payload: { a: 1 } }, NOW + 2);
      const lease = delivery.leaseInbox(60, NOW + 3);
      assert.ok(lease);
      assert.equal(delivery.deadLetterInbox(lease.id, lease.capabilityToken, "signal_rejected_invalid", NOW + 4), "dead_letter");
      assert.equal(db.get<{ state: string; code: string }>(
        "SELECT state, last_error_code AS code FROM inbox_messages WHERE id = ?", lease.id
      )?.code, "signal_rejected_invalid");
    });
  } finally {
    db.close();
  }
});

// ---- 8. Worker runtime clock and health window -------------------------------

test("each task reads the clock when it runs, and health tolerates a slow poll interval", async () => {
  const db = new YoinkDatabase();
  try {
    let clock = NOW;
    const seen: number[] = [];
    const handler: BackgroundWorkerTaskHandler = {
      async execute(_context, _kind, now) {
        seen.push(now);
        clock += 10_000; // every task takes 10 s of "wall" time
        return {};
      }
    };
    const runtime = new BackgroundWorkerRuntime({
      store: new SqliteBackgroundWorkerStore(db, { principalMode: "fixed" }),
      handler,
      version: "int-srv",
      deploymentFingerprint: "a".repeat(64),
      pollIntervalMs: 60_000,
      maximumTasksPerCycle: 3,
      clock: () => clock
    });
    await runtime.runOnce();
    assert.equal(seen.length, 3);
    assert.deepEqual(seen, [NOW, NOW + 10_000, NOW + 20_000], "no task acts on the cycle's start time");
    // Heartbeat is stamped at the end of the cycle; with a 60 s interval the
    // healthy window is 120 s, not the fixed 30 s.
    (runtime as unknown as { runtimeState: string }).runtimeState = "running";
    assert.equal(runtime.status(clock + 90_000).healthy, true);
    assert.equal(runtime.status(clock + 121_000).healthy, false);

    // An explicit timestamp still pins the whole cycle.
    seen.length = 0;
    await runtime.runOnce(NOW + 1_000_000);
    assert.ok(seen.every((value) => value === NOW + 1_000_000));
  } finally {
    db.close();
  }
});

// ---- 9. Signal history retention runs in the local maintenance task ---------

test("local operational telemetry retention also prunes raw signal history", async () => {
  const db = new YoinkDatabase();
  try {
    const result = await new BackgroundMaintenanceHandler(db).execute({
      principal: { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID },
      workerId: "int_srv_worker",
      runtimeKind: "local_in_process",
      runtimeVersion: "int-srv",
      deploymentFingerprint: "a".repeat(64)
    }, "operational_telemetry_retention", NOW) as Record<string, unknown>;
    assert.equal(result.deletedSignalEvents, 0);
    assert.equal(result.deletedNotificationDeliveries, 0);
    assert.equal(typeof result.signalHistoryCutoffAt, "string");
  } finally {
    db.close();
  }
});
