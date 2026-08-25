import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { BackgroundTaskRepository } from "../packages/database/src/background-task-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope } from "../packages/database/src/request-scope.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 100): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

test("the Operations workspace pauses and runs one bounded maintenance schedule", async () => {
  const db = new YoinkDatabase();
  const tasks = new BackgroundTaskRepository(db);
  const schedules = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => tasks.ensureDefaultSchedules());
  const schedule = schedules.find((item) => item.taskKind === "execution_recovery");
  assert.ok(schedule);
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "background-worker-dashboard-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#operations`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: (path: string, options: RequestInit = {}) => fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        ...(options.method && options.method !== "GET" ? { Origin: baseUrl } : {}),
        ...(options.headers || {})
      }
    })
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => true });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });

  try {
    const script = readFileSync(join(webRoot, "app.js"), "utf8");
    await browser.eval(`(async () => { ${script}\n })()`);
    await eventually(() => assert.match(
      browser.document.querySelector("#backgroundWorkerScheduleList")?.textContent ?? "",
      /Action safety recovery/
    ));
    const toggle = browser.document.querySelector(
      `[data-worker-schedule-toggle="${schedule.id}"]`
    ) as HTMLButtonElement;
    assert.ok(toggle);
    assert.equal(toggle.textContent, "Pause schedule");
    toggle.click();
    await eventually(() => assert.equal(db.get<{ enabled: number }>(
      "SELECT enabled FROM background_task_schedules WHERE id = ?",
      schedule.id
    )?.enabled, 0));
    await eventually(() => assert.match(
      browser.document.querySelector("#backgroundWorkerScheduleList")?.textContent ?? "",
      /paused/
    ));
    const run = browser.document.querySelector(
      `[data-worker-schedule-run="${schedule.id}"]`
    ) as HTMLButtonElement;
    assert.ok(run);
    run.click();
    await eventually(() => assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE schedule_id = ?",
      schedule.id
    )?.count, 1));
    await eventually(() => assert.match(
      browser.document.querySelector("#backgroundWorkerTaskList")?.textContent ?? "",
      /Action safety recovery/
    ));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /queued for one bounded run/));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type IN ('background_schedule_updated', 'background_task_requested')"
    )?.count, 2);
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
