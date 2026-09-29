import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  TRACKALACKER_NOTIFICATION_SETTINGS_URL,
  buildDeliveryHealth,
  sourceFreshness,
  type DeliveryHealthInput,
  type SourceFreshnessInput
} from "../packages/domain/src/delivery-health.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

type Browser = Window & typeof globalThis & { close(): void; eval(source: string): unknown };

// Fixtures are relative to the run's clock: the dashboard formats ages with
// Date.now(), so a fixed date would drift into a different state over time.
const NOW = Date.now();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DEVICE_NAME = "Desktop - Windows - Chrome";

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

/** The live instance on 2026-09-28: one paired browser offline for weeks, pushes silent, every call expired. */
function offlineHealth(overrides: Partial<DeliveryHealthInput> = {}) {
  return buildDeliveryHealth({
    now: NOW,
    lastSignalAt: ago(30 * DAY),
    lastJobAt: ago(30 * DAY),
    lastLeaseAt: "",
    lastDeliveredAt: "",
    lastCartReadyAt: "",
    notifications: { windowDays: 7, created: 0, delivered: 0, expired: 0, failed: 0, pending: 0 },
    pendingNotifications: 0,
    consecutiveUndelivered: 10,
    dominantFailureCode: "no_device_poll",
    devices: [{
      id: "device_offline",
      name: DEVICE_NAME,
      online: false,
      lastSeenAt: ago(20 * DAY),
      lastNotificationPollAt: "",
      lastJobPollAt: "",
      notificationsCapable: true,
      platform: "Windows",
      loopHealth: {},
      accessibleRetailers: null
    }],
    connectors: { total: 0, enabled: 0, bound: 0 },
    activePlans: 31,
    cartFreshnessSeconds: 120,
    notifyLifetimeSeconds: 86_400,
    testAlert: null,
    ...overrides
  });
}

function pollingHealth() {
  return offlineHealth({
    lastSignalAt: ago(10 * MINUTE),
    lastJobAt: ago(10 * MINUTE),
    lastLeaseAt: ago(9 * MINUTE),
    lastDeliveredAt: ago(60 * MINUTE),
    notifications: { windowDays: 7, created: 5, delivered: 5, expired: 0, failed: 0, pending: 0 },
    consecutiveUndelivered: 0,
    dominantFailureCode: "",
    devices: [{
      id: "device_online",
      name: DEVICE_NAME,
      online: true,
      lastSeenAt: ago(MINUTE),
      lastNotificationPollAt: ago(MINUTE),
      lastJobPollAt: ago(MINUTE),
      notificationsCapable: true,
      platform: "Windows",
      loopHealth: {},
      accessibleRetailers: ["target"]
    }]
  });
}

type Push = NonNullable<SourceFreshnessInput["trackalacker"]>;

/** A decorated source exactly as the API returns it: stored row + derived status + freshness. */
function trackalackerSource(input: Partial<SourceFreshnessInput> & { push?: Partial<Push> } = {}) {
  const { push, ...overrides } = input;
  const freshness = sourceFreshness({
    source: "trackalacker",
    status: "connected",
    lastEventAt: ago(21 * DAY),
    lastSignalAt: ago(30 * DAY),
    lastSyncAt: ago(21 * DAY),
    activePlans: 31,
    now: NOW,
    trackalacker: {
      ready: true,
      state: "ready",
      errorCode: "",
      lastHttpStatus: 200,
      lastRegistrationAt: ago(30 * DAY),
      lastNotificationAt: ago(30 * DAY),
      lastDeliveryAt: ago(30 * DAY),
      deviceName: DEVICE_NAME,
      ...push
    },
    device: { online: false, lastSeenAt: ago(20 * DAY), name: DEVICE_NAME },
    ...overrides
  });
  return {
    id: "source_trackalacker_local",
    source: "trackalacker",
    name: "TrackaLacker",
    trustLevel: "trusted_exact",
    autoCreateMissions: false,
    signalCount: 185,
    lastEventAt: ago(21 * DAY),
    storedStatus: "connected",
    status: freshness.status,
    lastSignalAt: freshness.lastSignalAt,
    lastSyncAt: freshness.lastSyncAt,
    freshness
  };
}

