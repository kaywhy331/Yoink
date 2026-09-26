import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

const ROOT = join(process.cwd(), "apps", "extension");
const HTML = readFileSync(join(ROOT, "options.html"), "utf8");
const POPUP_STATE = readFileSync(join(ROOT, "popup-state.js"), "utf8");
const OPTIONS = readFileSync(join(ROOT, "options.js"), "utf8");

function click(window: Window, element: Element): void {
  const MouseEventConstructor = (window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  element.dispatchEvent(new MouseEventConstructor("click", { bubbles: true }));
}

async function turn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface OptionsHarnessOptions {
  paired?: boolean;
  connected?: boolean;
  planFailuresBeforeSuccess?: number;
  automaticResponse?: Record<string, unknown>;
  automaticFailuresBeforeSuccess?: number;
  /** Replaces each manual lane-check result (e.g. an older companion without counts). */
  laneResult?: Record<string, unknown>;
  /** permissions.contains rejects for this origin. */
  containsFailsFor?: string;
  /** permissions.request rejects (lost user gesture). */
  requestFails?: boolean;
}

async function optionsHarness(options: OptionsHarnessOptions = {}) {
  const dom = new JSDOM(HTML, {
    url: `chrome-extension://${"a".repeat(32)}/options.html`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const window = dom.window;
  const granted = new Set(["https://www.target.com/*"]);
  const requested: string[][] = [];
  const removed: string[][] = [];
  const messages: Array<Record<string, unknown>> = [];
  let planFailures = options.planFailuresBeforeSuccess ?? 0;
  let automaticFailures = options.automaticFailuresBeforeSuccess ?? 0;
  let automaticEnabled = false;
  let confirmCalls = 0;
  let refreshSchedule: (() => void) | undefined;
  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 60_000 && typeof handler === "function") refreshSchedule = () => handler(...args);
    return nativeSetInterval(handler, delay, ...args);
  }) as typeof window.setInterval;
  Object.assign(window, {
    confirm: () => { confirmCalls += 1; return true; },
    chrome: {
      runtime: {
        sendMessage: async (message: Record<string, unknown>) => {
          messages.push(message);
          if (message.type === "yoink:check-health") {
            return { ok: true, state: { paired: options.paired !== false, connected: options.connected !== false } };
          }
          if (message.type === "yoink:delete-local-data") {
            return { ok: true, deleted: true, verified: true };
          }
          if (message.type === "yoink:get-reverification-plan") {
            if (planFailures > 0) {
              planFailures -= 1;
              return { ok: false, message: "Plan unavailable." };
            }
            return {
              ok: true,
              plan: {
                lanes: [
                  { retailerId: "target", qualification: { status: "retired", warning: "version_changed" }, candidate: { retailerSku: "94972381" }, candidates: [{ retailerSku: "94972381", qualificationTypes: ["first_party_actionable", "shipping_actionable", "pre_click_rehearsal"] }], evidence: { qualificationEvidenceReady: false }, automaticCheckNeeded: true },
                  { retailerId: "walmart", qualification: { status: "qualified", warning: "expiring" }, candidate: { retailerSku: "20252562938" }, candidates: [{ retailerSku: "20252562938", qualificationTypes: ["first_party_actionable", "shipping_actionable"] }], evidence: { qualificationEvidenceReady: true }, automaticCheckNeeded: true }
                ]
              }
            };
          }
          if (message.type === "yoink:get-auto-reverification") {
            if (automaticFailures-- > 0) return { ok: false };
            return { ok: true, settings: { schemaVersion: 1, enabled: automaticEnabled }, state: null, ...options.automaticResponse };
          }
          if (message.type === "yoink:set-auto-reverification") {
            automaticEnabled = message.enabled === true;
            return { ok: true, settings: { schemaVersion: 1, enabled: message.enabled === true } };
          }
          if (message.type === "yoink:run-auto-reverification") {
            return {
              ok: true,
              started: true,
              state: "complete",
              results: [
                { retailerId: "target", outcome: "passed", attemptedProductCount: 2, passedProductCount: 2 },
                { retailerId: "walmart", outcome: "passed", attemptedProductCount: 1, passedProductCount: 1 }
              ]
            };
          }
          if (message.type === "yoink:reverify-retailer-lanes") {
            return {
              ok: true,
              results: (message.retailerIds as string[]).map((retailerId) => options.laneResult
                ? { retailerId, ...options.laneResult }
                : {
                  retailerId,
                  outcome: "passed",
                  attemptedProductCount: 1,
                  passedProductCount: 1
                })
            };
          }
          return { ok: false };
        }
      },
      permissions: {
        contains: async ({ origins }: { origins: string[] }) => {
          if (options.containsFailsFor && origins.includes(options.containsFailsFor)) throw new Error("bad origin pattern");
          return origins.every((origin) => granted.has(origin));
        },
        request: async ({ origins }: { origins: string[] }) => {
          if (options.requestFails) throw new Error("This function must be called during a user gesture");
          requested.push(origins);
          origins.forEach((origin) => granted.add(origin));
          return true;
        },
        remove: async ({ origins }: { origins: string[] }) => {
          removed.push(origins);
          origins.forEach((origin) => granted.delete(origin));
          return true;
        }
      }
    }
  });
  window.eval(`globalThis.YoinkRuntimeConfig = Object.freeze({
    profile: "local",
    appOrigin: "http://127.0.0.1:32991",
    localPackageUpdates: true
  });`);
  window.eval(`${POPUP_STATE}\nglobalThis.YoinkPopupStateModule = YoinkPopupStateModule;`);
  await window.eval(`(async () => { ${OPTIONS} })()`);
  return {
    dom,
    window,
    document: window.document,
    requested,
    removed,
    messages,
    confirmCalls: () => confirmCalls,
    tickSchedule: () => { assert.ok(refreshSchedule); refreshSchedule(); }
  };
}

