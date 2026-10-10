import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

const source = readFileSync("apps/extension/background.js", "utf8");
const fingerprint = "a".repeat(64);
const healthySubscription = { fingerprint };

function functionSource(name: string): string {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n}", start);
  assert.ok(end > start, name);
  return source.slice(start, end + 2);
}

// `permission` is TrackaLacker access as chrome.permissions.contains reports
// it; left out, any permission check is a forbidden call.
function fixture(overrides: Record<string, unknown> = {}, options: { permission?: boolean } = {}) {
  let now = 1_000_000;
  let reads = 0;
  let writes = 0;
  let enrollmentCalls = 0;
  const enrollmentOptions: unknown[] = [];
  let alarm: (value: { name: string }) => void;
  let healthObserved: Record<string, unknown> | undefined;
  let read: () => Promise<unknown> = async () => healthySubscription;
  const forbiddenCalls: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const memory: Record<string, any> = { state: {
    enabled: true, state: "ready", ready: true, subscriptionPresent: true,
    registeredFingerprint: fingerprint, lastRegistrationAt: "2026-10-02T04:06:40.148Z",
    lastDeliveryAt: "2026-10-02T04:10:23.220Z", errorCode: "", ...overrides
  } };
  const noop = async () => undefined;
  const forbidden = (name: string) => async () => {
    forbiddenCalls.push(name);
    throw new Error(`Unexpected ${name}`);
  };
  const context = createContext({
    Date: class extends Date { static override now() { return now; } },
    setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    TRACKALACKER_PUSH_STATE_KEY: "state", TRACKALACKER_PUSH_QUEUE_LIMIT: 50,
    TRACKALACKER_SUBSCRIPTION_READ_TIMEOUT_MS: 5000, TRACKALACKER_SUBSCRIPTION_RETRY_MS: 60000,
    TRACKALACKER_ORIGINS: [], ACTION_HANDOFF_WAIT_MS: 0, EXTENSION_VERSION: "1.30.5",
    TRACKALACKER_AUTO_RECONNECT_KEY: "autoReconnect", TRACKALACKER_AUTO_RECONNECT_SPACING_MS: 30 * 60_000,
    HEALTH_ALARM: "health", JOB_ALARM: "job", WATCH_QUEUE_ALARM: "watch", AUTO_REVERIFICATION_ALARM: "auto",
    TRACKALACKER_SYNC_ALARM: "trackalacker-sync", runScheduledTrackalackerSync: forbidden("library sync on the health alarm"),
    BARCODE_CHECK_ALARM: "barcode-check", runBarcodeChecks: forbidden("barcode check on the health alarm"),
    trackalackerStateQueue: Promise.resolve(), trackalackerEnrollmentPromise: null,
    trackalackerReconciliationPromise: null, trackalackerSubscriptionRetryAt: 0,
    registration: { pushManager: {
      getSubscription: async () => { reads++; return read(); },
      subscribe: forbidden("subscribe")
    } },
    TrackalackerPush: {
      subscriptionFingerprint: async (value: { fingerprint: string }) => value.fingerprint,
      ensureSilentPushSubscription: forbidden("ensureSilentPushSubscription")
    },
    chrome: {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: structuredClone(memory[key]) }),
          set: async (values: Record<string, unknown>) => { writes++; Object.assign(memory, structuredClone(values)); },
          setAccessLevel: noop
        }, session: { setAccessLevel: noop }
      },
      alarms: { onAlarm: { addListener: (listener: typeof alarm) => { alarm = listener; } } },
      permissions: { contains: options.permission === undefined ? forbidden("permissions") : async () => options.permission },
      tabs: { query: forbidden("tabs.query"), get: forbidden("tabs.get"), create: forbidden("tabs.create") },
      scripting: { executeScript: forbidden("executeScript") }
    },
    // Synthetic token is memory-only; request never accesses a server.
    storedDevice: async () => ({ token: "fixture-memory-only" }),
    readTrackalackerQueue: async () => [],
    request: async (_path: string, options: { body: string }) => { posted.push(JSON.parse(options.body)); },
    performTrackalackerEnrollment: async (_force: boolean, enrollment: unknown) => {
      enrollmentCalls++;
      enrollmentOptions.push(JSON.parse(JSON.stringify(enrollment ?? {})));
      memory.state = { ...memory.state, state: "ready", ready: true, subscriptionPresent: true, registeredFingerprint: fingerprint };
      return memory.state;
    },
    createCompanionAlarms: noop, ensureContextMenus: noop,
    checkHealth: async () => { healthObserved = structuredClone(memory.state); return {}; },
    reconcileActionHandoffs: noop, reconcileReverificationRestart: noop,
    drainAdapterDiagnosticQueue: noop, drainEvidenceCapsuleQueue: noop,
    drainTrackalackerQueue: async () => ({ delivered: 0, state: memory.state }),
    runSignalActionHandoff: noop, runWatchQueueCycle: noop, requestWarmReadinessCycle: noop,
    runAutomaticReverification: noop, runNotificationCycle: noop,
    recordLoopOutcome: forbidden("loop failure"), loopOutcomeFromError: () => ({})
  });
  const names = ["normalizeTrackalackerState", "readTrackalackerState", "updateTrackalackerState",
    "postTrackalackerStatus", "runSignalDeliveryCycle", "reconcileTrackalackerSubscription",
    "handleTrackalackerSubscriptionChange", "connectTrackalacker", "reconnectTrackalackerAutomatically", "initialize"];
  runInContext(names.map(functionSource).join("\n"), context);
  const alarmStart = source.indexOf("chrome.alarms.onAlarm.addListener(");
  runInContext(source.slice(alarmStart, source.indexOf("\n});", alarmStart) + 4), context);
  return {
    context, memory, posted, timers, forbiddenCalls, enrollmentOptions,
    stats: () => ({ reads, writes, enrollmentCalls }),
    setRead: (next: typeof read) => { read = next; },
    advance: (ms: number) => { now += ms; },
    healthObserved: () => healthObserved,
    alarm: () => alarm!({ name: "health" }),
    run: () => runInContext("reconcileTrackalackerSubscription()", context) as Promise<any>,
    invoke: (expression: string) => runInContext(expression, context) as Promise<any>
  };
}

