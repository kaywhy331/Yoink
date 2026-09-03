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

const webRoot = join(process.cwd(), "apps", "web");

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

function click(window: Window & typeof globalThis, element: Element): void {
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function pendingFetch(): Promise<never> {
  return new Promise(() => undefined);
}

test("shopper routes push history, restore tabs, and canonicalize aliases", async () => {
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/#home",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", { configurable: true, value: pendingFetch });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  try {
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=ui-route-history-user.js`);
    assert.equal(browser.location.hash, "#home");
    click(browser, browser.document.querySelector('[data-tab="products"]') as Element);
    assert.equal(browser.location.hash, "#products");
    click(browser, browser.document.querySelector('.tabs [data-tab="calls"]') as Element);
    assert.equal(browser.location.hash, "#calls");
    click(browser, browser.document.querySelector('[data-call-filter="drawings"]') as Element);
    assert.equal(browser.location.hash, "#calls/drawings");
    assert.equal(browser.document.querySelector('[data-panel="calls"]')?.classList.contains("active"), true);
    assert.equal(browser.document.querySelector('[data-call-filter="drawings"]')?.getAttribute("aria-pressed"), "true");
    click(browser, browser.document.querySelector('[data-call-filter="all"]') as Element);
    assert.equal(browser.location.hash, "#calls");

    browser.history.back();
    await eventually(() => {
      assert.equal(browser.location.hash, "#calls/drawings");
      assert.equal(browser.document.querySelector('[data-call-filter="drawings"]')?.getAttribute("aria-pressed"), "true");
    });
    browser.history.back();
    await eventually(() => assert.equal(browser.location.hash, "#calls"));
    browser.history.back();
    await eventually(() => {
      assert.equal(browser.location.hash, "#products");
      assert.equal(browser.document.querySelector('[data-panel="products"]')?.classList.contains("active"), true);
    });
    browser.history.back();
    await eventually(() => assert.equal(browser.location.hash, "#home"));

    browser.location.hash = "connections";
    await eventually(() => {
      assert.equal(browser.location.hash, "#settings/chrome");
      assert.equal(browser.document.querySelector('[data-panel="preferences"]')?.classList.contains("active"), true);
      assert.equal(browser.document.querySelector('[data-settings-view="chrome"]')?.getAttribute("aria-pressed"), "true");
    });
    browser.location.hash = "health";
    await eventually(() => {
      assert.equal(browser.location.hash, "#activity/insights");
      assert.equal(browser.document.querySelector('[data-panel="insights"]')?.classList.contains("active"), true);
    });
    browser.location.hash = "diagnostics";
    await eventually(() => assert.equal(browser.location.hash, "#settings/chrome"));
    browser.location.hash = "preferences";
    await eventually(() => {
      assert.equal(browser.location.hash, "#settings");
      assert.equal(browser.document.querySelector('[data-panel="preferences"]')?.classList.contains("active"), true);
      assert.equal(browser.document.querySelector('[data-settings-view="purchase"]')?.getAttribute("aria-pressed"), "true");
    });
  } finally {
    browser.close();
  }
});

function adminBrowser(hash = "overview") {
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `http://127.0.0.1:32991/admin#${hash}`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", { configurable: true, value: pendingFetch });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: false, note: "" }) }
  });
  void browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
  return browser;
}

test("admin subviews keep one canonical hash and restore the prior destination", async () => {
  const browser = adminBrowser();
  try {
    assert.equal(browser.location.hash, "#overview");
    click(browser, browser.document.querySelector('[data-view="sources"]') as Element);
    assert.equal(browser.location.hash, "#sources/channels");
    click(browser, browser.document.querySelector('[data-connections-view="drops"]') as Element);
    assert.equal(browser.location.hash, "#sources/drops");
    click(browser, browser.document.querySelector('[data-view="stores"]') as Element);
    assert.equal(browser.location.hash, "#stores/qualification/target");
    assert.equal(String(browser.location.hash).slice(1).split("/").length, 3);
    const targetPanel = browser.document.querySelector('[data-qualification-panel="target"]') as HTMLElement;
    assert.equal(targetPanel.hidden, false);
    assert.equal(targetPanel.querySelector("#activateTargetAddButton")?.textContent?.trim(), "Enable guarded Target adds");
    click(browser, browser.document.querySelector('[data-qualification-retailer="walmart"]') as Element);
    assert.equal(browser.location.hash, "#stores/qualification/walmart");
    assert.equal(String(browser.location.hash).slice(1).split("/").length, 3);

    browser.history.back();
    await eventually(() => assert.equal(browser.location.hash, "#stores/qualification/target"));
    browser.history.back();
    await eventually(() => {
      assert.equal(browser.location.hash, "#sources/drops");
      assert.equal(browser.document.querySelector('[data-connections-view="drops"]')?.getAttribute("aria-pressed"), "true");
    });

    browser.location.hash = "diagnostics";
    await eventually(() => {
      assert.equal(browser.location.hash, "#stores/diagnostics/target");
      assert.equal(browser.document.querySelector('[data-connections-view="diagnostics"]')?.getAttribute("aria-pressed"), "true");
    });
    for (const [group, destination] of ([
      ["inbox", "#approvals"],
      ["catalog", "#library"],
      ["plans", "#missions"],
      ["maintainer", "#community/sharing"]
    ] as const)) {
      browser.location.hash = group;
      await eventually(() => assert.equal(browser.location.hash, destination));
    }
    browser.location.hash = "preferences";
    await eventually(() => {
      assert.equal(browser.location.hash, "#settings/guardrails");
      assert.equal(browser.document.querySelector('[data-view-panel="settings"]')?.classList.contains("active"), true);
      assert.equal(browser.document.querySelector('[data-admin-settings-view="guardrails"]')?.getAttribute("aria-pressed"), "true");
    });
    browser.location.hash = "health";
    await eventually(() => {
      assert.equal(browser.location.hash, "#operations/health");
      assert.equal(browser.document.querySelector('[data-view-panel="operations"]')?.classList.contains("active"), true);
      assert.equal(browser.document.querySelector('[data-operations-view="health"]')?.getAttribute("aria-pressed"), "true");
    });
  } finally {
    browser.close();
  }
});

test("admin legacy user and drop-window hashes route to access and sources/drops", async () => {
  const browser = adminBrowser();
  try {
    browser.location.hash = "users";
    await eventually(() => {
      assert.equal(browser.location.hash, "#access");
      assert.equal(browser.document.querySelector('[data-view-panel="access"]')?.classList.contains("active"), true);
    });
    browser.location.hash = "drop-windows";
    await eventually(() => {
      assert.equal(browser.location.hash, "#sources/drops");
      assert.equal(browser.document.querySelector('[data-view-panel="connections"]')?.classList.contains("active"), true);
      assert.equal(browser.document.querySelector('[data-connections-view="drops"]')?.getAttribute("aria-pressed"), "true");
    });
  } finally {
    browser.close();
  }
});
