import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import {
  HOWL_AFFILIATE_ENDPOINT,
  HOWL_AFFILIATE_PROTOCOL_VERSION,
  HOWL_AFFILIATE_STORES,
  HOWL_DEFAULT_PUBLISHER_SLUG
} from "../packages/domain/src/howl-affiliate-stores.js";

const require = createRequire(import.meta.url);
const AFFILIATE_ROUTING_FIXTURE = {
  protocolVersion: HOWL_AFFILIATE_PROTOCOL_VERSION,
  endpoint: HOWL_AFFILIATE_ENDPOINT,
  publisherSlug: HOWL_DEFAULT_PUBLISHER_SLUG,
  stores: HOWL_AFFILIATE_STORES,
  registeredRetailerDomains: [
    "target.com", "walmart.com", "amazon.com", "bestbuy.com", "disneystore.com",
    "ravensburger.us", "merch.riotgames.com", "booksamillion.com", "fanatics.com",
    "kohls.com", "macys.com", "p-bandai.com", "pokemoncenter.com"
  ]
};
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
  const preflights: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const deletions: Array<Record<string, unknown>> = [];
  const transitions: Array<Record<string, unknown>> = [];
  let created = false;
  let transitioned = false;
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
  const libraryGroup = {
    variantId: product.variantId,
    familyId: "family_dashboard_test",
    title: product.title,
    brand: "",
    variantAttributes: product.variantAttributes,
    createdAt: "2026-08-25T17:00:00.000Z",
    storeCount: 1,
    listingCount: 1,
    availableListingCount: 1,
    bestPriceCents: product.currentPriceCents,
    currency: product.currency,
    lastActivityAt: "2026-08-25T17:30:00.000Z",
    listings: [{
      listingId: product.listingId,
      retailerId: product.retailerId,
      retailerName: product.retailerName,
      retailerSku: product.retailerSku,
      canonicalUrl: product.canonicalUrl,
      status: product.status,
      executionSupported: product.executionSupported,
      msrpCents: product.msrpCents,
      currency: product.currency,
      currentPriceCents: product.currentPriceCents,
      priceObservedAt: "2026-08-25T17:30:00.000Z",
      updatedAt: "2026-08-25T17:30:00.000Z"
    }]
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
    primaryFulfillment: "shipping",
    automationReadiness: {
      contractVersion: 1,
      state: "guarded_add_lane_closed",
      level: "attention",
      readyForMonitoring: true,
      readyForGuardedAdd: false,
      headline: "Target guarded add is not qualified yet",
      summary: "Monitoring remains available, but no retailer click is authorized.",
      nextActionLabel: "Review plan",
      checks: [{
        id: "lane",
        label: "Qualified store lane",
        state: "attention",
        detail: "No enabled exact store target currently has a separately qualified add-only lane."
      }]
    }
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
    if (path === "/api/v1/affiliate-routing") return { affiliateRouting: AFFILIATE_ROUTING_FIXTURE };
    if (path === "/api/v1/user/overview") return overview;
    if (path === "/api/v1/user/privacy") return { inventory: {
      totalRecords: 12,
      credentialMaterialsExcluded: true,
      categories: [{ id: "catalog_and_plans", label: "Products and purchase plans", recordCount: 12 }]
    } };
    if (path.startsWith("/api/v1/user/library")) return { items: [libraryGroup], total: 1 };
    if (path === "/api/v1/user/purchase-intents/legacy-transition") return { preview: {
      contractVersion: 1,
      eligibleCount: transitioned ? 0 : 1,
      activeCount: transitioned ? 0 : 1,
      pausedCount: 0,
      previewFingerprint: "b".repeat(64),
      outcome: "notification_only",
      retailerMutationAuthorized: false,
      checkoutAuthorized: false,
      samplePlans: transitioned ? [] : [{ id: "mission_imported_test", title: "Imported Signal Fixture", status: "active" }]
    } };
    if (path === "/api/v1/user/purchase-intents/mission_dashboard_test") return { purchaseIntent: planDetail };
    if (path.startsWith("/api/v1/user/purchase-intents")) return { items: created ? [planSummary] : [] };
    if (path.startsWith("/api/v1/user/jobs")) return { items: [] };
    if (path.startsWith("/api/v1/user/catalog/proposals")) return { items: [] };
    return {};
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      if (path === "/api/v1/user/purchase-intents/legacy-transition" && options.method === "POST") {
        transitions.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        transitioned = true;
        return { ok: true, status: 200, json: async () => ({ transition: { transitionedCount: 1, preview: { eligibleCount: 0 } } }) };
      }
      if (path === "/api/v1/user/purchase-intents/preflight" && options.method === "POST") {
        const draft = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        preflights.push(draft);
        const itemSubtotalCapCents = Number(draft.targetQuantity) * Number(draft.maxUnitPriceCents);
        return { ok: true, status: 200, json: async () => ({ preflight: {
          contractVersion: 1,
          noPurchasePlanSaved: true,
          draft,
          cost: {
            currency: "USD",
            itemSubtotalCapCents,
            taxReserveCents: 0,
            storeReserveCents: 0,
            minimumAllInCents: itemSubtotalCapCents,
            reviewedAllInCents: Number(draft.maxAllInCents),
            headroomCents: Number(draft.maxAllInCents) - itemSubtotalCapCents
          },
          automationReadiness: {
            headline: "Target guarded add is not qualified yet",
            summary: "Monitoring continues while every retailer click stays closed."
          },
          preflightFingerprint: "a".repeat(64),
          preflightedAt: "2026-08-25T18:00:00.000Z",
          validUntil: "2026-08-25T18:05:00.000Z",
          validForSeconds: 300
        } }) };
      }
      if (path === "/api/v1/user/purchase-intents/mission_dashboard_test" && options.method === "DELETE") {
        deletions.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        created = false;
        return { ok: true, status: 200, json: async () => ({ deletion: { id: "mission_dashboard_test", deleted: true } }) };
      }
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
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => true });
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
    await eventually(() => assert.ok(browser.document.querySelector("[data-quick-add]")));
    const transitionPanel = browser.document.querySelector("#legacyPlanTransition") as HTMLElement;
    assert.equal(transitionPanel.hidden, false);
    assert.match(transitionPanel.textContent ?? "", /1 imported plan needs one review/);
    (browser.document.querySelector("#reviewLegacyPlanTransitionButton") as HTMLButtonElement).click();
    const transitionDialog = browser.document.querySelector("#legacyPlanTransitionDialog") as HTMLDialogElement;
    assert.equal(transitionDialog.hasAttribute("open"), true);
    assert.match(transitionDialog.textContent ?? "", /No store action is authorized/);
    const transitionForm = browser.document.querySelector("#legacyPlanTransitionForm") as HTMLFormElement;
    const transitionReviewed = transitionForm.elements.namedItem("reviewed") as HTMLInputElement;
    const transitionButton = browser.document.querySelector("#transitionLegacyPlansButton") as HTMLButtonElement;
    assert.equal(transitionButton.disabled, true);
    transitionReviewed.checked = true;
    transitionReviewed.dispatchEvent(new browser.Event("change", { bubbles: true }));
    assert.equal(transitionButton.disabled, false);
    transitionForm.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(transitions.length, 1));
    assert.deepEqual(transitions[0], {
      contractVersion: 1,
      previewFingerprint: "b".repeat(64),
      confirmation: "CONVERT_LEGACY_PLANS_TO_NOTIFICATIONS"
    });
    await eventually(() => assert.equal(transitionDialog.hasAttribute("open"), false));
    await eventually(() => assert.equal(transitionPanel.hidden, true));
    const outbound = new URL((browser.document.querySelector("#productList a.canonical") as HTMLAnchorElement).href);
    assert.equal(outbound.origin, "https://howl.link");
    assert.equal(outbound.pathname, "/link");
    assert.equal(outbound.searchParams.get("url"), product.canonicalUrl);
    assert.equal(outbound.searchParams.get("publisher_slug"), "collectwithdodo");
    assert.equal(outbound.searchParams.get("article_name"), product.title);
    assert.equal(outbound.searchParams.get("article_url"), "http://127.0.0.1:32991/");
    assert.match((browser.document.querySelector("#productList a.canonical") as HTMLAnchorElement).rel, /\bsponsored\b/);
    assert.match(browser.document.querySelector("#privacySummary")?.textContent ?? "", /12 records/);
    assert.equal((browser.document.querySelector("#privacyExportLink") as HTMLAnchorElement).pathname, "/api/v1/user/privacy/export");
    assert.equal(posts.length, 0);
    (browser.document.querySelector("[data-product-detail]") as HTMLButtonElement).click();
    const productDialog = browser.document.querySelector("#productDialog") as HTMLDialogElement;
    assert.equal(productDialog.hasAttribute("open"), true);
    assert.equal(posts.length, 0);
    (browser.document.querySelector("#productDialogBody [data-track-listing]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(productDialog.hasAttribute("open"), false));
    const dialog = browser.document.querySelector("#setupDialog") as HTMLDialogElement;
    assert.equal(dialog.hasAttribute("open"), true);
    assert.equal(posts.length, 0);
    await eventually(() => assert.equal(preflights.length, 1));
    assert.equal(((browser.document.querySelector("#setupForm") as HTMLFormElement).elements.namedItem("reviewed") as HTMLInputElement).disabled, false);
    assert.match(browser.document.querySelector("#setupPreflight")?.textContent ?? "", /Ready for your review/);
    assert.match(browser.document.querySelector("#setupPreflight")?.textContent ?? "", /No purchase plan was saved/);
    assert.match(browser.document.querySelector("#setupProductSummary")?.textContent ?? "", /95280900/);
    assert.match(browser.document.querySelector("#setupProductSummary")?.textContent ?? "", /\$7\.98/);
    assert.match(browser.document.querySelector("#setupReviewRows")?.textContent ?? "", /Notify me only/);

    const form = browser.document.querySelector("#setupForm") as HTMLFormElement;
    const quantity = form.elements.namedItem("targetQuantity") as HTMLInputElement;
    const maxUnit = form.elements.namedItem("maxUnitPrice") as HTMLInputElement;
    const maxAllIn = form.elements.namedItem("maxAllIn") as HTMLInputElement;
    const fulfillment = form.elements.namedItem("fulfillment") as HTMLSelectElement;
    const add = form.querySelector('input[value="add_to_cart"]') as HTMLInputElement;
    const reviewed = form.elements.namedItem("reviewed") as HTMLInputElement;
    assert.equal(fulfillment.value, "shipping");
    assert.deepEqual([...fulfillment.options].map((option) => option.value), ["shipping", "pickup", "manual"]);
    quantity.value = "2";
    maxUnit.value = "10.00";
    maxAllIn.value = "20.00";
    fulfillment.value = "pickup";
    add.checked = true;
    add.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal(fulfillment.value, "pickup");
    assert.equal(fulfillment.disabled, false);
    assert.equal(reviewed.disabled, true);
    assert.equal(reviewed.checked, false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await eventually(() => assert.equal(preflights.length, 2));
    assert.deepEqual(preflights[1], {
      contractVersion: 2,
      listingId: "listing_dashboard_test",
      targetQuantity: 2,
      maxUnitPriceCents: 1000,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "pickup",
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: 900,
      confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN"
    });
    assert.equal(reviewed.disabled, false);
    reviewed.checked = true;
    reviewed.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal((browser.document.querySelector("#createPlanButton") as HTMLButtonElement).disabled, false);
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], {
      contractVersion: 2,
      listingId: "listing_dashboard_test",
      targetQuantity: 2,
      maxUnitPriceCents: 1000,
      maxAllInCents: 2000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "pickup",
      substitutionPolicy: "exact_only",
      expiresAt: "",
      cooldownSeconds: 900,
      preflightFingerprint: "a".repeat(64),
      preflightedAt: "2026-08-25T18:00:00.000Z",
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    });
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /checkout stays manual/));

    await eventually(() => assert.ok(browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]')));
    assert.match(browser.document.querySelector("#planList")?.textContent ?? "", /Target guarded add is not qualified yet/);
    assert.match(browser.document.querySelector("#planList")?.textContent ?? "", /Guarded cart attempts add exactly one item and preserve existing cart quantities/);
    assert.match(browser.document.querySelector("#planList")?.textContent ?? "", /Qualified store lane/);
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    const editDialog = browser.document.querySelector("#planDialog") as HTMLDialogElement;
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    const targetOutbound = new URL((browser.document.querySelector("#targetEditors a.canonical") as HTMLAnchorElement).href);
    assert.equal(targetOutbound.origin, "https://howl.link");
    assert.equal(targetOutbound.searchParams.get("url"), product.canonicalUrl);
    assert.equal(targetOutbound.searchParams.get("publisher_slug"), "collectwithdodo");
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
    planDetail.targets.push({
      id: "mission_target_monitor_only",
      listingId: "listing_monitor_only",
      retailerId: "amazon",
      retailerName: "Amazon",
      retailerSku: "B0MONITOR1",
      canonicalUrl: "https://www.amazon.com/dp/B0MONITOR1",
      executionSupported: false,
      enabled: true,
      maxUnitPriceCents: 1200,
      sellerPolicy: "inherit",
      fulfillment: "inherit",
      currency: "USD",
      lastObservedPriceCents: 1200
    });
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    assert.equal((editForm.elements.namedItem("actionCeiling") as HTMLSelectElement).value, "notify");
    assert.match(browser.document.querySelector("#planModeCopy")?.textContent ?? "", /converts it to a reviewed direct plan/i);
    const preparedTarget = browser.document.querySelector('[data-target-id="mission_target_dashboard_test"]') as HTMLElement;
    (preparedTarget.querySelector('[data-field="fulfillment"]') as HTMLSelectElement).value = "pickup";
    (browser.document.querySelector("#prepareGuardedPlanButton") as HTMLButtonElement).click();
    assert.equal((editForm.elements.namedItem("actionCeiling") as HTMLSelectElement).value, "add_to_cart");
    assert.equal((preparedTarget.querySelector('[data-field="sellerPolicy"]') as HTMLSelectElement).value, "first_party_only");
    assert.equal((preparedTarget.querySelector('[data-field="fulfillment"]') as HTMLSelectElement).value, "pickup");
    const monitorOnlyTarget = browser.document.querySelector('[data-target-id="mission_target_monitor_only"]') as HTMLElement;
    assert.equal((monitorOnlyTarget.querySelector('[data-field="enabled"]') as HTMLInputElement).checked, false);
    assert.equal((monitorOnlyTarget.querySelector('[data-field="enabled"]') as HTMLInputElement).disabled, true);
    assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /explicit Pickup choice was retained/);
    editDialog.close();

    assert.equal(editForm.querySelector('option[value="archived"]'), null);
    (browser.document.querySelector('[data-edit-plan="mission_dashboard_test"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), true));
    (browser.document.querySelector("#deletePlanButton") as HTMLButtonElement).click();
    await eventually(() => assert.equal(deletions.length, 1));
    assert.deepEqual(deletions[0], { confirmation: "DELETE_PURCHASE_PLAN" });
    await eventually(() => assert.equal(editDialog.hasAttribute("open"), false));
    await eventually(() => assert.match(browser.document.querySelector("#planList")?.textContent ?? "", /no purchase plans/i));
    assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /purchase plan deleted/i);
  } finally {
    browser.close();
  }
});

