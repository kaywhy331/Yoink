import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import { buildStoreSetup } from "../packages/domain/src/store-setup.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

test("the existing dashboard poll updates permission and age in an open checklist and the store list", async () => {
  const script = readFileSync("apps/web/user.js", "utf8");
  const dom = new JSDOM(readFileSync("apps/web/user.html", "utf8"), { runScripts: "outside-only", pretendToBeVisual: true });
  const page = dom.window;
  const now = Date.parse("2026-10-16T15:00:00Z");
  const input: Parameters<typeof buildStoreSetup>[0] = {
    now, version: "test", settings: { actionsPaused: false, executionMode: "live" }, permissions: ["user.read"],
    devices: [{ id: "browser", status: "active", extensionVersion: "test", online: true,
      lastSeenAt: new Date(now - 30_000).toISOString(), accessibleRetailers: ["target"],
      capabilities: { officialMsrpCartV1: true, jobReconciliation: true, targetAddOnly: true,
        targetAddAdapterVersion: ADD_LANES.target.contractVersion } }],
    lanes: [{ retailerId: "target", qualification: { status: "qualified", warning: "none", expiresAt: "" },
      session: { deviceId: "browser", signedInState: "ready", adapterVersion: ADD_LANES.target.contractVersion,
        updatedAt: new Date(now - 20 * 60_000).toISOString() },
      evidence: { liveEvidenceReady: true, rehearsalReady: true }, checklist: [{ id: "qualification", ready: true }],
      degraded: false, blockedReason: "", candidate: null }]
  };
  const calls: string[] = [];
  const timers: Array<() => Promise<void>> = [];
  let unavailable = false;
  page.api = async (path: string) => {
    calls.push(path);
    assert.equal(path, "/api/v1/user/readiness", "the refresh only reads readiness");
    if (unavailable) throw new Error("Connection unavailable");
    return { stores: buildStoreSetup(input), plan: { createdAt: new Date(input.now).toISOString() } };
  };
  page.setTimeout = (fn: () => Promise<void>, delay: number) => {
    assert.equal(delay, 30_000);
    timers.push(fn);
    return timers.length;
  };
  page.clearTimeout = () => undefined;
  page.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  page.open = () => { throw new Error("Refreshing permission must not open retailer tabs"); };
  try {
    // Execute the real scheduler, renderer and loader with only browser/API dependencies stubbed.
    page.eval(`
      const state = { storeSetup: { retailerId: "target" }, storeSetupSequence: 0, affiliateRouting: {}, storeSetups: [] };
      const $ = selector => document.querySelector(selector);
      const $$ = selector => [...document.querySelectorAll(selector)];
      const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
      const activeUserRoute = () => "setup";
      const retailerDisplayName = () => "Target";
      const retailerLinkMarkup = () => "";
      const refreshVisibleActionState = async () => undefined;
      const renderStoreSwitches = () => { document.querySelector("#storeSwitchList").textContent = state.storeSetups[0]?.cartAdds.status || ""; };
      ${script.slice(script.indexOf("function storeSetupActionMarkup("), script.indexOf('$("#storeSetupDialog").addEventListener("cancel"'))}
      ${script.slice(script.indexOf("let adaptivePollTimer = null;"), script.indexOf("function beginPriorityRouteLoad("))}
      globalThis.start = () => { scheduleAdaptivePoll(); };
      globalThis.closeChecklist = () => { state.storeSetup = null; };
    `);
    page.start();
    await timers.shift()!();
    const permission = () => page.document.querySelector('[data-setup-step="permission"]')!;
    assert.match(permission().textContent, /Passed.*allowed 30s ago/s);
    input.devices[0]!.accessibleRetailers = [];
    input.now += 15_000;
    await timers.shift()!();
    assert.match(permission().textContent, /Needs attention.*not allowed 45s ago/s);
    input.now += 46_000;
    await timers.shift()!();
    assert.match(permission().textContent, /Not verified here.*unknown/s);
    assert.doesNotMatch(permission().textContent, /Passed/);
    unavailable = true;
    await timers.shift()!();
    assert.match(page.document.querySelector("#storeSetupError")?.textContent, /checks may be out of date/);
    unavailable = false;
    page.closeChecklist();
    input.devices[0]!.accessibleRetailers = ["target"];
    input.devices[0]!.lastSeenAt = new Date(input.now).toISOString();
    await timers.shift()!();
    assert.match(page.document.querySelector("#storeSwitchList").textContent, /signed in at Target/);
    assert.equal(calls.length, 5);
  } finally { page.close(); }
});
