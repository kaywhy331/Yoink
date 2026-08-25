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

test("the Alerts workspace binds only an opaque deployment connector reference", async () => {
  const db = new YoinkDatabase();
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({
    db,
    webRoot,
    version: "operator-alert-connector-dashboard-test",
    operatorAlertConnectorBindings: { ops_primary: "a".repeat(64) }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#alerts`,
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
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.open = true; }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() { this.open = false; }
  });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  try {
    const script = readFileSync(join(webRoot, "app.js"), "utf8");
    await browser.eval(`(async () => { ${script}\n })()`);
    await eventually(() => assert.equal(
      (browser.document.querySelector("#addOperatorAlertConnectorButton") as HTMLButtonElement)?.disabled,
      false
    ));
    (browser.document.querySelector("#addOperatorAlertConnectorButton") as HTMLButtonElement).click();
    const form = browser.document.querySelector("#operatorAlertConnectorForm") as HTMLFormElement;
    assert.ok(form);
    assert.equal(form.querySelector('input[type="url"]'), null);
    (form.elements.namedItem("name") as HTMLInputElement).value = "Primary operations webhook";
    (form.elements.namedItem("endpointReference") as HTMLInputElement).value = "ops_primary";
    (form.elements.namedItem("minimumSeverity") as HTMLSelectElement).value = "warning";
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_connectors WHERE endpoint_reference = 'ops_primary'"
    )?.count, 1));
    await eventually(() => assert.match(
      browser.document.querySelector("#operatorAlertConnectorList")?.textContent ?? "",
      /runtime bound/
    ));
    assert.equal(JSON.stringify(db.all("SELECT * FROM operator_alert_connectors")).includes("https://"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM operator_alert_connectors")).toLocaleLowerCase().includes("secret"), false);
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
