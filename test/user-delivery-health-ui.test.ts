import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildDeliveryHealth,
  type DeliveryDeviceInput,
  type DeliveryHealthInput,
  type DeliveryTestAlertReceipt
} from "../packages/domain/src/delivery-health.js";

// The shopper app renders the server's delivery health (W2, X-01): Home leads
// with a blocked delivery path, shows the dated receipts, never says "Calls
// are live" without one, and Settings sends a real test alert and watches it.
// Each test loads the real page and bundle into jsdom with a fetch that never
// settles, then drives state and clicks directly.

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

type Browser = Window & typeof globalThis & { close(): void; eval(source: string): unknown } & Record<string, any>;
type FakeResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type Timer = { callback: () => unknown; delay: number; cleared: boolean };

const webRoot = join(process.cwd(), "apps", "web");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const respond = (body: unknown, status = 200): FakeResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });

async function eventually(assertion: () => void, attempts = 60): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

function loadShopper(): { browser: Browser; timers: Timer[] } {
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/#home",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window as Browser;
  const timers: Timer[] = [];
  Object.defineProperty(browser, "fetch", { configurable: true, writable: true, value: () => new Promise<never>(() => undefined) });
  // Page timers are captured, never run on their own: the test fires the
  // test-alert watch tick explicitly.
  Object.defineProperty(browser, "setTimeout", {
    configurable: true,
    value: (callback: () => unknown, delay = 0) => timers.push({ callback, delay: Number(delay), cleared: false })
  });
  Object.defineProperty(browser, "clearTimeout", {
    configurable: true,
    value: (id: number) => { if (timers[id - 1]) timers[id - 1]!.cleared = true; }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "clearInterval", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: false, note: "" }) }
  });
  // The real inline status and toast module, so errors land next to the trigger.
  browser.eval(`${readFileSync(join(webRoot, "status.js"), "utf8")}\n//# sourceURL=status.js`);
  browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\nglobalThis.__deliveryState = state;\n//# sourceURL=user-delivery-health-ui.js`);
  return { browser, timers };
}

function recordingFetch(browser: Browser, handler: (path: string, options: RequestInit) => FakeResponse) {
  const calls: Array<{ path: string; method: string; body: string; headers: Record<string, string> }> = [];
  browser.fetch = (async (path: string, options: RequestInit = {}) => {
    calls.push({
      path: String(path),
      method: String(options.method || "GET"),
      body: String(options.body ?? ""),
      headers: (options.headers || {}) as Record<string, string>
    });
    return handler(String(path), options);
  }) as typeof fetch;
  return calls;
}

function pendingTimers(timers: Timer[], delay: number): Timer[] {
  return timers.filter((timer) => timer.delay === delay && !timer.cleared);
}

function companion(overrides: Partial<DeliveryDeviceInput> = {}): DeliveryDeviceInput {
  return {
    id: "device_windows",
    name: "Desktop - Windows - Chrome",
    online: false,
    lastSeenAt: ago(20 * DAY),
    lastNotificationPollAt: "",
    lastJobPollAt: "",
    notificationsCapable: true,
    platform: "windows",
    loopHealth: {},
    accessibleRetailers: null,
    ...overrides
  };
}

// The live instance on 2026-09-28: one paired Windows companion offline for
// 20 days, 31 notify-only plans, a source quiet for a month, every call expired.
function liveHealth(overrides: Partial<DeliveryHealthInput> = {}) {
  return JSON.parse(JSON.stringify(buildDeliveryHealth({
    now: Date.now(),
    lastSignalAt: ago(30 * DAY),
    lastJobAt: ago(30 * DAY),
    lastLeaseAt: "",
    lastDeliveredAt: "",
    lastCartReadyAt: "",
    notifications: { windowDays: 7, created: 0, delivered: 0, expired: 0, failed: 0, pending: 0 },
    pendingNotifications: 0,
    consecutiveUndelivered: 10,
    dominantFailureCode: "no_device_poll",
    devices: [companion()],
    connectors: { total: 0, enabled: 0, bound: 0 },
    activePlans: 31,
    cartFreshnessSeconds: 120,
    notifyLifetimeSeconds: 86_400,
    testAlert: null,
    ...overrides
  })));
}