test("extension settings manage exact store permissions and verified local deletion", async t => {
  const fixture = await optionsHarness();
  t.after(() => fixture.dom.window.close());
  const { window, document, requested, removed, messages } = fixture;

  assert.equal(document.title, "Extension settings");
  assert.equal(document.querySelector("h1")?.textContent, "Extension settings");
  assert.equal(document.querySelector("#store-access, #lane-readiness"), null, "Unused anchors were removed.");
  assert.equal(document.querySelector("#pairState")?.textContent, "Paired · Ready");
  assert.equal(document.querySelectorAll("#permissionList .permission-row").length, 20);
  const openYoink = document.querySelector("#openYoink") as HTMLAnchorElement;
  assert.equal(openYoink.href, "http://127.0.0.1:32991/#home");
  assert.equal(openYoink.textContent, "Open Yoink");
  assert.equal(openYoink.target, "_blank");
  assert.equal(openYoink.rel, "noopener");

  const target = [...document.querySelectorAll("#permissionList .permission-row")]
    .find((row) => row.querySelector("strong")?.textContent === "Target");
  assert.ok(target);
  click(window, target.querySelector("button") as HTMLButtonElement);
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(removed)), [["https://www.target.com/*"]]);
  assert.equal(target.querySelector("button")?.textContent, "Allow");

  const walmart = [...document.querySelectorAll("#permissionList .permission-row")]
    .find((row) => row.querySelector("strong")?.textContent === "Walmart");
  assert.ok(walmart);
  click(window, walmart.querySelector("button") as HTMLButtonElement);
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(requested)), [["https://*.walmart.com/*"]]);
  assert.equal(walmart.querySelector("button")?.textContent, "Remove");

  assert.equal(document.querySelector("#laneReadinessState")?.textContent, "2 need checking");
  assert.equal((document.querySelector("#laneReadinessRetry") as HTMLButtonElement).hidden, true);
  assert.equal(document.querySelector("#reverifyLanes"), null);
  assert.equal(document.querySelectorAll("#laneReadinessList .lane-readiness-row").length, 2);
  const targetCheck = document.querySelector('[data-reverify-retailer="target"]') as HTMLElement;
  assert.match(targetCheck.textContent ?? "", /1 candidate product · first-party · shipping · no-click passed/);
  click(window, targetCheck.querySelector("button") as HTMLButtonElement);
  await turn();
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(requested.at(-1))), ["https://www.target.com/*"]);
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.filter((message) => message.type === "yoink:reverify-retailer-lanes").at(-1)
  )), {
    type: "yoink:reverify-retailer-lanes",
    retailerIds: ["target"]
  });
  assert.equal(
    targetCheck.querySelector("[data-lane-status]")?.textContent,
    "1 of 1 passed · no click"
  );

  click(window, walmart.querySelector("button") as HTMLButtonElement);
  await turn();
  const walmartCheck = document.querySelector('[data-reverify-retailer="walmart"]') as HTMLElement;
  click(window, walmartCheck.querySelector("button") as HTMLButtonElement);
  await turn();
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(requested.at(-1))), ["https://*.walmart.com/*"]);
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.filter((message) => message.type === "yoink:reverify-retailer-lanes").at(-1)
  )), { type: "yoink:reverify-retailer-lanes", retailerIds: ["walmart"] });
  assert.equal(walmartCheck.querySelector("[data-lane-status]")?.textContent, "1 of 1 passed · no click");

  const automaticToggle = document.querySelector("#autoReverification") as HTMLInputElement;
  const automaticButton = document.querySelector("#checkNeededStores") as HTMLButtonElement;
  assert.equal(automaticToggle.checked, false);
  automaticToggle.checked = true;
  automaticToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.filter((message) => message.type === "yoink:set-auto-reverification").at(-1)
  )), { type: "yoink:set-auto-reverification", enabled: true });
  assert.equal(document.querySelector("#automaticCheckResult")?.textContent, "Automatic checks enabled.");

  click(window, automaticButton);
  await turn();
  await turn();
  assert.equal(messages.filter((message) => message.type === "yoink:run-auto-reverification").length, 1);
  assert.equal(document.querySelector("#automaticCheckResult")?.textContent,
    "2 of 2 stores ready. No Add controls were clicked.");

  const deleteButton = document.querySelector("#deleteLocalData") as HTMLButtonElement;
  const cancelButton = document.querySelector("#cancelDeleteLocalData") as HTMLButtonElement;
  const deletionResult = document.querySelector("#deletionResult") as HTMLElement;
  assert.equal(deleteButton.textContent, "Delete local extension data");
  assert.equal(cancelButton.hidden, true);

  click(window, deleteButton);
  await turn();
  assert.equal(messages.some((message) => message.type === "yoink:delete-local-data"), false,
    "The first click only arms the deletion.");
  assert.equal(deleteButton.textContent, "Confirm delete");
  assert.equal(cancelButton.hidden, false);
  assert.match(deletionResult.textContent ?? "", /Your Yoink account data stays\./);

  click(window, cancelButton);
  assert.equal(deleteButton.textContent, "Delete local extension data");
  assert.equal(cancelButton.hidden, true);
  assert.equal(deletionResult.textContent, "");
  assert.equal(document.activeElement, deleteButton);

  click(window, deleteButton);
  assert.equal(deleteButton.textContent, "Confirm delete");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(deleteButton.textContent, "Delete local extension data");
  assert.equal(cancelButton.hidden, true);

  click(window, deleteButton);
  click(window, deleteButton);
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.find((message) => message.type === "yoink:delete-local-data")
  )), {
    type: "yoink:delete-local-data",
    confirmation: "DELETE_ALL_LOCAL_YOINK_DATA"
  });
  assert.equal(messages.filter((message) => message.type === "yoink:delete-local-data").length, 1);
  assert.equal(deletionResult.textContent, "Local extension data deleted and the receipt was verified.");
  assert.equal(deleteButton.textContent, "Delete local extension data");
  assert.equal(cancelButton.hidden, true);
  assert.equal(fixture.confirmCalls(), 0, "Deletion confirms inline instead of through a native dialog.");
  fixture.dom.window.close();
});

