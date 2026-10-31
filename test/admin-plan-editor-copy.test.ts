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

test("the admin and shopper plan editors use the same field language", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: "http://127.0.0.1:32991/admin#missions",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const missionSummary = {
    id: "mission_copy_fixture",
    title: "Plan copy fixture",
    origin: "user",
    createdAt: "2026-09-01T12:00:00.000Z",
    status: "active",
    targetCount: 1,
    enabledTargetCount: 1,
    targetQuantity: 2,
    intentRevision: 3,
    actionCeiling: "add_to_cart",
    decisionMode: "purchase_intent"
  };
  const mission = {
    ...missionSummary,
    targets: [{
      id: "mission_target_copy_fixture",
      retailerName: "Target",
      retailerSku: "95280894",
      listingStatus: "in_stock",
      lastObservedPriceCents: 4499,
      msrpCents: 4999,
      currency: "USD",
      executionSupported: true,
      enabled: true,
      maxUnitPriceCents: 5000,
      sellerPolicy: "first_party_only",
      fulfillment: "manual",
      canonicalUrl: "https://www.target.com/p/-/A-95280894"
    }]
  };
  const snapshot = {
    version: "admin-plan-copy-test",
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
      const payload = path === "/api/v1/admin/snapshot?view=missions"
        ? snapshot
        : path === "/api/v1/user/missions?limit=50&offset=0&q="
          ? { items: [missionSummary], total: 1 }
          : path === "/api/v1/user/missions/mission_copy_fixture"
            ? { mission }
            : {};
      return { ok: true, status: 200, json: async () => payload };
    }
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
    await eventually(() => assert.match(browser.document.querySelector("#missionList")?.textContent ?? "", /Plan copy fixture/));
    const listCopy = browser.document.querySelector("#missionList")?.textContent ?? "";
    assert.match(listCopy, /Add to cart/);
    assert.doesNotMatch(listCopy, /(?:Intent|Plan) r3/);

    (browser.document.querySelector('[data-mission-edit="mission_copy_fixture"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(browser.document.querySelector("#missionDialog")?.hasAttribute("open"), true));
    const dialog = browser.document.querySelector("#missionDialog") as HTMLDialogElement;
    const editor = dialog.querySelector("[data-mission-target]") as HTMLElement;
    const formLabels = [...dialog.querySelectorAll("#missionForm > .form-grid > label > span")]
      .map((label) => label.textContent?.trim());
    assert.deepEqual(formLabels, ["Status", "Quantity"]);
    const targetLabels = [...editor.querySelectorAll(".form-grid label > span")]
      .map((label) => label.textContent?.trim());
    assert.deepEqual(targetLabels, ["Use store", "Maximum price", "Seller", "Fulfillment"]);
    assert.match(editor.textContent ?? "", /Cart mapping available/);
    assert.deepEqual(
      [...editor.querySelectorAll('[data-target-field="sellerPolicy"] option')].map((option) => option.textContent),
      ["Use default", "Store only", "Marketplace allowed"]
    );
    assert.deepEqual(
      [...editor.querySelectorAll('[data-target-field="fulfillment"] option')].map((option) => option.textContent),
      ["Shipping (default)", "Pickup (explicit opt-in)"]
    );
    assert.match(editor.textContent ?? "", /legacy Manual setting is shown as Shipping/);
    assert.doesNotMatch(editor.textContent ?? "", /Target enabled|Executable mapping|First party only|Manual review/);
  } finally {
    browser.close();
  }
});