// A healthy channel: the companion polled a minute ago and the last call was delivered.
function healthyHealth(overrides: Partial<DeliveryHealthInput> = {}) {
  return liveHealth({
    lastSignalAt: ago(3 * 60 * MINUTE),
    lastJobAt: ago(3 * 60 * MINUTE),
    lastLeaseAt: ago(3 * 60 * MINUTE),
    lastDeliveredAt: ago(3 * 60 * MINUTE),
    notifications: { windowDays: 7, created: 3, delivered: 3, expired: 0, failed: 0, pending: 0 },
    consecutiveUndelivered: 0,
    dominantFailureCode: "",
    devices: [companion({ online: true, lastSeenAt: ago(MINUTE), lastNotificationPollAt: ago(MINUTE), lastJobPollAt: ago(MINUTE) })],
    ...overrides
  });
}

function testAlert(overrides: Partial<DeliveryTestAlertReceipt> = {}): DeliveryTestAlertReceipt {
  return {
    requestedAt: ago(0),
    jobId: "action_job_test",
    deliveryId: "notification_delivery_test",
    state: "pending",
    attempts: 0,
    deliveredAt: "",
    failureCode: "",
    title: "Test product",
    ...overrides
  };
}

const STEP_TITLES: Record<string, string> = {
  companion: "Install and pair Chrome",
  signal: "Connect your product tracking",
  product: "Choose an exact product",
  plan: "Set your price and action",
  action: "Turn on cart adds"
};

function setupSteps(states: Record<string, string> = {}) {
  return Object.keys(STEP_TITLES).map((id) => ({
    id,
    title: STEP_TITLES[id],
    state: states[id] ?? "complete",
    summary: `Summary for the ${id} step.`,
    primaryAction: null,
    primaryActionLabel: "",
    secondaryAction: null,
    secondaryActionLabel: ""
  }));
}

function overview({
  deliveryHealth,
  steps = setupSteps({ action: "current" }),
  paused = true,
  plans = 31
}: { deliveryHealth?: unknown; steps?: ReturnType<typeof setupSteps>; paused?: boolean; plans?: number }) {
  return {
    settings: { actionsPaused: paused, executionMode: "live" },
    counts: { products: 40, purchaseIntents: plans, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] },
    actionHandoff: { primary: null, counts: {} },
    setup: {
      level: "setup",
      headline: "Finish setting up Chrome",
      summary: "The setup summary.",
      completedSteps: steps.filter((step) => step.state === "complete").length,
      totalSteps: steps.length,
      companion: { downloadUrl: "" },
      steps
    },
    ...(deliveryHealth === undefined ? {} : { deliveryHealth })
  };
}

function showOverview(browser: Browser, value: unknown) {
  browser.__deliveryState.overview = value;
  browser.eval("renderOverview()");
}

