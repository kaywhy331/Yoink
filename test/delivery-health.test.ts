import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_OBSERVATION_STALE_AFTER_MS,
  DEVICE_POLL_SILENCE_MS,
  GENERIC_SOURCE_STALE_AFTER_MS,
  NOTIFY_JOB_LIFETIME_SECONDS,
  TRACKALACKER_STALE_AFTER_MS,
  TRACKALACKER_STALE_WITH_PLANS_MS,
  buildDeliveryHealth,
  sourceFreshness,
  trackingNeedsReconnect,
  type DeliveryDeviceInput,
  type DeliveryHealthInput,
  type SourceFreshnessInput
} from "../packages/domain/src/delivery-health.js";
import { buildUserSetupReadiness } from "../packages/domain/src/user-setup.js";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

type PushInput = NonNullable<SourceFreshnessInput["trackalacker"]>;

function push(overrides: Partial<PushInput> = {}): PushInput {
  return {
    ready: true,
    state: "registered",
    errorCode: "",
    lastHttpStatus: 201,
    lastRegistrationAt: "",
    lastNotificationAt: "",
    lastDeliveryAt: "",
    deviceName: "Laptop",
    ...overrides
  };
}

function freshnessInput(overrides: Partial<SourceFreshnessInput> = {}): SourceFreshnessInput {
  return {
    source: "trackalacker",
    // The stored bit is "connected" forever; freshness must never echo it blindly.
    status: "connected",
    lastEventAt: "",
    lastSignalAt: "",
    lastSyncAt: "",
    activePlans: 0,
    now: NOW,
    trackalacker: push(),
    device: null,
    ...overrides
  };
}

test("TrackaLacker freshness: not registered, failed, never, fresh, stale, and future timestamps", () => {
  const cases: Array<{ name: string; input: Partial<SourceFreshnessInput>; state: string; status: string; recovery: boolean }> = [
    { name: "no push registration", input: { trackalacker: null }, state: "unknown", status: "disconnected", recovery: true },
    { name: "push not ready", input: { trackalacker: push({ ready: false }) }, state: "unknown", status: "disconnected", recovery: true },
    {
      name: "push registration failed",
      input: { trackalacker: push({ ready: false, errorCode: "subscription_expired", lastHttpStatus: 410 }) },
      state: "unknown",
      status: "error",
      recovery: true
    },
    { name: "registered, nothing yet", input: {}, state: "never", status: "connected", recovery: false },
    { name: "fresh", input: { lastSignalAt: ago(60_000) }, state: "fresh", status: "connected", recovery: false },
    {
      name: "stale without plans",
      input: { trackalacker: push({ lastDeliveryAt: ago(TRACKALACKER_STALE_AFTER_MS + 60_000) }) },
      state: "stale",
      status: "stale",
      recovery: true
    },
    {
      name: "stale sooner with active plans",
      input: { activePlans: 1, lastSignalAt: ago(TRACKALACKER_STALE_WITH_PLANS_MS + 60_000) },
      state: "stale",
      status: "stale",
      recovery: true
    },
    {
      name: "not stale at the plan-free bound yet",
      input: { lastSignalAt: ago(TRACKALACKER_STALE_WITH_PLANS_MS + 60_000) },
      state: "fresh",
      status: "connected",
      recovery: false
    },
    { name: "future timestamp counts as just now", input: { lastSignalAt: ago(-60_000) }, state: "fresh", status: "connected", recovery: false }
  ];
  for (const testCase of cases) {
    const freshness = sourceFreshness(freshnessInput(testCase.input));
    assert.equal(freshness.state, testCase.state, testCase.name);
    assert.equal(freshness.status, testCase.status, testCase.name);
    assert.equal(freshness.recovery !== null, testCase.recovery, testCase.name);
  }
  const failed = sourceFreshness(freshnessInput({ trackalacker: push({ ready: false, errorCode: "subscription_expired", lastHttpStatus: 410 }) }));
  assert.match(failed.detail, /Push registration failed \(subscription expired, HTTP 410\)/);
  assert.equal(sourceFreshness(freshnessInput({ lastSignalAt: ago(-60_000) })).ageMs, 0);
});