test("an unpaired profile is sent to Settings › Chrome in a new tab, and a lost Yoink is named", async () => {
  const unpaired = await optionsHarness({ paired: false });
  assert.equal(unpaired.document.querySelector("#pairState")?.textContent, "Not paired");
  const pairLink = unpaired.document.querySelector("#openYoink") as HTMLAnchorElement;
  assert.equal(pairLink.href, "http://127.0.0.1:32991/#settings/chrome");
  assert.equal(pairLink.textContent, "Open Yoink › Settings › Chrome");
  assert.equal(pairLink.target, "_blank");
  unpaired.dom.window.close();

  const disconnected = await optionsHarness({ connected: false });
  assert.equal(disconnected.document.querySelector("#pairState")?.textContent, "Paired · Yoink unavailable");
  assert.equal((disconnected.document.querySelector("#openYoink") as HTMLAnchorElement).href, "http://127.0.0.1:32991/#home");
  disconnected.dom.window.close();
});

test("a store-check plan that cannot load offers a retry", async () => {
  const fixture = await optionsHarness({ planFailuresBeforeSuccess: 1 });
  const { window, document } = fixture;
  const retry = document.querySelector("#laneReadinessRetry") as HTMLButtonElement;
  assert.equal(document.querySelector("#laneReadinessState")?.textContent, "Unavailable");
  assert.equal(retry.hidden, false);
  assert.equal(document.querySelectorAll("#laneReadinessList .lane-readiness-row").length, 0);

  click(window, retry);
  await turn();
  assert.equal(document.querySelector("#laneReadinessState")?.textContent, "2 need checking");
  assert.equal(retry.hidden, true);
  assert.equal(document.querySelectorAll("#laneReadinessList .lane-readiness-row").length, 2);
  assert.equal(fixture.messages.filter((message) => message.type === "yoink:get-reverification-plan").length, 2);
  fixture.dom.window.close();
});