test("the user dashboard reviews quarantined store details with closed, revocable decisions", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const reviews: Array<{ path: string; body: Record<string, unknown> }> = [];
  const evidence = {
    id: "observer_recipe_recovery_dashboard",
    retailerId: "pokemoncenter",
    retailerSku: "10-10320-101",
    field: "unitPrice",
    valueKind: "cents",
    normalizedValue: 798,
    reviewState: "unreviewed",
    reviewSequence: 0,
    confirmableByCurrentUser: true,
    applicationState: "not_applied",
    contributorEligibilityState: "externally_attested",
    retentionExpiresAt: "2026-11-23T12:00:00.000Z"
  };
  const overview = {
    settings: { actionsPaused: true, executionMode: "shadow", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 0, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
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
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (options.method === "POST" && path.includes("/community/recovery-evidence/")) {
        const body = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        reviews.push({ path, body });
        evidence.reviewState = String(body.decision);
        evidence.reviewSequence += 1;
        return { ok: true, status: 200, json: async () => ({ review: {
          disposition: "recorded",
          applicationAffected: false,
          fieldFillApplied: false,
          evidence: { ...evidence }
        } }) };
      }
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => overview };
      if (path === "/api/v1/user/community/recovery-evidence") {
        return { ok: true, status: 200, json: async () => ({
          items: [{ ...evidence }],
          retention: {
            policyVersion: "observer_recipe_recovery_retention_v1",
            retentionDays: 90,
            activityResetsExpiry: true,
            receiptCount: 0,
            applicationAffected: false,
            fieldFillEnabled: false
          },
          contributorEligibility: {
            policyVersion: "observer_recipe_contributor_eligibility_v1",
            externallyAttestedDeviceCount: 1,
            localAccountsCountAsPublicIndependentAccounts: false
          },
          reviewAffectsApplication: false,
          fieldFillEnabled: false
        }) };
      }
      if (path === "/api/v1/user/privacy") return { ok: true, status: 200, json: async () => ({ inventory: {
        totalRecords: 1,
        credentialMaterialsExcluded: true,
        categories: []
      } }) };
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });

  try {
    browser.eval(`${script}\n//# sourceURL=user-recovery-review-dashboard-test.js`);
    await eventually(() => assert.match(browser.document.querySelector("#recoveryReviewList")?.textContent ?? "", /\$7\.98/));
    assert.match(browser.document.querySelector("#recoveryReviewList")?.textContent ?? "", /Pokémon Center item 10-10320-101/);
    assert.match(browser.document.querySelector("#recoveryReviewList")?.textContent ?? "", /never applied/i);
    assert.match(browser.document.querySelector("#recoveryReviewList")?.textContent ?? "", /Automatically removed/i);
    assert.match(browser.document.querySelector("#recoveryReviewList")?.textContent ?? "", /Hosted account \+ coarse region checked/i);
    assert.match(browser.document.querySelector("#recoveryReviewSummary")?.textContent ?? "", /90 inactive days/i);
    assert.match(browser.document.querySelector("#recoveryReviewSummary")?.textContent ?? "", /verified 1 Chrome companion/i);
    (browser.document.querySelector('[data-recovery-decision="rejected"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(reviews.length, 1));
    assert.deepEqual(reviews[0], {
      path: "/api/v1/user/community/recovery-evidence/observer_recipe_recovery_dashboard/review",
      body: {
        contractVersion: 1,
        decision: "rejected",
        confirmation: "REJECT_NORMALIZED_RECOVERY_EVIDENCE"
      }
    });
    assert.equal("normalizedValue" in reviews[0]!.body, false);
    await eventually(() => assert.match(browser.document.querySelector("#recoveryReviewList")?.textContent ?? "", /marked this incorrect/i));

    (browser.document.querySelector('[data-recovery-decision="confirmed"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(reviews.length, 2));
    assert.deepEqual(reviews[1]?.body, {
      contractVersion: 1,
      decision: "confirmed",
      confirmation: "CONFIRM_NORMALIZED_RECOVERY_EVIDENCE"
    });
    await eventually(() => assert.match(browser.document.querySelector("#recoveryReviewList")?.textContent ?? "", /marked this correct/i));

    (browser.document.querySelector('[data-recovery-decision="revoked"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(reviews.length, 3));
    assert.deepEqual(reviews[2]?.body, {
      contractVersion: 1,
      decision: "revoked",
      confirmation: "REVOKE_NORMALIZED_RECOVERY_CONFIRMATION"
    });
    await eventually(() => assert.match(browser.document.querySelector("#recoveryReviewList")?.textContent ?? "", /confirmation withdrawn/i));
    assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /quarantined and unused/i);
  } finally {
    browser.close();
  }
});

test("quick add creates one defaulted plan through server preflight without opening the setup dialog", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const preflights: Array<Record<string, unknown>> = [];
  const posts: Array<Record<string, unknown>> = [];
  const listing = {
    listingId: "listing_quick_add_test",
    retailerId: "target",
    retailerName: "Target",
    retailerSku: "95280901",
    canonicalUrl: "https://www.target.com/p/-/A-95280901",
    status: "in_stock",
    executionSupported: true,
    msrpCents: 2495,
    currency: "USD",
    currentPriceCents: 1298,
    priceObservedAt: "2026-08-25T17:30:00.000Z",
    updatedAt: "2026-08-25T17:30:00.000Z"
  };
  const group = {
    variantId: "variant_quick_add_test",
    familyId: "family_quick_add_test",
    title: "Quick Add Fixture",
    brand: "",
    imageUrl: "",
    variantAttributes: {},
    createdAt: "2026-08-25T17:00:00.000Z",
    storeCount: 1,
    listingCount: 1,
    availableListingCount: 1,
    bestPriceCents: 1298,
    currency: "USD",
    lastActivityAt: "2026-08-25T17:30:00.000Z",
    listings: [listing]
  };
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path === "/api/v1/user/purchase-intents/preflight" && options.method === "POST") {
        const requested = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        preflights.push(requested);
        const itemSubtotalCapCents = Number(requested.targetQuantity) * Number(requested.maxUnitPriceCents);
        return { ok: true, status: 200, json: async () => ({ preflight: {
          contractVersion: 1,
          noPurchasePlanSaved: true,
          draft: {
            listingId: requested.listingId,
            targetQuantity: requested.targetQuantity,
            maxUnitPriceCents: requested.maxUnitPriceCents,
            maxAllInCents: itemSubtotalCapCents,
            actionCeiling: requested.actionCeiling,
            sellerPolicy: requested.sellerPolicy,
            fulfillment: requested.fulfillment,
            substitutionPolicy: requested.substitutionPolicy,
            expiresAt: requested.expiresAt ?? "",
            cooldownSeconds: requested.cooldownSeconds
          },
          cost: { currency: "USD", itemSubtotalCapCents, minimumAllInCents: itemSubtotalCapCents, reviewedAllInCents: itemSubtotalCapCents, headroomCents: 0, autoRaised: false },
          preflightFingerprint: "b".repeat(64),
          preflightedAt: "2026-08-25T18:00:00.000Z",
          validUntil: "2026-08-25T18:05:00.000Z",
          validForSeconds: 300
        } }) };
      }
      if (path === "/api/v1/user/purchase-intents" && options.method === "POST") {
        posts.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        return { ok: true, status: 201, json: async () => ({ created: true, purchaseIntent: {} }) };
      }
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => ({
        settings: { actionsPaused: false, executionMode: "shadow", taxBps: 0, storeAllowancesCents: {} },
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
      }) };
      if (path.startsWith("/api/v1/user/library")) return { ok: true, status: 200, json: async () => ({ items: [group], total: 1 }) };
      if (path === "/api/v1/user/privacy") return { ok: true, status: 200, json: async () => ({ inventory: {
        totalRecords: 1, credentialMaterialsExcluded: true, categories: []
      } }) };
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
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
    browser.eval(`${script}\n//# sourceURL=user-dashboard-quick-add-test.js`);
    await eventually(() => assert.ok(browser.document.querySelector("[data-quick-add]")));
    assert.equal(browser.document.querySelector("[data-quick-menu]"), null, "no profile caret renders before any profile is saved");
    (browser.document.querySelector("[data-quick-add]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(posts.length, 1));
    assert.equal((browser.document.querySelector("#setupDialog") as HTMLDialogElement).hasAttribute("open"), false);
    assert.ok(preflights.length >= 1);
    assert.equal(preflights[0]?.confirmation, "PREFLIGHT_EXACT_PURCHASE_PLAN");
    const created = posts[0] ?? {};
    assert.equal(created.contractVersion, 2);
    assert.equal(created.listingId, "listing_quick_add_test");
    assert.equal(created.targetQuantity, 1);
    assert.equal(created.maxUnitPriceCents, 1298, "the default profile caps at the current store price");
    assert.equal(created.maxAllInCents, 1298);
    assert.equal(created.actionCeiling, "notify", "the built-in default stays notification-only");
    assert.equal(created.sellerPolicy, "first_party_only");
    assert.equal(created.fulfillment, "shipping");
    assert.equal(created.confirmation, "CREATE_EXACT_PURCHASE_PLAN");
    assert.equal(created.preflightFingerprint, "b".repeat(64));
    assert.equal(created.preflightedAt, "2026-08-25T18:00:00.000Z");
  } finally {
    browser.close();
  }
});

test("Calls combines source feedback, queue-open facts, affiliate routing, and profile-based bulk quick add", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const html = readFileSync(join(webRoot, "user.html"), "utf8");
  const script = readFileSync(join(webRoot, "user.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:32991/#calls",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const createdListingIds = new Set<string>();
  const preflights: Array<Record<string, unknown>> = [];
  const posts: Array<Record<string, unknown>> = [];
  const feedback: Array<Record<string, unknown>> = [];
  const watchModeUpdates: Array<Record<string, unknown>> = [];
  let falsePositiveReported = false;
  let watchQueueMode = "auto_armed";
  let workerRestarts = 0;
  const profile = {
    id: "profile_calls_fixture",
    name: "Guarded shipping",
    isDefault: false,
    targetQuantity: 2,
    priceMode: "fixed_cap",
    maxUnitPriceCents: 2500,
    msrpOffsetPercent: null,
    actionCeiling: "add_to_cart",
    cooldownSeconds: 120
  };
  const listings = [
    {
      variantId: "variant_calls_signal",
      listingId: "listing_calls_signal",
      retailerId: "target",
      retailerName: "Target",
      retailerSku: "94972381",
      canonicalUrl: "https://www.target.com/p/-/A-94972381",
      currentPriceCents: 1999
    },
    {
      variantId: "variant_calls_queue",
      listingId: "listing_calls_queue",
      retailerId: "walmart",
      retailerName: "Walmart",
      retailerSku: "20252562938",
      canonicalUrl: "https://www.walmart.com/ip/20252562938",
      currentPriceCents: 2497
    }
  ].map((item) => ({
    ...item,
    status: "in_stock",
    executionSupported: true,
    msrpCents: 2999,
    currency: "USD",
    priceObservedAt: "2026-08-30T08:00:00.000Z",
    updatedAt: "2026-08-30T08:00:00.000Z"
  }));
  const groups = listings.map((listing) => ({
    variantId: listing.variantId,
    familyId: `family_${listing.variantId}`,
    title: listing.retailerId === "target" ? "Signal fixture" : "Queue fixture",
    brand: "",
    imageUrl: "",
    variantAttributes: {},
    createdAt: "2026-08-30T07:00:00.000Z",
    storeCount: 1,
    listingCount: 1,
    availableListingCount: 1,
    bestPriceCents: listing.currentPriceCents,
    currency: "USD",
    lastActivityAt: "2026-08-30T08:00:00.000Z",
    listings: [listing]
  }));
  const calls = () => [{
    id: "signal:signal_calls_fixture",
    kind: "signal",
    listingId: listings[0]!.listingId,
    retailerId: "target",
    retailerSku: "94972381",
    canonicalUrl: listings[0]!.canonicalUrl,
    title: "Signal fixture",
    occurredAt: "2026-08-30T08:00:00.000Z",
    status: "in_stock",
    unitPriceCents: 1999,
    currency: "USD",
    source: "Collector alerts",
    sourceChannelId: "provider_channel_calls_fixture",
    falsePositiveReported
  }, {
    id: "drop:drop_window_item_calls_fixture",
    kind: "queue_open",
    listingId: listings[1]!.listingId,
    retailerId: "walmart",
    retailerSku: "20252562938",
    canonicalUrl: listings[1]!.canonicalUrl,
    title: "Queue fixture",
    occurredAt: "2026-08-30T09:00:00.000Z",
    status: "scheduled",
    unitPriceCents: null,
    currency: "USD",
    source: "drop_window",
    dropWindowItemId: "drop_window_item_calls_fixture",
    startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    closesAt: "2026-08-30T12:00:00.000Z",
    earlyAccess: { membership: "Walmart+", queueExpected: true },
    watch: {
      id: "watch_item_calls_fixture",
      state: "queued",
      enrollment: "auto_armed",
      observationStartsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      observationClosesAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      observationCount: 1,
      lastAvailability: "out_of_stock",
      lastObservedAt: new Date(Date.now() - 60_000).toISOString(),
      readiness: { readOnly: true, reasonCode: "read_only_observation" }
    }
  }];
  const overview = {
    settings: { actionsPaused: false, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 2, purchaseIntents: createdListingIds.size, actions: 0, pendingCatalogProposals: 0 },
    sources: [],
    permissions: ["worker.manage"],
    spend: {
      activeReservationCount: 0,
      activeReservedCents: 0,
      spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] }
  };
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => true });
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (path: string, options: { method?: string; body?: string } = {}) => {
      if (path === "/api/v1/affiliate-routing") {
        return { ok: true, status: 200, json: async () => ({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE }) };
      }
      if (path === "/api/v1/user/source-feedback/false-positive" && options.method === "POST") {
        feedback.push(JSON.parse(String(options.body || "{}")) as Record<string, unknown>);
        falsePositiveReported = true;
        return { ok: true, status: 200, json: async () => ({ recorded: true }) };
      }
      if (path === "/api/v1/user/watch-queue/settings" && options.method === "PATCH") {
        const requested = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        watchModeUpdates.push(requested);
        watchQueueMode = requested.mode === "auto_armed" ? "auto_armed" : "manual";
        return { ok: true, status: 200, json: async () => ({ watchQueue: {
          mode: watchQueueMode,
          previousMode: watchQueueMode === "manual" ? "auto_armed" : "manual",
          newlyEnrolledCount: 0
        } }) };
      }
      if (path === "/api/v1/admin/workers/restart" && options.method === "POST") {
        workerRestarts += 1;
        return { ok: true, status: 200, json: async () => ({ restarted: true }) };
      }
      if (path === "/api/v1/user/purchase-intents/preflight" && options.method === "POST") {
        const requested = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        preflights.push(requested);
        return { ok: true, status: 200, json: async () => ({ preflight: {
          contractVersion: 1,
          noPurchasePlanSaved: true,
          draft: { ...requested },
          preflightFingerprint: "c".repeat(64),
          preflightedAt: "2026-08-30T08:01:00.000Z"
        } }) };
      }
      if (path === "/api/v1/user/purchase-intents" && options.method === "POST") {
        const requested = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
        posts.push(requested);
        createdListingIds.add(String(requested.listingId));
        return { ok: true, status: 201, json: async () => ({ created: true, purchaseIntent: {} }) };
      }
      if (path === "/api/v1/user/overview") return { ok: true, status: 200, json: async () => overview };
      if (path.startsWith("/api/v1/user/library/products")) {
        return { ok: true, status: 200, json: async () => ({ items: groups, total: groups.length }) };
      }
      if (path === "/api/v1/user/purchase-intents?limit=200&offset=0") {
        return { ok: true, status: 200, json: async () => ({ items: listings
          .filter((listing) => createdListingIds.has(listing.listingId))
          .map((listing) => ({ id: `mission_${listing.listingId}`, variantId: listing.variantId })) }) };
      }
      if (path === "/api/v1/user/purchase-profiles") {
        return { ok: true, status: 200, json: async () => ({ items: [profile] }) };
      }
      if (path === "/api/v1/user/calls") {
        return { ok: true, status: 200, json: async () => ({ items: calls() }) };
      }
      if (path === "/api/v1/user/action-platform") {
        return { ok: true, status: 200, json: async () => ({
          watchQueueMode,
          readiness: [],
          connectors: [],
          connectorDeliveries: [],
          sources: [],
          orderConfirmations: [],
          analytics: { funnel: {}, spend: {}, retailers: [] }
        }) };
      }
      if (path === "/api/v1/user/health") return { ok: true, status: 200, json: async () => ({
        contractVersion: 1,
        generatedAt: "2026-08-30T08:02:00.000Z",
        version: "calls-health-fixture",
        worker: { state: "running", healthy: true, lastHeartbeatAt: "2026-08-30T08:01:59.000Z" },
        counts: { onlineDevices: 1, watchQueue: 1, sourceAttention: 0, connectorFailures: 0 },
        readiness: [],
        sources: [],
        connectors: [],
        diagnosticBundle: {
          containsSecrets: false,
          containsUrls: false,
          containsDom: false,
          containsAccountOrPaymentData: false,
          workerState: "running",
          workerErrorCode: "",
          deviceStates: []
        }
      }) };
      if (path === "/api/v1/user/privacy") return { ok: true, status: 200, json: async () => ({ inventory: {
        totalRecords: 0, credentialMaterialsExcluded: true, categories: []
      } }) };
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });

  try {
    browser.eval(`${script}\n//# sourceURL=user-dashboard-calls-test.js`);
    await eventually(() => assert.equal(browser.document.querySelectorAll("[data-call-select]").length, 2));
    const callText = browser.document.querySelector("#callList")?.textContent ?? "";
    assert.match(callText, /Queue open/);
    assert.match(callText, /Walmart\+/);
    assert.match(callText, /Queue Expected/);
    assert.match(callText, /Observation remains read-only/);
    assert.match(callText, /Read-only checks start/);
    assert.match(callText, /Auto-enrolled from armed plan/);
    assert.match(callText, /1 check · Out Of Stock/);
    const watchMode = browser.document.querySelector("#watchQueueMode") as HTMLSelectElement;
    assert.equal(watchMode.value, "auto_armed");
    const outbound = new URL((browser.document.querySelector("#callList a.canonical") as HTMLAnchorElement).href);
    assert.equal(outbound.origin, "https://howl.link");
    assert.equal(outbound.searchParams.get("publisher_slug"), "collectwithdodo");
    assert.match(browser.document.querySelector("#healthSummary")?.textContent ?? "", /1 companion online · worker healthy/);
    assert.match(browser.document.querySelector("#healthDetails")?.textContent ?? "", /calls-health-fixture/);
    assert.equal((browser.document.querySelector("#restartWorker") as HTMLButtonElement).hidden, false);

    watchMode.value = "manual";
    watchMode.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await eventually(() => assert.equal(watchModeUpdates.length, 1));
    assert.deepEqual(watchModeUpdates[0], {
      mode: "manual",
      confirmation: "SET_WATCH_QUEUE_MODE"
    });
    await eventually(() => assert.equal(watchMode.value, "manual"));

    (browser.document.querySelector("[data-false-positive]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(feedback.length, 1));
    assert.deepEqual(feedback[0], {
      channelId: "provider_channel_calls_fixture",
      signalId: "signal_calls_fixture",
      confirmation: "REPORT_FALSE_POSITIVE"
    });
    await eventually(() => assert.match(browser.document.querySelector("#callList")?.textContent ?? "", /False positive reported/));

    const selections = [...browser.document.querySelectorAll("[data-call-select]")] as HTMLInputElement[];
    for (const input of selections) input.checked = true;
    selections[0]!.dispatchEvent(new browser.Event("change", { bubbles: true }));
    const profileSelect = browser.document.querySelector("#callBulkProfile") as HTMLSelectElement;
    profileSelect.value = profile.id;
    const bulk = browser.document.querySelector("#callBulkAdd") as HTMLButtonElement;
    assert.equal(bulk.disabled, false);
    bulk.click();
    await eventually(() => assert.equal(posts.length, 2));
    assert.deepEqual(preflights.map((item) => item.listingId).sort(), [
      "listing_calls_queue", "listing_calls_signal"
    ]);
    for (const created of posts) {
      assert.equal(created.quickAddProfileId, profile.id);
      assert.equal(created.targetQuantity, 2);
      assert.equal(created.maxUnitPriceCents, 2500);
      assert.equal(created.maxAllInCents, 5000);
      assert.equal(created.actionCeiling, "add_to_cart");
      assert.equal(created.fulfillment, "shipping");
      assert.equal(created.confirmation, "CREATE_EXACT_PURCHASE_PLAN");
    }
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /2 exact products added/));
    await eventually(() => assert.equal(browser.document.querySelectorAll("#callList .tag.good").length >= 2, true));
    (browser.document.querySelector("#restartWorker") as HTMLButtonElement).click();
    await eventually(() => assert.equal(workerRestarts, 1));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Background worker restarted/));
  } finally {
    browser.close();
  }
});