test("browser and generic source freshness", () => {
  const online = sourceFreshness(freshnessInput({ source: "browser", device: { online: true, lastSeenAt: ago(1_000), name: "Laptop" } }));
  assert.deepEqual([online.state, online.status, online.recovery], ["fresh", "connected", null]);
  // A paired companion that is offline needs Chrome opened, not a new pairing.
  const offline = sourceFreshness(freshnessInput({ source: "browser", device: { online: false, lastSeenAt: ago(BROWSER_OBSERVATION_STALE_AFTER_MS * 2), name: "Laptop" } }));
  assert.deepEqual([offline.state, offline.status, offline.recovery?.code], ["stale", "disconnected", "open_companion"]);
  const unpaired = sourceFreshness(freshnessInput({ source: "browser", device: null }));
  assert.deepEqual([unpaired.state, unpaired.status, unpaired.recovery?.code], ["never", "disconnected", "pair_companion"]);

  const generic = (overrides: Partial<SourceFreshnessInput>) => sourceFreshness(freshnessInput({ source: "discord", trackalacker: null, ...overrides }));
  assert.deepEqual([generic({ status: "disconnected" }).state, generic({ status: "disconnected" }).status], ["unknown", "disconnected"]);
  assert.equal(generic({}).state, "never");
  assert.equal(generic({ lastEventAt: ago(60_000) }).state, "fresh");
  const quiet = generic({ lastEventAt: ago(GENERIC_SOURCE_STALE_AFTER_MS + 60_000) });
  assert.deepEqual([quiet.state, quiet.status], ["stale", "stale"]);

  // Links added by hand and scheduled drop windows have no feed that can go
  // quiet: they keep their stored status and never age to "stale".
  const month = 30 * 24 * 60 * 60_000;
  const links = sourceFreshness(freshnessInput({ source: "user_link", status: "manual", trackalacker: null, lastEventAt: ago(month) }));
  assert.deepEqual([links.state, links.status, links.recovery, links.staleAfterMs], ["fresh", "manual", null, 0]);
  assert.doesNotMatch(links.detail, /not connected|quiet/i);
  const drops = sourceFreshness(freshnessInput({ source: "drop_window", status: "connected", trackalacker: null, lastEventAt: ago(month) }));
  assert.deepEqual([drops.state, drops.status, drops.recovery], ["fresh", "connected", null]);
  assert.match(drops.detail, /^Scheduled drop windows; last activity 30 d ago\.$/);
  const unusedDrops = sourceFreshness(freshnessInput({ source: "drop_window", status: "disconnected", trackalacker: null }));
  assert.deepEqual([unusedDrops.state, unusedDrops.status], ["never", "disconnected"]);
  // A Discord or webhook feed still ages after a day without a call.
  assert.equal(generic({ source: "webhook", lastEventAt: ago(month) }).status, "stale");
});

test("a quiet or failed tracking feed needs reconnecting even while browser observations are online", () => {
  const browserOnline = { source: "browser", status: "connected" };
  assert.equal(trackingNeedsReconnect([{ source: "trackalacker", status: "stale" }, browserOnline]), true);
  assert.equal(trackingNeedsReconnect([{ source: "trackalacker", status: "error" }]), true);
  assert.equal(trackingNeedsReconnect([{ source: "trackalacker", status: "stale" }, { source: "discord", status: "connected" }]), false,
    "another connected feed keeps tracking live");
  assert.equal(trackingNeedsReconnect([{ source: "trackalacker", status: "disconnected" }, browserOnline]), false,
    "an unregistered feed is not an outage");
  assert.equal(trackingNeedsReconnect([browserOnline, { source: "user_link", status: "manual" }]), false);
  assert.equal(trackingNeedsReconnect([{ source: "trackalacker", status: "stale" }, { source: "drop_window", status: "connected" }]), true,
    "scheduled drop windows do not stand in for a quiet feed");

  const base = {
    version: "0.32.0",
    devices: [{ status: "active", extensionVersion: "0.32.0", online: true }],
    products: 1,
    pendingProductProposals: 0,
    plans: [{ status: "active", actionCeiling: "notify" }],
    actionsPaused: true,
    executionMode: "shadow"
  };
  const staleFeed = sourceFreshness(freshnessInput({ activePlans: 1, lastSignalAt: ago(TRACKALACKER_STALE_WITH_PLANS_MS + 60_000) }));
  const setup = buildUserSetupReadiness({
    ...base,
    sources: [{ source: "trackalacker", status: staleFeed.status, freshness: staleFeed }, browserOnline]
  });
  assert.equal(setup.connectedSignalCount, 0);
  assert.equal(setup.level, "needs_signal");
  assert.equal(setup.headline, "Plan saved. Reconnect product tracking");
  const signal = setup.steps.find((step) => step.id === "signal");
  assert.equal(signal?.state, "attention");
  assert.equal(signal?.title, "Reconnect your product tracking");

  // Without any feed, browser observations still count as a call source.
  assert.equal(buildUserSetupReadiness({ ...base, sources: [browserOnline] }).connectedSignalCount, 1);
});