const text = (browser: Browser, selector: string) => browser.document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
// The strip's tag words (user.js copy). Domain wording is read from the fixture,
// never asserted literally, so server copy can change without breaking this file.
const TAG_WORDS: Record<string, string> = { ok: "OK", attention: "Attention", waiting: "Waiting", none: "Not yet" };
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("Home leads with a blocked delivery path, shows five dated receipts, and never claims calls are live", () => {
  const { browser } = loadShopper();
  try {
    const health = liveHealth();
    assert.equal(health.channel.pollState, "offline");
    assert.equal(health.state, "attention");

    // Deliberately paused with every other step done: delivery outranks the paused row.
    showOverview(browser, overview({ deliveryHealth: health }));
    assert.equal(text(browser, "#homeHeadline"), health.headline);
    assert.equal(text(browser, "#homeSummary"), health.summary);
    const hero = browser.document.querySelector("#heroState") as HTMLElement;
    assert.equal(hero.classList.contains("contextual"), true);
    assert.ok(hero.querySelector("[data-home-delivery]"));
    assert.match(hero.textContent ?? "", /Desktop - Windows - Chrome/);
    assert.match(hero.textContent ?? "", /Offline · last seen 20 days ago · Never asked for calls/);
    // Opening Chrome happens in Chrome: a step, not a dead button.
    assert.equal(health.nextAction.code, "open_companion");
    assert.equal(text(browser, "#heroState .delivery-instruction"), health.nextAction.label);
    assert.equal(hero.querySelectorAll("button").length, 0);

    const strip = browser.document.querySelector("#homeDelivery") as HTMLElement;
    assert.equal(strip.hidden, false);
    const receipts = [...strip.querySelectorAll("[data-delivery-receipt]")] as HTMLElement[];
    assert.deepEqual(receipts.map((item) => item.dataset.deliveryReceipt), ["signal", "job", "lease", "delivered", "cart_ready"]);
    receipts.forEach((item, index) => {
      const receipt = health.receipts[index];
      assert.equal(item.querySelector(".delivery-receipt-label")?.textContent, receipt.label);
      assert.equal(item.querySelector(".tag")?.textContent, TAG_WORDS[receipt.state]);
      assert.equal(item.classList.contains(receipt.state), true);
    });
    assert.equal(receipts[0]!.querySelector("strong")?.textContent, "30 days ago");
    assert.equal(health.receipts[0].state, "attention");
    assert.equal(receipts[2]!.querySelector("strong")?.textContent, "Never", "Chrome never asked");
    assert.equal(receipts[0]!.querySelector("time")?.getAttribute("datetime"), health.receipts[0].at);
    assert.equal(receipts[0]!.querySelector("small")?.classList.contains("sr-only"), false, "attention details stay visible");
    assert.equal(receipts[4]!.querySelector("small")?.classList.contains("sr-only"), true, "other details are for screen readers");
    // The hero already carries the lever, so the strip does not repeat it.
    assert.equal(strip.querySelector(".delivery-next"), null);
    assert.ok(strip.querySelector('[data-open-settings="notifications"]'));

    // A downstream setup step (turning on cart adds) also yields to delivery.
    showOverview(browser, overview({ deliveryHealth: health, paused: false, steps: setupSteps({ action: "current" }) }));
    assert.equal(text(browser, "#homeHeadline"), health.headline);
    assert.doesNotMatch(browser.document.body.textContent ?? "", /Calls are live/);
  } finally {
    browser.close();
  }
});

test("an upstream Chrome setup step keeps Home's priority while the receipts strip stays visible", () => {
  const { browser } = loadShopper();
  try {
    const health = liveHealth();
    showOverview(browser, overview({ deliveryHealth: health, steps: setupSteps({ companion: "attention", action: "current" }) }));
    assert.equal(text(browser, "#homeHeadline"), "Finish setting up Chrome");
    const hero = browser.document.querySelector("#heroState") as HTMLElement;
    assert.ok(hero.querySelector("[data-home-setup]"));
    assert.equal(hero.querySelector("[data-home-delivery]"), null);
    assert.match(text(browser, "#homeNextActionTitle"), /Install and pair Chrome/);
    const strip = browser.document.querySelector("#homeDelivery") as HTMLElement;
    assert.equal(strip.hidden, false);
    assert.equal(strip.querySelectorAll("[data-delivery-receipt]").length, 5);
    // The hero shows setup, so the strip carries the delivery lever.
    assert.equal(text(browser, "#homeDelivery .delivery-next"), health.nextAction.label);

    // The tracking step is upstream too.
    showOverview(browser, overview({ deliveryHealth: liveHealth(), steps: setupSteps({ signal: "attention", action: "current" }) }));
    assert.equal(text(browser, "#homeHeadline"), "Finish setting up Chrome");
    assert.match(text(browser, "#homeNextActionTitle"), /Connect your product tracking/);
  } finally {
    browser.close();
  }
});