test("Settings renders the runtime's scheduling policy and recovers an unavailable schedule without starting a check", async () => {
  const response = {
    settings: { schemaVersion: 1, enabled: true },
    policy: { schemaVersion: 1, dailyRunLimit: 3, dayBoundary: "UTC", firstRunDelayMinutes: 4,
      attentionPeriodMinutes: 90, steadyPeriodMinutes: 240, passBackoffMs: 45 * 60_000,
      failureBackoffMs: [2 * 60 * 60_000, 8 * 60 * 60_000], helpBackoffMs: 24 * 60 * 60_000 },
    schedule: { schemaVersion: 1, computedAt: "2026-09-05T23:55:00.000Z", enabled: true, running: false,
      reason: "automatic_check_daily_cap", runsToday: 3, resetAt: "2026-09-06T00:00:00.000Z",
      nextEligibleAt: "2026-09-06T00:00:00.000Z", nextReviewAt: "2026-09-06T00:30:00.000Z",
      lanes: [
        { retailerId: "target", state: "waiting", reasonCode: "automatic_check_daily_cap", lastCheckedAt: "2026-09-05T23:00:00.000Z", eligibleAt: "2026-09-06T00:00:00.000Z" },
        { retailerId: "walmart", state: "blocked", reasonCode: "qualification_candidate_missing", lastCheckedAt: "", eligibleAt: null }
      ] }
  };
  const fixture = await optionsHarness({ automaticResponse: response, automaticFailuresBeforeSuccess: 1 });
  try {
    const { window, document } = fixture;
    assert.match(document.querySelector("#automaticCheckSchedule")?.textContent || "", /Schedule unavailable/);
    assert.equal((document.querySelector("#checkNeededStores") as HTMLButtonElement).disabled, true);
    click(window, document.querySelector("#refreshAutomaticSchedule")!);
    await turn();
    assert.equal((document.querySelector("#checkNeededStores") as HTMLButtonElement).disabled, false);
    const policy = document.querySelector("#automaticCheckPolicy")?.textContent || "";
    assert.match(policy, /3 automatic runs per UTC day/);
    assert.match(policy, /after 4 minutes/);
    assert.match(policy, /every 1.5 hours/);
    assert.match(policy, /at least 45 minutes/);
    assert.match(policy, /2 hours, 8 hours/);
    const summary = document.querySelector("#automaticCheckSchedule")?.textContent || "";
    assert.match(summary, /Next eligible check:/);
    assert.match(summary, /Next scheduled review:/);
    assert.match(summary, /3 of 3 automatic runs used; the daily count resets/);
    assert.match(document.querySelector('[data-reverify-retailer="target"] .automatic-lane-schedule')?.textContent || "", /Last check:.*Daily limit reached.*Eligible after/);
    assert.match(document.querySelector('[data-reverify-retailer="walmart"] .automatic-lane-schedule')?.textContent || "", /Waiting:/);
    assert.equal(fixture.requested.length, 0);
    assert.equal(fixture.messages.some(message => ["yoink:run-auto-reverification", "yoink:reverify-retailer-lanes"].includes(String(message.type))), false);
  } finally { fixture.dom.window.close(); }
});

