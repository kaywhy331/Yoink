import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("Chrome settings show per-store schedules and pause future checks without granting store access", async ({ page }, testInfo) => {
  await page.clock.install();
  const files = new Set(["options.html", "options.css", "options.js", "runtime-config.js", "popup-state.js"]);
  await page.route("**/extension-schedule-test/*", async route => {
    const file = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (!files.has(file)) return route.abort();
    return route.fulfill({ body: await readFile(join(process.cwd(), "apps/extension", file)),
      contentType: file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : "application/javascript" });
  });
  await page.addInitScript(() => {
    const host = globalThis as any;
    host.scheduleMessages = [];
    let enabled = true;
    const now = Date.now();
    const stamp = (delta: number) => new Date(now + delta).toISOString();
    const policy = { schemaVersion: 1, dailyRunLimit: 6, dayBoundary: "UTC", firstRunDelayMinutes: 2,
      attentionPeriodMinutes: 60, steadyPeriodMinutes: 360, passBackoffMs: 1800000,
      failureBackoffMs: [3600000, 14400000, 43200000, 86400000], helpBackoffMs: 86400000 };
    const plan = { lanes: ["target", "walmart"].map(retailerId => ({ retailerId,
      qualification: { status: "retired", warning: "version_changed" }, evidence: { qualificationEvidenceReady: false },
      candidate: { retailerSku: "12345678" }, candidates: [{ retailerSku: "12345678", qualificationTypes: [] }], automaticCheckNeeded: true })) };
    host.chrome = {
      permissions: { contains: async () => true, request: async () => { throw new Error("Schedule views must not request store access"); } },
      runtime: { sendMessage: async (message: any) => {
        host.scheduleMessages.push(message.type);
        if (message.type === "yoink:check-health") return { ok: true, state: { paired: true, connected: true } };
        if (message.type === "yoink:get-reverification-plan") return { ok: true, plan };
        if (message.type === "yoink:set-auto-reverification") {
          if (host.holdPause) await new Promise<void>(resolve => { host.finishPause = resolve; });
          enabled = message.enabled;
          return { ok: true, settings: { enabled } };
        }
        if (message.type === "yoink:get-auto-reverification") return { ok: true, settings: { enabled }, policy, state: null,
          schedule: { schemaVersion: 1, enabled, computedAt: stamp(0), running: host.storeCheckRunning === true, reason: "automatic_check_cooldown",
            runsToday: 2, resetAt: stamp(86400000), nextEligibleAt: enabled ? stamp(3600000) : null, nextReviewAt: stamp(3600000),
            lanes: plan.lanes.map(lane => ({ retailerId: lane.retailerId, state: enabled ? "waiting" : "off",
              lastCheckedAt: stamp(-3600000), eligibleAt: stamp(3600000), reasonCode: "automatic_check_cooldown" })) } };
        throw new Error(`Unexpected schedule operation: ${message.type}`);
      } }
    };
  });
  page.on("pageerror", error => { throw error; });
  await page.goto("/extension-schedule-test/options.html");
  await expect(page.locator("#automaticCheckSchedule")).toContainText("Next eligible check:");
  await expect(page.locator(".automatic-lane-schedule")).toHaveCount(2);
  await expect(page.locator(".automatic-lane-schedule").first()).toContainText("Last check:");
  await page.getByText("How automatic checks run", { exact: true }).click();
  await expect(page.locator("#automaticCheckPolicy")).toContainText("6 automatic runs per UTC day");
  await page.getByRole("button", { name: "Refresh schedule", exact: true }).click();
  await expect(page.locator("#automaticCheckSchedule")).toContainText("2 of 6 automatic runs used");
  await page.locator("#laneReadinessTitle").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("check-schedule-phone.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#laneReadinessTitle").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("check-schedule-desktop.png") });
  await page.evaluate(() => { (globalThis as any).holdPause = true; });
  await page.locator("#autoReverification").uncheck();
  await page.getByRole("button", { name: "Refresh schedule", exact: true }).click();
  await expect(page.locator("#autoReverification")).toBeDisabled();
  await expect(page.locator("#autoReverification")).not.toBeChecked();
  await expect(page.locator("#automaticCheckResult")).toHaveText("Turning automatic checks off…");
  await page.evaluate(() => { (globalThis as any).finishPause(); });
  await expect(page.locator("#autoReverification")).toBeEnabled();
  await expect(page.locator("#automaticCheckSchedule")).toContainText("Automatic checks off. Manual checks are still available.");
  await expect(page.locator(".automatic-lane-schedule").first()).toContainText("Automatic checks off");
  await expect(page.getByRole("button", { name: "Check needed stores", exact: true })).toBeEnabled();
  await page.evaluate(() => { (globalThis as any).storeCheckRunning = true; });
  await page.getByRole("button", { name: "Refresh schedule", exact: true }).click();
  await expect(page.locator("#automaticCheckSchedule")).toContainText("A store check is running");
  await expect(page.getByRole("button", { name: "Check needed stores", exact: true })).toBeDisabled();
  await page.evaluate(() => { (globalThis as any).storeCheckRunning = false; });
  await page.clock.fastForward(60_000);
  await expect(page.locator("#automaticCheckSchedule")).toContainText("Automatic checks off. Manual checks are still available.");
  await expect(page.getByRole("button", { name: "Check needed stores", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (globalThis as any).scheduleMessages.some((type: string) => type === "yoink:run-auto-reverification" || type === "yoink:reverify-retailer-lanes"))).toBe(false);
});