test("a ready Home repeats the server's receipt-backed summary, and an older API gets no delivery claim", () => {
  const { browser } = loadShopper();
  try {
    const health = healthyHealth();
    assert.equal(health.state, "ok");
    showOverview(browser, overview({ deliveryHealth: health, paused: false, steps: setupSteps() }));
    assert.equal(text(browser, "#homeHeadline"), "Yoink is ready.");
    assert.equal(text(browser, "#homeSummary"), health.summary);
    assert.doesNotMatch(browser.document.body.textContent ?? "", /Calls are live/);
    const receipts = [...browser.document.querySelectorAll("#homeDelivery [data-delivery-receipt]")];
    assert.deepEqual(receipts.map((item) => item.querySelector(".tag")?.textContent),
      health.receipts.map((receipt: { state: string }) => TAG_WORDS[receipt.state]));

    // An API without deliveryHealth: no strip, no card, and no claim about calls.
    showOverview(browser, overview({ paused: false, steps: setupSteps() }));
    assert.equal(text(browser, "#homeHeadline"), "Yoink is ready.");
    assert.equal(text(browser, "#homeSummary"), "Nothing needs you right now.");
    assert.equal((browser.document.querySelector("#homeDelivery") as HTMLElement).hidden, true);
    assert.equal((browser.document.querySelector("#deliveryCard") as HTMLElement).innerHTML, "");
    assert.doesNotMatch(browser.document.body.textContent ?? "", /Calls are live/);
  } finally {
    browser.close();
  }
});

test("Settings sends a real test alert and watches it until Chrome shows it", async () => {
  const { browser, timers } = loadShopper();
  try {
    const base = healthyHealth();
    showOverview(browser, overview({ deliveryHealth: base, paused: false, steps: setupSteps() }));
    let current = base;
    const calls = recordingFetch(browser, (path, options) => {
      if (path === "/api/v1/user/delivery-health" && (options.method ?? "GET") === "GET") return respond({ deliveryHealth: current });
      if (path === "/api/v1/user/delivery-health/test-alert" && options.method === "POST") {
        current = healthyHealth({ testAlert: testAlert() });
        return respond({
          testAlert: { jobId: "action_job_test", deliveryId: "notification_delivery_test", title: "Test product", expiresAt: new Date(Date.now() + DAY).toISOString() },
          deliveryHealth: current
        }, 201);
      }
      return respond({ error: "unexpected", message: `Unexpected ${path}` }, 500);
    });
    browser.eval('setSettingsView("notifications"); setTab("preferences", { load: false })');
    await eventually(() => assert.equal(calls.filter((call) => call.path === "/api/v1/user/delivery-health").length, 1,
      "opening Notifications re-reads delivery health"));
    const card = browser.document.querySelector("#deliveryCard") as HTMLElement;
    assert.equal(card.hidden, false);
    assert.match(text(browser, "#deliveryCardTitle"), /Chrome notifications/);
    assert.match(card.textContent ?? "", new RegExp(escapeRegExp(base.channel.explanation)));
    assert.match(card.textContent ?? "", /Last 7 days\s+3\s*calls\s+3\s*delivered\s+0\s*not delivered/);

    const send = card.querySelector('[data-delivery-lever="send_test_alert"]') as HTMLButtonElement;
    send.focus();
    send.click();
    await eventually(() => assert.match(card.textContent ?? "", new RegExp(`Latest test alert · ${escapeRegExp(current.testAlert.label)}`)));
    const post = calls.find((call) => call.method === "POST")!;
    assert.equal(post.path, "/api/v1/user/delivery-health/test-alert");
    assert.equal(post.body, "{}");
    assert.equal(post.headers["X-Yoink-Request"], "1");
    assert.match(text(browser, "#toast"), /Test alert sent\. Watch for it in Chrome\./);
    assert.equal(browser.document.activeElement?.getAttribute("data-delivery-lever"), "send_test_alert",
      "re-rendering the card keeps focus on the button");
    const ticks = pendingTimers(timers, 3_000);
    assert.equal(ticks.length, 1, "one watch tick is scheduled");

    // Still waiting on the first read: the watch schedules another tick.
    ticks[0]!.cleared = true;
    await ticks[0]!.callback();
    assert.equal(pendingTimers(timers, 3_000).length, 1);

    current = healthyHealth({ testAlert: testAlert({ state: "delivered", attempts: 1, deliveredAt: ago(0) }) });
    const next = pendingTimers(timers, 3_000)[0]!;
    next.cleared = true;
    await next.callback();
    await eventually(() => assert.match(card.textContent ?? "", new RegExp(`Latest test alert · ${escapeRegExp(current.testAlert.label)}`)));
    assert.match(card.textContent ?? "", /Chrome showed it/);
    assert.match(text(browser, "#toast"), /Chrome showed the test alert\./);
    assert.equal(pendingTimers(timers, 3_000).length, 0, "the watch ends once Chrome reports the alert");
  } finally {
    browser.close();
  }
});

