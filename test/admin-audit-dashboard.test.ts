import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 80): Promise<void> {
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

test("admin activity reaches safety decisions from two filters and keeps correlation ids compact", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: "http://127.0.0.1:32991/admin#activity",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const requests: string[] = [];
  const copied: string[] = [];
  const correlationId = "correlation_guardrail_fixture_123456789";
  const snapshot = {
    version: "admin-audit-filter-test",
    settings: { actionsPaused: false, executionMode: "live" },
    capabilities: {},
    counts: {},
    actor: {
      displayName: "Admin Fixture",
      tenantName: "Fixture tenant",
      roleLabels: ["Tenant administrator"],
      sessionKind: "local",
      signOutUrl: ""
    }
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (pathValue: string) => {
      const path = String(pathValue);
      requests.push(path);
      const payload = path === "/api/v1/admin/snapshot?view=activity"
        ? snapshot
        : path.startsWith("/api/v1/user/audit?")
          ? {
              items: [{
                correlationId,
                eventType: "guardrail_settings_updated",
                reasonCode: "approval_recorded",
                message: "Store action settings were reviewed.",
                actorKind: "user",
                eventFamily: "safety",
                createdAt: new Date().toISOString()
              }],
              total: 1
            }
          : {};
      return { ok: true, status: 200, json: async () => payload };
    }
  });
  Object.defineProperty(browser.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value: string) => { copied.push(value); } }
  });
  Object.defineProperty(browser, "setTimeout", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });

  try {
    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.equal(browser.document.querySelectorAll("#auditList .timeline-item").length, 1));
    const auditText = browser.document.querySelector("#auditList")?.textContent ?? "";
    assert.match(auditText, /guardrail settings updated/i);
    assert.match(auditText, /User/);
    assert.match(auditText, /Copy id/);
    assert.doesNotMatch(auditText, new RegExp(correlationId));
    assert.equal(browser.document.querySelector("#outboxSummary"), null);

    const type = browser.document.querySelector("#auditType") as HTMLSelectElement;
    type.value = "safety";
    type.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.ok(requests.some((path) => new URL(path, browser.location.origin).searchParams.get("type") === "safety")));

    const range = browser.document.querySelector("#auditRange") as HTMLSelectElement;
    range.value = "24h";
    range.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.ok(requests.some((path) => {
      const url = new URL(path, browser.location.origin);
      return url.searchParams.get("type") === "safety" && Boolean(url.searchParams.get("since"));
    })));
    const finalRequest = [...requests].reverse().find((path) => path.startsWith("/api/v1/user/audit?")) ?? "";
    const finalUrl = new URL(finalRequest, browser.location.origin);
    assert.equal(finalUrl.searchParams.get("type"), "safety");
    const since = Date.parse(finalUrl.searchParams.get("since") ?? "");
    assert.ok(Number.isFinite(since));
    assert.ok(Date.now() - since >= 23.9 * 60 * 60 * 1000);
    assert.ok(Date.now() - since <= 24.1 * 60 * 60 * 1000);

    (browser.document.querySelector("[data-copy-correlation]") as HTMLButtonElement).click();
    await eventually(() => assert.deepEqual(copied, [correlationId]));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Activity id copied/));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    browser.close();
  }
});
