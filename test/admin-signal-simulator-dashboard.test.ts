import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 300): Promise<void> {
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

test("the admin Opportunities workspace submits the minimal signal simulator in place", async () => {
  const db = new YoinkDatabase();
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-signal-simulator-dashboard-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#signals`,
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
      browser.document.querySelector("#heroStatus")?.textContent ?? "",
      /Actions/
    ));

    const form = browser.document.querySelector("#signalSimulationForm") as HTMLFormElement;
    const result = browser.document.querySelector("#signalSimulationResult") as HTMLElement;
    const button = browser.document.querySelector("#simulateSignalButton") as HTMLButtonElement;
    assert.ok(form);
    assert.equal(result.getAttribute("role"), "status");
    assert.equal(result.getAttribute("aria-live"), "polite");
    assert.equal(result.hidden, true);
    (form.elements.namedItem("url") as HTMLInputElement).value = "https://www.amazon.com/Product/dp/B00E4AMFKK/ref=tracking";
    (form.elements.namedItem("price") as HTMLInputElement).value = "5.82";
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));

    await eventually(() => assert.match(result.textContent ?? "", /Dry-run recorded/));
    assert.match(result.textContent ?? "", /Amazon product · B00E4AMFKK · \$5\.82/);
    assert.match(result.textContent ?? "", /no catalog listing was created/i);
    assert.match(result.textContent ?? "", /No mission · No action job · No retailer action · No cart change/);
    assert.equal(result.classList.contains("error"), false);
    await eventually(() => {
      assert.equal(form.hasAttribute("aria-busy"), false);
      assert.equal(button.disabled, false);
      assert.equal(button.textContent, "Simulate signal");
    });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM signal_events WHERE test = 1 AND parser_version = 'admin-simulator-v1'"
    )?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_incidents")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 0);
    await eventually(() => assert.match(
      browser.document.querySelector("#signalList")?.textContent ?? "",
      /test signal/i
    ));
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