test("a refused test alert names the missing piece next to the button and offers the fix", async () => {
  const { browser, timers } = loadShopper();
  try {
    showOverview(browser, overview({ deliveryHealth: liveHealth(), paused: false, steps: setupSteps() }));
    const message = "Pair the Chrome companion first; a test alert can only be shown as a Chrome notification.";
    const calls = recordingFetch(browser, (path, options) => {
      if (path === "/api/v1/user/delivery-health/test-alert" && options.method === "POST") {
        return respond({ error: "test_alert_needs_device", message }, 409);
      }
      return respond({ deliveryHealth: liveHealth() });
    });
    browser.eval('setSettingsView("notifications"); setTab("preferences", { load: false })');
    // Opening Notifications re-reads delivery health and re-renders the card.
    await eventually(() => assert.equal(browser.__deliveryState.deliveryHealthLoading, false));
    assert.equal(calls.filter((call) => call.path === "/api/v1/user/delivery-health").length, 1);
    const send = browser.document.querySelector('#deliveryCard [data-delivery-lever="send_test_alert"]') as HTMLButtonElement;
    send.focus();
    send.click();
    await eventually(() => assert.match((send.nextElementSibling as HTMLElement | null)?.textContent ?? "", /Pair the Chrome companion first/));
    const status = send.nextElementSibling as HTMLElement;
    assert.equal(status.classList.contains("inline-status"), true);
    assert.equal(status.getAttribute("role"), "alert");
    assert.equal(text(browser, "#toast .toast-action"), "Pair Chrome");
    assert.equal(send.disabled, false);
    assert.equal(pendingTimers(timers, 3_000).length, 0, "no watch starts without a queued alert");
  } finally {
    browser.close();
  }
});

test("each paired Chrome companion says when it last asked for calls", () => {
  const { browser } = loadShopper();
  try {
    const polling = companion({ id: "device_polling", name: "Laptop Chrome", online: true, lastSeenAt: ago(MINUTE), lastNotificationPollAt: ago(2 * MINUTE) });
    const refused = companion({
      id: "device_refused",
      name: "Desk Chrome",
      online: true,
      lastSeenAt: ago(MINUTE),
      lastNotificationPollAt: ago(40 * MINUTE),
      loopHealth: { notifications: { at: ago(MINUTE), reason: "cycle_failed", ok: false, status: 403, code: "extension_origin_rejected", consecutiveFailures: 12 } }
    });
    const quiet = companion({ id: "device_quiet", name: "Old Chrome", online: true, lastSeenAt: ago(MINUTE), lastJobPollAt: ago(40 * MINUTE) });
    const offline = companion();
    const health = liveHealth({ devices: [polling, refused, quiet, offline] });
    showOverview(browser, overview({ deliveryHealth: health }));
    const state = browser.__deliveryState;
    state.devices = [
      { id: "device_polling", name: "Laptop Chrome", extensionVersion: "1.28.4", status: "active", online: true, lastSeenAt: ago(MINUTE) },
      { id: "device_refused", name: "Desk Chrome", extensionVersion: "1.28.4", status: "active", online: true, lastSeenAt: ago(MINUTE) },
      { id: "device_quiet", name: "Old Chrome", extensionVersion: "1.28.3", status: "active", online: true, lastSeenAt: ago(MINUTE) },
      { id: "device_windows", name: "Desktop - Windows - Chrome", extensionVersion: "1.28.3", status: "active", online: false, lastSeenAt: ago(20 * DAY) },
      { id: "device_revoked", name: "Retired Chrome", extensionVersion: "0.25.0", status: "revoked", online: false, lastSeenAt: ago(30 * DAY) }
    ];
    browser.eval("renderPairedDevices()");
    const rows = [...browser.document.querySelectorAll("#pairedDevices .mini-row")] as HTMLElement[];
    const poll = (row: HTMLElement) => row.querySelector(".delivery-poll")?.textContent ?? null;
    assert.equal(rows.length, 5);
    assert.equal(poll(rows[0]!), "Asked for calls 2 minutes ago");
    assert.equal(rows[0]!.querySelector(".delivery-poll")?.classList.contains("good"), true);
    assert.equal(poll(rows[1]!), "Refused (HTTP 403)");
    assert.equal(poll(rows[2]!), "Last asked for calls 40 minutes ago");
    assert.match(rows[3]!.textContent ?? "", /Offline · Last seen 20 days ago/);
    assert.equal(poll(rows[3]!), "Never asked for calls");
    assert.equal(poll(rows[4]!), null, "revoked rows are unchanged");
    assert.match(rows[4]!.textContent ?? "", /Revoked/);
  } finally {
    browser.close();
  }
});

