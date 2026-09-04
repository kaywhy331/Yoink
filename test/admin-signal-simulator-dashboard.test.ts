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

test("Operations tools keep simulation dry and require an explicit Live review before call injection", async () => {
  const db = new YoinkDatabase();
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-signal-simulator-dashboard-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#operations/tools`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const dialogPrototype = browser.HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof dialogPrototype.showModal !== "function") {
    dialogPrototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  }
  if (typeof dialogPrototype.close !== "function") {
    dialogPrototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  }
  let confirmationResult = false;
  let confirmationCalls = 0;
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
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => { throw new Error("Native confirm must not run."); } });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => { confirmationCalls += 1; return { confirmed: confirmationResult, note: "" }; } }
  });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });

  try {
    const script = readFileSync(join(webRoot, "app.js"), "utf8");
    const styles = readFileSync(join(webRoot, "styles.css"), "utf8");
    assert.match(styles, /\.signal-simulation-result\s*\{/);
    assert.doesNotMatch(styles, /\.signal-simulator-result\s*\{/);
    await browser.eval(`(async () => { ${script}\n })()`);
    await eventually(() => assert.match(
      browser.document.querySelector("#actionsToggle")?.textContent ?? "",
      /(?:Pause|Resume) all actions/
    ));
    assert.equal(browser.document.querySelector("#heroStatus")?.textContent?.trim(), "");
    assert.equal(browser.location.hash, "#operations/tools");
    assert.equal(browser.document.querySelector('[data-operations-view="tools"]')?.getAttribute("aria-pressed"), "true");
    assert.equal((browser.document.querySelector("#signalSimulationForm")?.closest("[data-operations-panel]") as HTMLElement).hidden, false);

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
    assert.match(result.textContent ?? "", /No plan · No action job · No store action · No cart change/);
    assert.equal(result.classList.contains("error"), false);
    await eventually(() => {
      assert.equal(form.hasAttribute("aria-busy"), false);
      assert.equal(button.disabled, false);
      assert.equal(button.textContent, "Simulate call");
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

    const openAdvanced = browser.document.querySelector("#sendSignalButton") as HTMLButtonElement;
    openAdvanced.dispatchEvent(new browser.MouseEvent("click", { bubbles: true }));
    const advancedForm = browser.document.querySelector("#signalForm") as HTMLFormElement;
    const dryMode = advancedForm.elements.namedItem("mode") as RadioNodeList;
    assert.equal(dryMode.value, "dry_run");
    assert.match(browser.document.querySelector("#signalModePreview")?.textContent ?? "", /cannot create a plan/i);
    assert.equal(browser.document.querySelector("#sendAdvancedSignalButton")?.textContent, "Run dry call");

    (advancedForm.elements.namedItem("sourceConnectionId") as HTMLSelectElement).selectedIndex = 0;
    (advancedForm.elements.namedItem("externalEventId") as HTMLInputElement).value = "advanced-live-call-1";
    (advancedForm.elements.namedItem("retailerId") as HTMLSelectElement).value = "target";
    (advancedForm.elements.namedItem("retailerSku") as HTMLInputElement).value = "95280894";
    (advancedForm.elements.namedItem("title") as HTMLInputElement).value = "Advanced Live Fixture";
    (advancedForm.elements.namedItem("canonicalUrl") as HTMLInputElement).value = "https://www.target.com/p/-/A-95280894";
    (advancedForm.elements.namedItem("price") as HTMLInputElement).value = "44.99";
    (advancedForm.elements.namedItem("sellerName") as HTMLInputElement).value = "Target";
    (advancedForm.elements.namedItem("sellerType") as HTMLSelectElement).value = "first_party";
    (advancedForm.elements.namedItem("fulfillment") as HTMLSelectElement).value = "shipping";
    const liveMode = advancedForm.querySelector('input[name="mode"][value="live"]') as HTMLInputElement;
    liveMode.checked = true;
    liveMode.dispatchEvent(new browser.Event("change", { bubbles: true }));
    const livePreview = browser.document.querySelector("#signalModePreview")?.textContent ?? "";
    assert.match(livePreview, /Creates a real Target call record/);
    assert.match(livePreview, /Target plan/, "the preview reports the plans that can match the chosen store");
    assert.match(livePreview, /Cart adds are (?:on|off) for Target|Actions are paused/);
    assert.match(livePreview, /Checkout stays manual/);
    assert.equal(browser.document.querySelector("#sendAdvancedSignalButton")?.textContent, "Review live call");

    advancedForm.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(confirmationCalls, 1));
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events WHERE test = 0")?.count, 0);

    confirmationResult = true;
    advancedForm.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(confirmationCalls, 2));
    await eventually(() => assert.equal(
      db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events WHERE test = 0")?.count,
      1
    ));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Live call accepted/));
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
