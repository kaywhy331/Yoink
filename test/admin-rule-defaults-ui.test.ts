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

test("Rules are clearly defaults and expose only actionable choices with contextual quantity", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: "http://127.0.0.1:32991/admin#strategies",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const legacyStrategy = {
    id: "strategy_legacy_checkout",
    name: "Legacy checkout rule",
    enabled: true,
    position: 10,
    revision: 1,
    sources: [],
    retailers: [],
    pricePolicy: { kind: "at_or_below_msrp" },
    sellerPolicy: "first_party_only",
    allowedSellers: [],
    includeKeywords: "pokemon",
    excludeKeywords: "used",
    action: "prepare_checkout",
    quantity: "max",
    fulfillment: "manual",
    maxSignalAgeSeconds: 120
  };
  const snapshot = {
    view: "strategies",
    version: "admin-rule-defaults-test",
    settings: { actionsPaused: false, executionMode: "live" },
    capabilities: {},
    counts: {},
    trackalacker: {},
    permissions: ["admin.read"],
    actor: { displayName: "Admin", tenantName: "Yoink", roleLabels: ["Administrator"], sessionKind: "local", signOutUrl: "" },
    sources: [],
    strategies: [legacyStrategy]
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async () => ({ ok: true, status: 200, json: async () => snapshot })
  });
  Object.defineProperty(browser, "setTimeout", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });

  try {
    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.match(browser.document.querySelector("#strategyList")?.textContent ?? "", /Legacy checkout rule/));

    assert.match(browser.document.querySelector('[data-view-panel="strategies"] h1')?.textContent ?? "", /Rules \(automatic plan defaults\)/);
    assert.equal(browser.document.querySelectorAll("#strategyKeywordHelp li").length, 3);
    const actionSelect = browser.document.querySelector('#strategyForm select[name="action"]') as HTMLSelectElement;
    const fulfillmentSelect = browser.document.querySelector('#strategyForm select[name="fulfillment"]') as HTMLSelectElement;
    assert.deepEqual([...actionSelect.options].map((option) => option.value), ["", "notify", "add_to_cart"]);
    assert.deepEqual([...fulfillmentSelect.options].map((option) => option.value), ["shipping", "pickup"]);
    assert.equal([...actionSelect.options].some((option) => ["prepare_checkout", "submit_order"].includes(option.value)), false);

    (browser.document.querySelector("#addStrategyButton") as HTMLButtonElement).click();
    const strategyForm = browser.document.querySelector("#strategyForm") as HTMLFormElement;
    const quantity = strategyForm.elements.namedItem("quantity") as HTMLSelectElement;
    const maxOption = quantity.querySelector('[value="max"]') as HTMLOptionElement;
    assert.equal(actionSelect.value, "notify");
    assert.equal(maxOption.hidden, true);
    assert.equal(maxOption.disabled, true);

    actionSelect.value = "add_to_cart";
    actionSelect.dispatchEvent(new browser.Event("change", { bubbles: true }));
    assert.equal(maxOption.hidden, false);
    assert.equal(maxOption.disabled, false);
    quantity.value = "max";
    actionSelect.value = "notify";
    actionSelect.dispatchEvent(new browser.Event("change", { bubbles: true }));
    assert.equal(quantity.value, "1");
    assert.equal(maxOption.hidden, true);

    (browser.document.querySelector('[data-strategy-edit="strategy_legacy_checkout"]') as HTMLButtonElement).click();
    assert.equal(actionSelect.value, "");
    assert.equal((browser.document.querySelector("#strategyLegacyActionNote") as HTMLElement).hidden, false);
    assert.match(browser.document.querySelector("#strategyLegacyActionNote")?.textContent ?? "", /Choose Notify or Add to cart/);
    assert.equal(fulfillmentSelect.value, "shipping");
    assert.equal((browser.document.querySelector("#strategyLegacyFulfillmentNote") as HTMLElement).hidden, false);
    assert.match(browser.document.querySelector("#strategyLegacyFulfillmentNote")?.textContent ?? "", /Retired fulfillment; Shipping selected\. Save to confirm\./);
  } finally {
    browser.close();
  }
});