function snapshot(overrides: {
  deliveryHealth?: unknown;
  sources?: unknown[];
  onlineDevices?: number;
  trackalackerReady?: boolean;
  purchaseRule?: boolean;
  actionsPaused?: boolean;
} = {}): Record<string, unknown> {
  return {
    view: "overview",
    version: "admin-delivery-health-ui-test",
    actor: {
      displayName: "Admin Fixture",
      userId: "user_admin_fixture",
      tenantName: "Fixture tenant",
      roleLabels: ["Tenant administrator"],
      sessionKind: "local",
      signOutUrl: ""
    },
    settings: { actionsPaused: overrides.actionsPaused ?? false, executionMode: "live" },
    counts: { onlineDevices: overrides.onlineDevices ?? 0, pendingCatalogProposals: 0, pendingAdminChanges: 0, openIncidents: 0 },
    overview: {
      generatedAt: new Date(NOW).toISOString(),
      windows: { hours24: {}, days7: {} },
      waiting: { catalogProposals: 0, changeRequests: 0, incidents: 0 }
    },
    trackalacker: {
      ready: overrides.trackalackerReady ?? true,
      state: "ready",
      mappedProducts: 571,
      candidateListings: 2721,
      devices: [{ deviceName: DEVICE_NAME, ready: true, lastNotificationAt: ago(30 * DAY) }],
      syncRuns: []
    },
    capabilities: { targetAddQualified: true, targetAddMutationAuthorized: true },
    sources: overrides.sources ?? [],
    strategies: overrides.purchaseRule === false ? [] : [{ enabled: true, action: "add_to_cart" }],
    ...(overrides.deliveryHealth === undefined ? {} : { deliveryHealth: overrides.deliveryHealth })
  };
}