test("refreshing the schedule cannot replace a pending pause with the older enabled setting", async () => {
  const fixture = await optionsHarness();
  try {
    const { window, document } = fixture;
    const toggle = document.querySelector("#autoReverification") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
    await turn();
    const runtime = (window as unknown as {
      chrome: { runtime: { sendMessage(message: Record<string, unknown>): Promise<unknown> } };
    }).chrome.runtime;
    const sendMessage = runtime.sendMessage;
    let finishPause!: () => void;
    const paused = new Promise<void>(resolve => { finishPause = resolve; });
    let delayNextRefresh = false;
    let finishRefresh!: () => void;
    const refresh = new Promise<void>(resolve => { finishRefresh = resolve; });
    runtime.sendMessage = async message => {
      if (message.type === "yoink:set-auto-reverification") await paused;
      const response = await sendMessage(message);
      if (message.type === "yoink:get-auto-reverification" && delayNextRefresh) {
        delayNextRefresh = false;
        await refresh;
      }
      return response;
    };
    toggle.checked = false;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
    click(window, document.querySelector("#refreshAutomaticSchedule")!);
    await turn();
    assert.equal(toggle.disabled, true, "refresh must not allow a second settings write while the pause is pending");
    assert.equal(toggle.checked, false, "the pending pause must remain visible");
    assert.equal(document.querySelector("#automaticCheckResult")?.textContent, "Turning automatic checks off…");
    delayNextRefresh = true;
    click(window, document.querySelector("#refreshAutomaticSchedule")!);
    await turn();
    finishPause();
    await turn();
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.checked, false);
    assert.equal(document.querySelector("#automaticCheckResult")?.textContent, "Automatic checks off.");
    finishRefresh();
    await turn();
    assert.equal(toggle.checked, false, "a read started during the write cannot restore its old setting after the pause succeeds");
    assert.equal(document.querySelector("#automaticCheckResult")?.textContent, "Automatic checks off.");
    assert.equal(fixture.messages.filter(message => message.type === "yoink:set-auto-reverification").length, 2);
    assert.equal(fixture.messages.some(message => message.type === "yoink:run-auto-reverification"), false);
  } finally { fixture.dom.window.close(); }
});