test("setup never marks tracking complete for an unregistered or failed TrackaLacker push", () => {
  const base = {
    version: "0.32.0",
    devices: [{ status: "active", extensionVersion: "0.32.0", online: true }],
    products: 1,
    pendingProductProposals: 0,
    plans: [],
    actionsPaused: true,
    executionMode: "shadow"
  };
  const signalStep = (freshness: ReturnType<typeof sourceFreshness>) => {
    const setup = buildUserSetupReadiness({ ...base, sources: [{ source: "trackalacker", status: freshness.status, freshness }] });
    return { step: setup.steps.find((step) => step.id === "signal"), connected: setup.connectedSignalCount };
  };
  const fresh = signalStep(sourceFreshness(freshnessInput({ lastSignalAt: ago(60_000) })));
  assert.equal(fresh.step?.state, "complete");
  assert.equal(fresh.connected, 1);

  const unregistered = signalStep(sourceFreshness(freshnessInput({ trackalacker: null })));
  assert.notEqual(unregistered.step?.state, "complete");
  assert.equal(unregistered.step?.title, "Connect your product tracking");
  assert.equal(unregistered.connected, 0);

  const failed = signalStep(sourceFreshness(freshnessInput({ trackalacker: push({ ready: false, errorCode: "subscription_expired", lastHttpStatus: 410 }) })));
  assert.equal(failed.step?.title, "Reconnect your product tracking");
  assert.equal(failed.step?.state, "attention");
  assert.match(failed.step?.summary ?? "", /Push registration failed/);

  const stale = signalStep(sourceFreshness(freshnessInput({ lastSignalAt: ago(TRACKALACKER_STALE_AFTER_MS + 60_000) })));
  assert.equal(stale.step?.title, "Reconnect your product tracking");
  assert.match(stale.step?.summary ?? "", /Re-register from the companion popup/);
});

test("setup says Request resume only while an approval is pending", () => {
  const input = {
    version: "0.32.0",
    devices: [{ status: "active", extensionVersion: "0.32.0", online: true }],
    sources: [{ source: "trackalacker", status: "connected" }],
    products: 1,
    pendingProductProposals: 0,
    plans: [{ id: "plan_1", status: "active", actionCeiling: "add_to_cart" }],
    actionsPaused: true,
    executionMode: "live"
  };
  const action = (resumePendingApproval: boolean) => buildUserSetupReadiness({ ...input, resumePendingApproval })
    .steps.find((step) => step.id === "action");
  assert.equal(action(false)?.primaryAction, "resume_actions");
  assert.equal(action(false)?.primaryActionLabel, "Turn on Auto-cart");
  assert.equal(action(true)?.primaryActionLabel, "Ask to turn on Auto-cart");
});

function device(overrides: Partial<DeliveryDeviceInput> = {}): DeliveryDeviceInput {
  return {
    id: "device_1",
    name: "Laptop",
    online: true,
    lastSeenAt: ago(1_000),
    lastNotificationPollAt: ago(10_000),
    lastJobPollAt: "",
    notificationsCapable: true,
    ...overrides
  };
}

function health(overrides: Partial<DeliveryHealthInput> = {}): DeliveryHealthInput {
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
    devices: [device()],
    connectors: { total: 0, enabled: 0, bound: 0 },
    activePlans: 1,
    cartFreshnessSeconds: 120,
    notifyLifetimeSeconds: NOTIFY_JOB_LIFETIME_SECONDS,
    testAlert: null,
    ...overrides
  };
}