async function renderAdmin(model: Record<string, unknown>, route = "overview"): Promise<Browser> {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `http://127.0.0.1:32991/admin#${route}`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (pathValue: string) => {
      const path = String(pathValue);
      const payload = path.startsWith("/api/v1/admin/snapshot?view=") ? model : { items: [], total: 0 };
      return { ok: true, status: 200, json: async () => payload };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
  return browser;
}

async function renderOverview(model: Record<string, unknown>): Promise<Browser> {
  const browser = await renderAdmin(model);
  await eventually(() => assert.doesNotMatch(browser.document.querySelector("#overviewHeadline")?.textContent ?? "", /Checking/));
  return browser;
}

function heroRow(browser: Browser, label: string): HTMLElement {
  const row = [...browser.document.querySelectorAll<HTMLElement>("#heroStatus .hero-status-row")]
    .find((item) => item.querySelector("span")?.textContent?.trim() === label);
  assert.ok(row, `hero row ${label}`);
  return row;
}

test("a paired-but-offline companion and a quiet source lead the admin overview with receipts, never 'live'", async () => {
  const health = offlineHealth();
  const browser = await renderOverview(snapshot({ deliveryHealth: health, sources: [trackalackerSource()] }));
  try {
    const document = browser.document;
    assert.equal(document.querySelector("#overviewHeadline")?.textContent, "No paired Chrome browser is online.");
    assert.equal(document.querySelector("#overviewHeadline")?.textContent, health.headline);
    assert.equal(document.querySelector("#overviewSummary")?.textContent, health.summary);
    assert.match(document.querySelector("#heroStatus")?.textContent ?? "", /Needs attention/);
    assert.equal(document.querySelector("#heroStatus .text-button")?.textContent, "Open Sources");

    assert.equal(document.querySelectorAll("#heroStatus .hero-status-row").length, 4);
    const calls = heroRow(browser, "Calls");
    assert.match(calls.querySelector("strong")?.textContent ?? "", /^Quiet · .+ ago$/);
    assert.equal(calls.querySelector(".status-dot")?.getAttribute("aria-label"), "Attention");
    const chrome = heroRow(browser, "Chrome");
    assert.match(chrome.querySelector("strong")?.textContent ?? "", /^Offline · last seen .+ ago$/);
    const delivered = heroRow(browser, "Delivered");
    assert.equal(delivered.querySelector("strong")?.textContent, "10 expired in a row");
    assert.equal(delivered.querySelector(".status-dot")?.getAttribute("aria-label"), "Attention");
    const overviewCopy = document.querySelector("#view-overview")?.textContent ?? "";
    assert.doesNotMatch(overviewCopy, /Not paired|Calls are live|calls live|\bLive\b/,
      "a stored ready bit and a paired-but-offline browser must not read live or unpaired");

    const panel = document.querySelector("#overviewDelivery") as HTMLElement;
    assert.equal(panel.hidden, false);
    assert.equal(panel.querySelector("h2")?.id, "overviewDeliveryTitle");
    assert.match(panel.querySelector(".plain-state")?.textContent ?? "", /Needs attention/);
    const receipts = [...panel.querySelectorAll<HTMLElement>(".delivery-receipt")];
    assert.deepEqual(receipts.map((receipt) => receipt.dataset.receipt), ["signal", "job", "lease", "delivered", "cart_ready"]);
    assert.deepEqual(receipts.map((receipt) => receipt.dataset.state), ["attention", "ok", "waiting", "attention", "none"]);
    const signal = receipts[0]!;
    assert.equal(signal.querySelector(".tag")?.textContent, "Attention");
    assert.equal(signal.querySelector("strong")?.textContent, "Last call received");
    assert.match(signal.querySelector("time")?.textContent ?? "", /ago$/);
    assert.match(signal.querySelector("small")?.textContent ?? "", /source may have gone quiet/);
    assert.equal(receipts[4]!.querySelector("time")?.textContent, "Never");
    assert.match(panel.querySelector(".delivery-summary")?.textContent ?? "", /Chrome notification on Desktop - Windows - Chrome · last 7 days: 0 delivered, 0 not delivered, 0 waiting\./);

    const next = panel.querySelector(".delivery-next") as HTMLElement;
    assert.equal(next.querySelectorAll("button").length, 0, "instruction-only levers are never dead buttons");
    assert.deepEqual([...next.querySelectorAll(".delivery-instruction")].map((item) => item.textContent), [
      "Open the Chrome companion",
      "Reload the companion in chrome://extensions"
    ]);
    const reconnect = next.querySelector("a") as HTMLAnchorElement;
    assert.equal(reconnect.getAttribute("href"), TRACKALACKER_NOTIFICATION_SETTINGS_URL);
    assert.equal(reconnect.getAttribute("target"), "_blank");
    assert.equal(reconnect.getAttribute("rel"), "noopener noreferrer");

    assert.equal(document.querySelector("#readinessGate")?.textContent, "Step 1 of 5");
    assert.match(document.querySelector("#readinessGuide")?.textContent ?? "",
      /Paired but offline; last seen .+ ago\. Open Chrome on Desktop - Windows - Chrome\./);

    // The source panels read the decorated status, not snapshot.trackalacker.ready (E-03).
    assert.match(document.querySelector("#sourceSummary")?.textContent ?? "", /TrackaLacker.*Quiet · .+ ago/);
    assert.equal(document.querySelector("#sourceSummary .status-dot")?.getAttribute("aria-label")?.startsWith("Quiet · "), true);
    assert.equal(document.querySelector("#trackalackerGate")?.textContent, "Attention");
    assert.match(document.querySelector("#trackalackerConnectionStatus")?.textContent ?? "", /TrackaLacker has gone quiet/);
    assert.equal(document.querySelector("#trackalackerConnectionStatus a")?.getAttribute("href"), TRACKALACKER_NOTIFICATION_SETTINGS_URL);
    assert.match(document.querySelector("#trackalackerConnectionDetail")?.textContent ?? "",
      /571 followed products and 2,721 source listings are mapped\. No push, delivery, or registration from TrackaLacker/);
    const card = document.querySelector("#connectionList .card") as HTMLElement;
    assert.match(card.textContent ?? "", /Next: No push, delivery, or registration from TrackaLacker for \d+ d\./);
    assert.equal(card.querySelector(".source-recovery a")?.getAttribute("href"), TRACKALACKER_NOTIFICATION_SETTINGS_URL);
    assert.match(card.textContent ?? "", /Last call .+ ago/);
    assert.doesNotMatch(card.textContent ?? "", /Receiving calls/);
  } finally {
    browser.close();
  }
});

test("expiries inside the window read as a count on the Delivered row", async () => {
  const browser = await renderOverview(snapshot({
    deliveryHealth: offlineHealth({ notifications: { windowDays: 7, created: 148, delivered: 0, expired: 148, failed: 0, pending: 0 } }),
    sources: [trackalackerSource()]
  }));
  try {
    assert.equal(heroRow(browser, "Delivered").querySelector("strong")?.textContent, "148 expired in 7 days");
    assert.match(browser.document.querySelector("#overviewDelivery .delivery-summary")?.textContent ?? "", /0 delivered, 148 not delivered/);
  } finally {
    browser.close();
  }
});

test("a fresh source and a polling companion read live with receipt ages", async () => {
  const fresh = trackalackerSource({
    lastSignalAt: ago(10 * MINUTE),
    push: { lastNotificationAt: ago(10 * MINUTE), lastDeliveryAt: ago(10 * MINUTE), lastRegistrationAt: ago(2 * DAY) },
    device: { online: true, lastSeenAt: ago(MINUTE), name: DEVICE_NAME }
  });
  assert.equal(fresh.freshness.state, "fresh");
  const ready = await renderOverview(snapshot({ deliveryHealth: pollingHealth(), sources: [fresh], onlineDevices: 1 }));
  try {
    const document = ready.document;
    assert.equal(document.querySelector("#overviewHeadline")?.textContent, "Yoink is ready for guarded adds.");
    assert.match(heroRow(ready, "Calls").querySelector("strong")?.textContent ?? "", /^Live · .+ ago$/);
    assert.match(heroRow(ready, "Chrome").querySelector("strong")?.textContent ?? "", /^Asking for calls · .+ ago$/);
    const delivered = heroRow(ready, "Delivered");
    assert.match(delivered.querySelector("strong")?.textContent ?? "", /ago$/);
    assert.equal(delivered.querySelector(".status-dot")?.getAttribute("aria-label"), "OK");
    assert.equal(document.querySelector("#overviewDelivery .plain-state")?.textContent, "Reaching Chrome");
    assert.equal(document.querySelector("#overviewDelivery .delivery-next"), null, "a healthy path has no next step");
    assert.equal(document.querySelector("#trackalackerGate")?.textContent, "OK");
    assert.match(document.querySelector("#trackalackerConnectionStatus")?.textContent ?? "", /TrackaLacker calls live/);
    assert.match(document.querySelector("#connectionList .card")?.textContent ?? "", /Next: Active; last activity .+ ago\./);
  } finally {
    ready.close();
  }

  const monitoring = await renderOverview(snapshot({ deliveryHealth: pollingHealth(), sources: [fresh], onlineDevices: 1, purchaseRule: false }));
  try {
    assert.equal(monitoring.document.querySelector("#overviewHeadline")?.textContent, "Calls are live; action setup is next.");
  } finally {
    monitoring.close();
  }

  const registeredOnly = trackalackerSource({
    lastSignalAt: "",
    push: { lastNotificationAt: "", lastDeliveryAt: "", lastRegistrationAt: "" },
    device: { online: true, lastSeenAt: ago(MINUTE), name: DEVICE_NAME }
  });
  assert.equal(registeredOnly.freshness.state, "never");
  const waiting = await renderOverview(snapshot({ deliveryHealth: pollingHealth(), sources: [registeredOnly], onlineDevices: 1, purchaseRule: false }));
  try {
    assert.equal(waiting.document.querySelector("#overviewHeadline")?.textContent, "Monitoring is set up; action setup is next.",
      "a registered source with no call yet is not live");
    assert.equal(heroRow(waiting, "Calls").querySelector("strong")?.textContent, "Waiting for the first call");
    assert.equal(waiting.document.querySelector("#trackalackerGate")?.textContent, "OK");
    assert.match(waiting.document.querySelector("#trackalackerConnectionStatus")?.textContent ?? "", /Registered; waiting for the first push/);
  } finally {
    waiting.close();
  }
});

test("a stale source upstream of a polling companion names the quiet source", async () => {
  const browser = await renderOverview(snapshot({ deliveryHealth: pollingHealth(), sources: [trackalackerSource()], onlineDevices: 1 }));
  try {
    assert.equal(browser.document.querySelector("#overviewHeadline")?.textContent, "TrackaLacker calls have gone quiet.");
    assert.match(browser.document.querySelector("#overviewSummary")?.textContent ?? "", /Re-register from the companion popup/);
    assert.match(browser.document.querySelector("#readinessGuide")?.textContent ?? "", /TrackaLacker calls/);
  } finally {
    browser.close();
  }
});

test("calls that cannot reach an online companion outrank unfinished action setup", async () => {
  const fresh = trackalackerSource({
    lastSignalAt: ago(10 * MINUTE),
    push: { lastNotificationAt: ago(10 * MINUTE), lastDeliveryAt: ago(10 * MINUTE) },
    device: { online: true, lastSeenAt: ago(MINUTE), name: DEVICE_NAME }
  });
  const neverAsks = offlineHealth({
    lastSignalAt: ago(10 * MINUTE),
    consecutiveUndelivered: 0,
    dominantFailureCode: "",
    devices: [{
      id: "device_online",
      name: DEVICE_NAME,
      online: true,
      lastSeenAt: ago(MINUTE),
      lastNotificationPollAt: "",
      lastJobPollAt: "",
      notificationsCapable: true,
      platform: "Windows",
      loopHealth: {},
      accessibleRetailers: null
    }]
  });
  assert.equal(neverAsks.channel.pollState, "never");
  const browser = await renderOverview(snapshot({ deliveryHealth: neverAsks, sources: [fresh], onlineDevices: 1, purchaseRule: false }));
  try {
    assert.equal(browser.document.querySelector("#overviewHeadline")?.textContent, "Chrome is not asking Yoink for calls.");
    assert.equal(browser.document.querySelector("#heroStatus .text-button")?.textContent, "Open Sources");
    assert.equal(heroRow(browser, "Chrome").querySelector("strong")?.textContent, "Online · never asked for calls");
    assert.match(browser.document.querySelector("#overviewDelivery .delivery-next")?.textContent ?? "", /Reload the companion in chrome:\/\/extensions/);
  } finally {
    browser.close();
  }
});

test("an older snapshot without delivery health or freshness claims nothing about calls", async () => {
  const unpaired = await renderOverview(snapshot({ onlineDevices: 0 }));
  try {
    const document = unpaired.document;
    assert.match(document.querySelector("#overviewHeadline")?.textContent ?? "", /Pair Chrome/);
    assert.equal(document.querySelectorAll("#heroStatus .hero-status-row").length, 3);
    assert.equal(heroRow(unpaired, "Calls").querySelector("strong")?.textContent, "Registered");
    assert.equal(heroRow(unpaired, "Chrome").querySelector("strong")?.textContent, "None online");
    assert.equal((document.querySelector("#overviewDelivery") as HTMLElement).hidden, true);
    assert.equal(document.querySelector("#overviewDelivery")?.innerHTML, "");
    assert.doesNotMatch(document.querySelector("#heroStatus")?.textContent ?? "", /Live|Not paired/);
  } finally {
    unpaired.close();
  }

  const ready = await renderOverview(snapshot({ onlineDevices: 1 }));
  try {
    assert.equal(ready.document.querySelector("#overviewHeadline")?.textContent, "Yoink is ready for guarded adds.");
    assert.equal(heroRow(ready, "Chrome").querySelector("strong")?.textContent, "1 online");
    assert.equal(ready.document.querySelector("#trackalackerGate")?.textContent, "OK");
    assert.match(ready.document.querySelector("#trackalackerConnectionStatus")?.textContent ?? "", /TrackaLacker push registered/);
  } finally {
    ready.close();
  }

  const monitoring = await renderOverview(snapshot({ onlineDevices: 1, purchaseRule: false }));
  try {
    assert.equal(monitoring.document.querySelector("#overviewHeadline")?.textContent, "Monitoring is set up; action setup is next.");
  } finally {
    monitoring.close();
  }
});

test("the Sources device list says offline and whether each browser asks for calls", async () => {
  const model = {
    ...snapshot({ deliveryHealth: offlineHealth(), sources: [trackalackerSource()] }),
    view: "connections",
    devices: [
      {
        id: "device_offline",
        name: DEVICE_NAME,
        platform: "Windows",
        status: "active",
        online: false,
        extensionVersion: "1.28.3",
        lastSeenAt: ago(20 * DAY),
        lastNotificationPollAt: "",
        lastJobPollAt: "",
        capabilities: { rotatableDeviceCredentials: true },
        credential: { generation: 1, rotationDue: true, pending: false }
      },
      {
        id: "device_polling",
        name: "Laptop Chrome",
        platform: "macOS",
        status: "active",
        online: true,
        extensionVersion: "1.28.4",
        lastSeenAt: ago(MINUTE),
        lastNotificationPollAt: ago(2 * MINUTE),
        lastJobPollAt: ago(MINUTE),
        capabilities: { rotatableDeviceCredentials: true },
        credential: { generation: 2, rotationDue: false, pending: false }
      }
    ]
  };
  const browser = await renderAdmin(model, "sources/channels");
  try {
    await eventually(() => assert.equal(browser.document.querySelectorAll("#deviceList .device-row").length, 2));
    const [offline, polling] = [...browser.document.querySelectorAll<HTMLElement>("#deviceList .device-row")];
    assert.equal(offline!.querySelector(".status-dot")?.getAttribute("aria-label"), "Offline");
    assert.match(offline!.textContent ?? "", /seen .+ ago · never asked for calls ·/);
    assert.equal(polling!.querySelector(".status-dot")?.getAttribute("aria-label"), "Online");
    assert.match(polling!.textContent ?? "", /· asked for calls .+ ago ·/);
  } finally {
    browser.close();
  }
});