test("Settings keeps refreshing a running background check until its completion is visible", async () => {
  const response = { settings: { enabled: true }, state: null,
    schedule: { schemaVersion: 1, enabled: true, running: true, lanes: [] } };
  const fixture = await optionsHarness({ automaticResponse: response });
  try {
    const { document } = fixture;
    const button = document.querySelector("#checkNeededStores") as HTMLButtonElement;
    assert.equal(button.disabled, true);
    assert.match(document.querySelector("#automaticCheckSchedule")?.textContent || "", /A store check is running/);
    response.schedule.running = false;
    fixture.tickSchedule();
    await turn();
    assert.equal(button.disabled, false, "the periodic refresh must restore manual checks after the background run ends");
    assert.doesNotMatch(document.querySelector("#automaticCheckSchedule")?.textContent || "", /A store check is running/);
    assert.equal(fixture.messages.filter(message => message.type === "yoink:get-auto-reverification").length, 2);
    assert.equal(fixture.messages.some(message => message.type === "yoink:run-auto-reverification"), false);
  } finally { fixture.dom.window.close(); }
});

test("schedule refreshes keep a requested manual check locked until its response arrives", async () => {
  const fixture = await optionsHarness();
  try {
    const { window, document } = fixture;
    const runtime = (window as unknown as {
      chrome: { runtime: { sendMessage(message: Record<string, unknown>): Promise<unknown> } };
    }).chrome.runtime;
    const sendMessage = runtime.sendMessage;
    let finishCheck!: () => void;
    const checking = new Promise<void>(resolve => { finishCheck = resolve; });
    runtime.sendMessage = async message => {
      if (message.type === "yoink:run-auto-reverification") await checking;
      return sendMessage(message);
    };
    const button = document.querySelector("#checkNeededStores") as HTMLButtonElement;
    click(window, button);
    fixture.tickSchedule();
    click(window, document.querySelector("#refreshAutomaticSchedule")!);
    await turn();
    assert.equal(button.disabled, true);
    assert.equal(document.querySelector("#automaticCheckResult")?.textContent, "Checking candidate products without adding…");
    finishCheck();
    await turn();
    await turn();
    assert.equal(button.disabled, false);
    assert.equal(document.querySelector("#automaticCheckResult")?.textContent, "2 of 2 stores ready. No Add controls were clicked.");
    assert.equal(fixture.messages.filter(message => message.type === "yoink:run-auto-reverification").length, 1);
  } finally { fixture.dom.window.close(); }
});

test("a lane result without counts never renders undefined", async () => {
  const fixture = await optionsHarness({ laneResult: { outcome: "partial" } });
  try {
    const targetCheck = fixture.document.querySelector('[data-reverify-retailer="target"]') as HTMLElement;
    click(fixture.window, targetCheck.querySelector("button") as HTMLButtonElement);
    await turn();
    await turn();
    const status = targetCheck.querySelector("[data-lane-status]")?.textContent ?? "";
    assert.doesNotMatch(status, /undefined/);
    assert.equal(status, "Partly passed · more evidence needed");
  } finally { fixture.dom.window.close(); }
});

test("store access rows survive permission API failures with visible feedback", async () => {
  const fixture = await optionsHarness({ containsFailsFor: "https://*.walmart.com/*", requestFails: true });
  try {
    const rows = [...fixture.document.querySelectorAll("#permissionList .permission-row")];
    assert.equal(rows.length, 20, "One failing origin must not empty the whole list.");
    const walmart = rows.find((row) => row.querySelector("strong")?.textContent === "Walmart");
    assert.match(walmart?.textContent ?? "", /Unavailable/);
    const bestbuy = rows.find((row) => row.querySelector("strong")?.textContent === "Best Buy");
    assert.ok(bestbuy);
    click(fixture.window, bestbuy.querySelector("button") as HTMLButtonElement);
    await turn();
    await turn();
    assert.match(bestbuy.textContent ?? "", /Could not change access/);
    assert.equal((bestbuy.querySelector("button") as HTMLButtonElement).disabled, false);
  } finally { fixture.dom.window.close(); }
});