test("the test-alert watch stops when the shopper leaves the view or a read fails", async () => {
  const { browser, timers } = loadShopper();
  try {
    showOverview(browser, overview({ deliveryHealth: healthyHealth(), paused: false, steps: setupSteps() }));
    let failReads = false;
    const calls = recordingFetch(browser, (path, options) => {
      if (path === "/api/v1/user/delivery-health/test-alert" && options.method === "POST") {
        return respond({ testAlert: { jobId: "action_job_test" }, deliveryHealth: healthyHealth({ testAlert: testAlert() }) }, 201);
      }
      if (path === "/api/v1/user/delivery-health") {
        return failReads ? respond({ error: "unavailable", message: "Unavailable." }, 503) : respond({ deliveryHealth: healthyHealth({ testAlert: testAlert() }) });
      }
      return respond({ items: [], total: 0 });
    });
    browser.eval('setSettingsView("notifications"); setTab("preferences", { load: false })');
    await eventually(() => assert.equal(browser.__deliveryState.deliveryHealthLoading, false));
    const reads = () => calls.filter((call) => call.path === "/api/v1/user/delivery-health").length;

    (browser.document.querySelector('#deliveryCard [data-delivery-lever="send_test_alert"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(pendingTimers(timers, 3_000).length, 1));
    browser.eval('setSettingsView("chrome")');
    const readsBeforeTick = reads();
    const leftTick = pendingTimers(timers, 3_000)[0]!;
    leftTick.cleared = true;
    await leftTick.callback();
    assert.equal(reads(), readsBeforeTick, "a watch whose view was left does not read again");
    assert.equal(pendingTimers(timers, 3_000).length, 0);
    assert.equal(browser.__deliveryState.testAlertWatch, null);

    browser.eval('setSettingsView("notifications")');
    await eventually(() => assert.equal(browser.__deliveryState.deliveryHealthLoading, false));
    (browser.document.querySelector('#deliveryCard [data-delivery-lever="send_test_alert"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(pendingTimers(timers, 3_000).length, 1));
    failReads = true;
    const failedTick = pendingTimers(timers, 3_000)[0]!;
    failedTick.cleared = true;
    await failedTick.callback();
    assert.equal(pendingTimers(timers, 3_000).length, 0, "a failed read ends the watch");
    assert.equal(browser.__deliveryState.testAlertWatch, null);
    const waiting = healthyHealth({ testAlert: testAlert() }).testAlert.label;
    assert.match(browser.document.querySelector("#deliveryCard")?.textContent ?? "", new RegExp(`Latest test alert · ${escapeRegExp(waiting)}`),
      "the last receipt stays on screen");
  } finally {
    browser.close();
  }
});