async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function noEnrollment(f: ReturnType<typeof fixture>) {
  assert.equal(f.stats().enrollmentCalls, 0);
  assert.deepEqual(f.forbiddenCalls, []);
  assert.equal(f.timers.size, 0);
}

test("initialization discovers missing subscription before health and posts Reconnect status", async () => {
  const f = fixture(); f.setRead(async () => null);
  await f.invoke("initialize()");
  assert.equal(f.stats().reads, 1);
  assert.equal(f.healthObserved()?.ready, false);
  assert.equal(f.memory.state.state, "awaiting_page");
  assert.equal(f.memory.state.registeredFingerprint, "");
  assert.equal(f.memory.state.errorCode, "missing_subscription");
  assert.equal(f.posted.at(-1)?.subscriptionPresent, false);
  assert.equal(f.posted.at(-1)?.ready, false);
  assert.equal(f.memory.state.lastRegistrationAt, "2026-10-02T04:06:40.148Z");
  assert.equal(f.memory.state.lastDeliveryAt, "2026-10-02T04:10:23.220Z");
  noEnrollment(f);
});

test("health alarm reconciles actual subscription before presenting and publishing status", async () => {
  // Without TrackaLacker access the alarm can only report; Reconnect asks for access.
  const f = fixture({}, { permission: false }); f.setRead(async () => null); f.alarm(); await flush();
  assert.equal(f.stats().reads, 1);
  assert.equal(f.healthObserved()?.ready, false);
  assert.equal(f.posted.at(-1)?.subscriptionPresent, false);
  noEnrollment(f);
});

test("healthy acknowledged subscription is a no-op and disabled intake is not inspected", async () => {
  const f = fixture(); await f.run(); await f.run();
  assert.equal(f.stats().reads, 2); assert.equal(f.stats().writes, 0);
  assert.equal(f.memory.state.ready, true); noEnrollment(f);
  const disabled = fixture({ enabled: false, state: "disabled", ready: false });
  await disabled.run(); assert.equal(disabled.stats().reads, 0); noEnrollment(disabled);
});

test("read failure is unready, bounded to one retry per minute, then recovers matching acknowledgement", async () => {
  const f = fixture(); f.setRead(async () => { throw new Error("private failure details"); });
  await f.run();
  assert.equal(f.memory.state.ready, false); assert.equal(f.memory.state.subscriptionPresent, false);
  assert.equal(f.memory.state.errorCode, "push_subscription_read_failed");
  assert.equal(f.memory.state.registeredFingerprint, fingerprint);
  await f.run(); f.advance(59999); await f.run(); assert.equal(f.stats().reads, 1);
  f.advance(1); f.setRead(async () => healthySubscription); await f.run();
  assert.equal(f.stats().reads, 2); assert.equal(f.memory.state.ready, true);
  assert.equal(f.memory.state.errorCode, ""); noEnrollment(f);
});

test("concurrent checks share one observation and one status update", async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  f.setRead(() => new Promise(done => { resolve = done; }));
  const first = f.run(); const second = f.run(); assert.equal(first, second);
  await flush(); assert.equal(f.stats().reads, 1); resolve(null);
  await Promise.all([first, second]); assert.equal(f.stats().writes, 1); noEnrollment(f);
});

