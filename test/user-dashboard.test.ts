import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 40): Promise<void> {
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

test("guided dashboard setup does not create a plan before review and submits explicit exact limits", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const posts: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  let created = false;
  const product = {
    variantId: "variant_dashboard_test",
    title: "Exact Dashboard Fixture",
    listingId: "listing_dashboard_test",
    retailerId: "target",
    retailerName: "Target",
    retailerSku: "95280900",
    canonicalUrl: "https://www.target.com/p/-/A-95280900",
    status: "in_stock",
    executionSupported: true,
    msrpCents: 2495,
    currentPriceCents: 798,
    currency: "USD",
    variantAttributes: { edition: "First", color: "Forest" }
  };
  const overview = {
    settings: {
      actionsPaused: true,
      executionMode: "shadow",
      taxBps: 0,
      storeAllowancesCents: { target: 0 }
    },
    counts: { products: 1, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: [],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  const planSummary = {
    id: "mission_dashboard_test",
    variantId: product.variantId,
    title: product.title,
    status: "active",
    targetQuantity: 2,
    targetCount: 1,
    enabledTargetCount: 1,
    actionCeiling: "add_to_cart",
    decisionMode: "purchase_intent",
    maxAllInCents: 2000,
    primaryRetailerName: "Target",
    primaryRetailerSku: product.retailerSku,
    primaryCurrentPriceCents: 798,
    primaryMaxUnitPriceCents: 1000,
    primaryFulfillment: "shipping"
  };
  const planDetail = {
    ...planSummary,
    intentPolicy: {
      revision: 1,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      decisionMode: "purchase_intent",
      maxSignalAgeSeconds: 120,
      substitutionPolicy: "exact_only",
      cooldownSeconds: 900,
      expiresAt: ""
    },
    targets: [{
      id: "mission_target_dashboard_test",
      listingId: product.listingId,
      retailerId: product.retailerId,
      retailerName: product.retailerName,
      retailerSku: product.retailerSku,
      canonicalUrl: product.canonicalUrl,
      executionSupported: true,
      enabled: true,
      maxUnitPriceCents: 1000,
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      currency: "USD",
      lastObservedPriceCents: 798
    }]
  };
  const payloadFor = (path: string) => {
    if (path === "/api/v1/user/overview") return overview;
    if (path === "/api/v1/user/privacy") return { inventory: {
      totalRecords: 12,
      credentialMaterialsExcluded: true,
      categories: [{ id: "catalog_and_plans", label: "Products and purchase plans", recordCount: 12 }]
    } };
    if (path.startsWith("/api/v1/user/library")) return { items: [product] };
    if (path === "/api/v1/user/purchase-intents/mission_dashboard_test") return { purchaseIntent: planDetail };
    if (path.startsWith("/api/v1/user/purchase-intents")) return { items: created ? [planSummary] : [] };
    if (path.startsWith("/api/v1/user/jobs")) return { items: [] };
    if (path.startsWith("/api/v1/user/catalog/proposals")) return { items: [] };
    return {};
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      if (options.method === "POST") {
        posts.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        created = true;
        return { ok: true, status: 201, json: async () => ({ created: true, purchaseIntent: {} }) };
      }
      if (options.method === "PATCH") {
        patches.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        return { ok: true, status: 200, json: async () => ({ purchaseIntent: planDetail }) };
      }
      return { ok: true, status: 200, json: async () => payloadFor(String(path)) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); }
  });

  try {
    browser.eval(`${script}\n//# sourceURL=user-dashboard-test.js`);
    await eventually(() => assert.ok(browser.document.querySelector("[data-track-listing]")));
    assert.match(browser.document.querySelector("#privacySummary")?.textContent ?? "", /12 records/);
    assert.equal((browser.document.querySelector("#privacyExportLink") as HTMLAnchorElement).pathname, "/api/v1/user/privacy/export");
    assert.equal(posts.length, 0);
    (browser.document.querySelector("[data-track-listing]") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#setupDialog") as HTMLDialogElement;
    assert.equal(dialog.hasAttribute("open"), true);
    assert.equal(posts.length, 0);
    assert.match(browser.document.querySelector("#setupProductSummary")?.textContent ?? "", /95280900/);
    assert.match(browser.document.querySelector("#setupProductSummary")?.textContent ?? "", /\$7\.98/);
    assert.match(browser.document.querySelector("#setupReviewRows")?.textContent ?? "", /Notify me only/);

    const form = browser.document.querySelector("#setupForm") as HTMLFormElement;
    const quantity = form.elements.namedItem("targetQuantity") as HTMLInputElement;
    const maxUnit = form.elements.namedItem("maxUnitPrice") as HTMLInputElement;
    const maxAllIn = form.elements.namedItem("maxAllIn") as HTMLInputElement;
    const add = form.querySelector('input[value="add_to_cart"]') as HTMLInputElement;
    const reviewed = form.elements.namedItem("reviewed") as HTMLInputElement;
    quantity.value = "2";
    maxUnit.value = "10.00";
    maxAllIn.value = "20.00";
    add.checked = true;
    add.dispatchEvent(new browser.Event("input", { bubbles: true }));
    reviewed.checked = true;
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], {
      contractVersion: 1,
      listingId: "listing_dashboard_test",
      targetQuantity: 2,
      maxUnitPriceCents: 1000,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: 900,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    });
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /checkout stays manual/));

    await eventually(() => assert.ok(browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]')));
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    const editDialog = browser.document.querySelector("#planDialog") as HTMLDialogElement;
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    assert.match(browser.document.querySelector("#planExecutionNote")?.textContent ?? "", /safety bound/);
    const editForm = browser.document.querySelector("#planForm") as HTMLFormElement;
    editForm.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(patches.length, 1));
    assert.deepEqual((patches[0]?.policy as Record<string, unknown>), {
      expectedRevision: 1,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      decisionMode: "purchase_intent",
      maxSignalAgeSeconds: 120,
      substitutionPolicy: "exact_only",
      cooldownSeconds: 900,
      expiresAt: "",
      changeReason: "Updated from the user purchase dashboard."
    });
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /preferences saved/i));

    planDetail.intentPolicy.decisionMode = "strategy";
    planDetail.intentPolicy.actionCeiling = "add_to_cart";
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    assert.equal((editForm.elements.namedItem("actionCeiling") as HTMLSelectElement).value, "notify");
    assert.match(browser.document.querySelector("#planModeCopy")?.textContent ?? "", /converts it to a reviewed direct plan/i);
    editDialog.close();
  } finally {
    browser.close();
  }
});