test("delivery health poll state and next action", () => {
  const cases: Array<[Partial<DeliveryHealthInput>, string, string | null]> = [
    [{ devices: [] }, "unpaired", "pair_companion"],
    [{ devices: [device({ online: false })] }, "offline", "open_companion"],
    [{ devices: [device({ lastNotificationPollAt: "", lastJobPollAt: "" })] }, "never", "reload_companion"],
    [{ devices: [device({ lastNotificationPollAt: ago(DEVICE_POLL_SILENCE_MS + 1_000) })] }, "silent", "reload_companion"],
    // A job poll alone counts as asking.
    [{ devices: [device({ lastNotificationPollAt: "", lastJobPollAt: ago(5_000) })] }, "polling", "send_test_alert"],
    [{ devices: [device(), device({ id: "device_2", online: false })] }, "polling", "send_test_alert"]
  ];
  for (const [overrides, pollState, nextAction] of cases) {
    const result = buildDeliveryHealth(health(overrides));
    assert.equal(result.channel.pollState, pollState, JSON.stringify(overrides));
    assert.equal(result.nextAction?.code ?? null, nextAction, JSON.stringify(overrides));
  }
});

test("delivery health receipts: waiting, delivered, and undelivered streaks", () => {
  const waiting = buildDeliveryHealth(health());
  assert.equal(waiting.receipts.find((receipt) => receipt.key === "signal")?.state, "waiting");
  assert.equal(waiting.receipts.find((receipt) => receipt.key === "lease")?.state, "ok");
  assert.equal(waiting.headline, "Ready to deliver to Laptop.");

  const delivered = buildDeliveryHealth(health({
    lastSignalAt: ago(60_000),
    lastJobAt: ago(59_000),
    lastDeliveredAt: ago(50_000),
    notifications: { windowDays: 7, created: 1, delivered: 1, expired: 0, failed: 0, pending: 0 }
  }));
  assert.equal(delivered.state, "ok");
  assert.equal(delivered.headline, "Calls reach Laptop.");
  assert.equal(delivered.nextAction, null);

  const undelivered = buildDeliveryHealth(health({
    lastSignalAt: ago(60_000),
    lastJobAt: ago(59_000),
    notifications: { windowDays: 7, created: 3, delivered: 0, expired: 3, failed: 0, pending: 0 },
    consecutiveUndelivered: 3,
    dominantFailureCode: "no_device_poll"
  }));
  assert.equal(undelivered.state, "attention");
  assert.equal(undelivered.receipts.find((receipt) => receipt.key === "delivered")?.state, "attention");
  assert.match(undelivered.headline, /^3 calls expired before Chrome could show them\.$/);
  assert.ok(undelivered.nextAction);

  const quiet = buildDeliveryHealth(health({ lastSignalAt: ago(TRACKALACKER_STALE_WITH_PLANS_MS + 60_000) }));
  assert.equal(quiet.receipts.find((receipt) => receipt.key === "signal")?.state, "attention");
  assert.equal(quiet.nextAction?.code, "reconnect_source");

  assert.match(waiting.channel.explanation, /waits up to 24 hours .* expires 2 minutes after the store signal/);
});

test("an undelivered streak older than the window is named as the last calls, and failure labels keep their names", () => {
  const streakOnly = buildDeliveryHealth(health({
    notifications: { windowDays: 7, created: 0, delivered: 0, expired: 0, failed: 0, pending: 0 },
    consecutiveUndelivered: 10,
    dominantFailureCode: "no_device_poll"
  }));
  assert.equal(streakOnly.state, "attention");
  assert.equal(streakOnly.headline, "The last 10 calls expired before Chrome could show them.");
  assert.equal(streakOnly.receipts.find((receipt) => receipt.key === "delivered")?.detail,
    "The last 10 calls expired before Chrome showed them (Chrome never asked).");
  assert.doesNotMatch(JSON.stringify(streakOnly), /\b0 calls\b|chrome never asked/);

  const windowed = buildDeliveryHealth(health({
    notifications: { windowDays: 7, created: 2, delivered: 0, expired: 2, failed: 0, pending: 0 },
    consecutiveUndelivered: 10,
    dominantFailureCode: "job_window_expired"
  }));
  assert.equal(windowed.headline, "2 calls expired before Chrome could show them.");
  assert.equal(windowed.receipts.find((receipt) => receipt.key === "delivered")?.detail,
    "2 calls in the last 7 days expired before Chrome showed them (expired before pickup).");
});