test("hung reads time out; a late result cannot overwrite missing or reconnected status", async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  f.setRead(() => new Promise(done => { resolve = done; }));
  const pending = f.run(); await flush();
  assert.equal(f.timers.size, 1); [...f.timers.values()][0]!(); await pending;
  assert.equal(f.memory.state.errorCode, "push_subscription_read_failed");
  f.advance(60000); f.setRead(async () => null); await f.run();
  resolve(healthySubscription); await flush();
  assert.equal(f.memory.state.errorCode, "missing_subscription"); noEnrollment(f);
});

test("subscriptionchange remains read-only even with a gone tab; repeat checks do not enroll", async () => {
  const f = fixture(); f.setRead(async () => null);
  await f.invoke("handleTrackalackerSubscriptionChange()");
  f.advance(60000); await f.run();
  assert.equal(f.memory.state.state, "awaiting_page");
  assert.equal(f.posted.at(-1)?.ready, false);
  noEnrollment(f); // All tab, permission, scripting and subscribe APIs throw if touched.
});

test("present but unacknowledged replacement is not promoted to ready", async () => {
  const f = fixture(); f.setRead(async () => ({ fingerprint: "b".repeat(64) }));
  await f.run(); assert.equal(f.memory.state.subscriptionPresent, true);
  assert.equal(f.memory.state.ready, false); assert.equal(f.memory.state.state, "awaiting_page");
  assert.equal(f.memory.state.registeredFingerprint, ""); noEnrollment(f);
});

test("healthy subscription does not erase a provider registration failure", async () => {
  const f = fixture({ state: "error", ready: false, errorCode: "http_error", lastHttpStatus: 401 });
  await f.run(); assert.equal(f.memory.state.ready, false);
  assert.equal(f.memory.state.errorCode, "http_error"); noEnrollment(f);
});

test("Reconnect enrolls only after any older status check finishes", async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  f.setRead(() => new Promise(done => { resolve = done; }));
  const checking = f.run(); await flush();
  const reconnecting = f.invoke("connectTrackalacker(false)"); await flush();
  assert.equal(f.stats().enrollmentCalls, 0); resolve(null);
  await Promise.all([checking, reconnecting]);
  assert.equal(f.stats().enrollmentCalls, 1); assert.equal(f.memory.state.ready, true);
  assert.equal(f.memory.state.registeredFingerprint, fingerprint);
  assert.deepEqual(f.forbiddenCalls, []);
});

test("missing PushManager and failed fingerprint observation remain truthful and retryable", async () => {
  const unavailable = fixture(); unavailable.context.registration = {};
  await unavailable.run(); assert.equal(unavailable.memory.state.errorCode, "push_api_unavailable");
  assert.equal(unavailable.memory.state.ready, false); noEnrollment(unavailable);
  const invalid = fixture(); invalid.setRead(async () => ({ fingerprint: "" }));
  await invalid.run(); assert.equal(invalid.memory.state.subscriptionPresent, true);
  assert.equal(invalid.memory.state.ready, false);
  assert.equal(invalid.memory.state.errorCode, "subscription_fingerprint_failed"); noEnrollment(invalid);
});

test("a lost registration reconnects by itself on the health alarm: once per version, then every 30 minutes", async () => {
  // A local update reloads the companion, and the reload deletes the push subscription.
  const f = fixture({}, { permission: true }); f.setRead(async () => null);
  f.alarm(); await flush(); await flush();
  assert.equal(f.stats().enrollmentCalls, 1);
  assert.deepEqual(f.enrollmentOptions, [{ automatic: true }], "an automatic reconnect opens TrackaLacker in the background");
  assert.equal(f.memory.state.ready, true);
  f.advance(60_000); f.alarm(); await flush(); await flush();
  assert.equal(f.memory.state.ready, false, "the subscription is still missing");
  assert.equal(f.stats().enrollmentCalls, 1, "the same version waits 30 minutes before trying again");
  f.advance(30 * 60_000); f.alarm(); await flush(); await flush();
  assert.equal(f.stats().enrollmentCalls, 2);
  f.advance(60_000); await f.invoke("EXTENSION_VERSION = '1.30.6'"); f.alarm(); await flush(); await flush();
  assert.equal(f.stats().enrollmentCalls, 3, "the next update reconnects right away");
  assert.deepEqual(f.forbiddenCalls, []);
});

test("automatic reconnect never starts a connection that was never set up, is off, is healthy or lacks access", async () => {
  for (const [state, permission] of [
    [{ lastRegistrationAt: "" }, true],
    [{ enabled: false, state: "disabled", ready: false }, true],
    [{}, false]
  ] as Array<[Record<string, unknown>, boolean]>) {
    const f = fixture(state, { permission }); f.setRead(async () => null);
    f.alarm(); await flush(); await flush();
    assert.equal(f.stats().enrollmentCalls, 0, JSON.stringify(state));
  }
  const healthy = fixture(); healthy.alarm(); await flush(); await flush();
  assert.equal(healthy.stats().enrollmentCalls, 0);
  assert.deepEqual(healthy.forbiddenCalls, [], "a healthy connection is not even checked for access");
});
