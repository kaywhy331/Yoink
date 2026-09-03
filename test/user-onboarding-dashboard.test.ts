import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
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
  registeredRetailerDomains: ["amazon.com", "target.com", "walmart.com", "bestbuy.com"]
};
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 60): Promise<void> {
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

test("nontechnical onboarding pairs Chrome, verifies an exact link, and keeps hosted resume pending", async () => {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  let proposals: Array<Record<string, unknown>> = [];
  let libraryItems: Array<Record<string, unknown>> = [];
  const setupSteps = [
    {
      id: "companion", title: "Install and pair Chrome", state: "current",
      summary: "Install the Chrome companion, then pair it with a one-time code.",
      primaryAction: "download_companion", primaryActionLabel: "Download companion",
      secondaryAction: "pair_companion", secondaryActionLabel: "Create pairing code"
    },
    {
      id: "signal", title: "Connect a product signal", state: "waiting", summary: "Connect TrackaLacker.",
      primaryAction: "connect_signal", primaryActionLabel: "Show connection help", secondaryAction: null, secondaryActionLabel: ""
    },
    {
      id: "product", title: "Choose an exact product", state: "waiting", summary: "Paste an exact page.",
      primaryAction: "add_product", primaryActionLabel: "Add product link", secondaryAction: null, secondaryActionLabel: ""
    },
    {
      id: "plan", title: "Set your price and action", state: "waiting", summary: "Set bounded preferences.",
      primaryAction: "choose_product", primaryActionLabel: "Choose a product", secondaryAction: null, secondaryActionLabel: ""
    },
    {
      id: "action", title: "Review the safety boundary", state: "waiting",
      summary: "Checkout, payment, raffle entry, and order submission always remain manual.",
      primaryAction: null, primaryActionLabel: "", secondaryAction: null, secondaryActionLabel: ""
    }
  ];
  const overview = {
    settings: { actionsPaused: true, executionMode: "live", taxBps: 0, storeAllowancesCents: {} },
    counts: { products: 0, purchaseIntents: 0, actions: 0, pendingCatalogProposals: 0 },
    sources: [], permissions: [],
    spend: {
      activeReservationCount: 0, activeReservedCents: 0, spentTodayCents: 0,
      policy: { revision: 1, perOrderCapCents: null, dailyCapCents: null, monthlyCapCents: null }
    },
    walmartDraws: { latestScan: null, items: [] },
    setup: {
      level: "needs_companion", headline: "Start with the Chrome companion",
      summary: "This keeps every qualified click inside your browser.", completedSteps: 0, totalSteps: 5,
      companion: { downloadUrl: "/api/v1/extension/release/download" }, steps: setupSteps
    }
  };
  const response = (payload: Record<string, unknown>, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  });
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (pathValue: string, options: { method?: string; body?: string } = {}) => {
      const path = String(pathValue);
      const method = options.method || "GET";
      const body = options.body ? JSON.parse(options.body) as Record<string, unknown> : {};
      if (method !== "GET") requests.push({ path, method, body });
      if (path === "/api/v1/affiliate-routing") return response({ affiliateRouting: AFFILIATE_ROUTING_FIXTURE });
      if (path === "/api/v1/user/devices/pairing-code" && method === "POST") {
        return response({ pairing: { code: "ABCD-EFGH", expiresAt: new Date(Date.now() + 300_000).toISOString() } }, 201);
      }
      if (path === "/api/v1/user/catalog/link-preview" && method === "POST") {
        return response({ preview: {
          retailerId: "amazon", retailerName: "Amazon", retailerSku: "B0DCGQ6CJD",
          canonicalUrl: "https://www.amazon.com/dp/B0DCGQ6CJD", postReviewCapability: "monitor_only",
          capabilityLabel: "Monitoring and notifications only unless the guarded lane is qualified later."
        } });
      }
      if (path === "/api/v1/user/catalog/link-proposals" && method === "POST") {
        proposals = [{
          id: "catalog_proposal_onboarding", status: "pending", retailerId: "amazon",
          payload: { title: body.title, retailerSku: "B0DCGQ6CJD" }
        }];
        return response({ disposition: "created", proposal: proposals[0] as Record<string, unknown> }, 202);
      }
      if (path === "/api/v1/user/settings/actions" && method === "PATCH") {
        return response({ disposition: "pending_approval", changeRequest: { id: "admin_change_resume" } }, 202);
      }
      if (path === "/api/v1/user/overview") return response(overview);
      if (path === "/api/v1/user/privacy") return response({ inventory: {
        totalRecords: 8,
        credentialMaterialsExcluded: true,
        categories: [{ id: "account_and_access", label: "Account and access", recordCount: 8 }]
      } });
      if (path === "/api/v1/user/community/recovery-evidence") return response({
        items: [],
        reviewAffectsApplication: false,
        fieldFillEnabled: false
      });
      if (path.startsWith("/api/v1/user/library")) return response({
        items: libraryItems,
        total: libraryItems.length,
        facets: { stores: libraryItems.length ? [{ retailerId: "target", retailerName: "Target", productCount: 1 }] : [] }
      });
      if (path.startsWith("/api/v1/user/purchase-intents")) return response({ items: [] });
      if (path.startsWith("/api/v1/user/jobs")) return response({ items: [] });
      if (path.startsWith("/api/v1/user/catalog/proposals")) return response({ items: proposals });
      throw new Error(`Unexpected dashboard request ${method} ${path}`);
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
    browser.eval(`${readFileSync(join(webRoot, "user.js"), "utf8")}\n//# sourceURL=user-onboarding-dashboard-test.js`);
    await eventually(() => assert.match(browser.document.querySelector("#homeHeadline")?.textContent ?? "", /Start with the Chrome companion/));
    assert.equal(browser.document.querySelectorAll("#heroState [data-home-setup]").length, 1);
    assert.match(browser.document.querySelector("#heroState")?.textContent ?? "", /Install and pair Chrome/);
    assert.match(browser.document.querySelector("#heroState")?.textContent ?? "", /Step 1 of 5/);
    assert.equal(browser.document.querySelector(".header-boundary")?.textContent?.trim(), "Checkout stays manual. Details");
    assert.doesNotMatch(browser.document.querySelector("#heroState")?.textContent ?? "", /checkout stays manual/i);
    assert.equal(browser.document.querySelector("#metrics"), null, "Home omits cumulative vanity counters");
    await eventually(() => assert.match(browser.document.querySelector("#homeRecentList")?.textContent ?? "", /No checkout outcomes yet/));
    assert.equal((browser.document.querySelector("#companionDownloadLink") as HTMLAnchorElement).pathname, "/api/v1/extension/release/download");
    assert.equal((browser.document.querySelector("#companionDownloadLink") as HTMLAnchorElement).hidden, false);
    overview.setup.companion.downloadUrl = "";
    await browser.eval("refresh()");
    await eventually(() => assert.equal((browser.document.querySelector("#companionDownloadLink") as HTMLAnchorElement).hidden, true));
    assert.match(browser.document.querySelector("#heroState")?.textContent ?? "", /installation is managed by your Yoink administrator/);
    assert.match(browser.document.querySelector("#privacySummary")?.textContent ?? "", /Checking/);

    (browser.document.querySelector('[data-setup-action="pair_companion"]') as HTMLButtonElement).click();
    await eventually(() => assert.match(browser.document.querySelector("#pairing")?.textContent ?? "", /ABCD-EFGH/));
    assert.equal(browser.document.querySelector('[data-panel="preferences"]')?.classList.contains("active"), true);
    assert.equal((browser.document.querySelector('[data-settings-panel="chrome"]') as HTMLElement).hidden, false);
    assert.equal(browser.document.querySelector('[data-settings-view="chrome"]')?.getAttribute("aria-pressed"), "true");
    assert.equal(browser.location.hash, "#settings/chrome");
    assert.equal(browser.document.activeElement?.id, "pairing");
    await eventually(() => assert.match(browser.document.querySelector("#privacySummary")?.textContent ?? "", /8 records/));
    assert.match(browser.document.querySelector("#privacyBoundary")?.textContent ?? "", /Chrome companion tokens.*excluded/s);

    setupSteps[0]!.state = "complete";
    setupSteps[1]!.state = "current";
    overview.setup.completedSteps = 1;
    overview.setup.headline = "Connect your product signals";
    (browser.document.querySelector('[data-tab="home"]') as HTMLButtonElement).click();
    await browser.eval("refresh()");
    await eventually(() => assert.match(browser.document.querySelector("#heroState")?.textContent ?? "", /Step 2 of 5/));
    (browser.document.querySelector('[data-setup-action="connect_signal"]') as HTMLButtonElement).click();
    const signalDialog = browser.document.querySelector("#signalConnectDialog") as HTMLDialogElement;
    assert.equal(signalDialog.hasAttribute("open"), true);
    assert.deepEqual(
      [...signalDialog.querySelectorAll(".dialog-steps li")].map((step) => step.textContent?.trim()),
      ["Pin the Chrome companion.", "Open its popup.", "Choose Reconnect."]
    );
    assert.doesNotMatch(signalDialog.textContent ?? "", /extension/i);
    assert.match(browser.document.querySelector("#signalConnectStatus")?.textContent ?? "", /Finish the three steps, then re-check\./);
    assert.equal(browser.document.querySelector("#recheckSignalConnection")?.textContent?.trim(), "Re-check");
    setupSteps[1]!.state = "complete";
    setupSteps[2]!.state = "current";
    overview.setup.completedSteps = 2;
    (browser.document.querySelector("#recheckSignalConnection") as HTMLButtonElement).click();
    await eventually(() => assert.equal(signalDialog.hasAttribute("open"), false));
    assert.match(browser.document.querySelector("#heroState")?.textContent ?? "", /Step 3 of 5/);

    (browser.document.querySelector("#addProductButton") as HTMLButtonElement).click();
    const dialog = browser.document.querySelector("#productLinkDialog") as HTMLDialogElement;
    assert.equal(dialog.hasAttribute("open"), true);
    const form = browser.document.querySelector("#productLinkForm") as HTMLFormElement;
    const url = form.elements.namedItem("url") as HTMLInputElement;
    const title = form.elements.namedItem("title") as HTMLInputElement;
    url.value = "https://www.amazon.com/Card-Game/dp/B0DCGQ6CJD/ref=tracking";
    url.dispatchEvent(new browser.Event("input", { bubbles: true }));
    title.value = "Card Game Family Travel Kids";
    (browser.document.querySelector("#checkProductLinkButton") as HTMLButtonElement).click();
    await eventually(() => assert.equal((browser.document.querySelector("#productLinkPreview") as HTMLElement).hidden, false));
    assert.match(browser.document.querySelector("#productLinkPreview")?.textContent ?? "", /Amazon.*B0DCGQ6CJD/s);
    assert.match(browser.document.querySelector("#productLinkPreview")?.textContent ?? "", /Not accepted.*stock status, price, seller, fulfillment, or permission to purchase/s);
    const previewOutbound = new URL((browser.document.querySelector("#productLinkPreview a.canonical") as HTMLAnchorElement).href);
    assert.equal(previewOutbound.href, "https://www.amazon.com/dp/B0DCGQ6CJD");
    assert.equal(previewOutbound.origin, "https://www.amazon.com");
    assert.doesNotMatch((browser.document.querySelector("#productLinkPreview a.canonical") as HTMLAnchorElement).rel, /\bsponsored\b/);
    const confirmed = form.elements.namedItem("confirmed") as HTMLInputElement;
    confirmed.checked = true;
    confirmed.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal((browser.document.querySelector("#submitProductLinkButton") as HTMLButtonElement).disabled, false);
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(dialog.hasAttribute("open"), false));
    const proposalRequest = requests.find((item) => item.path === "/api/v1/user/catalog/link-proposals");
    assert.deepEqual(proposalRequest?.body, {
      url: "https://www.amazon.com/Card-Game/dp/B0DCGQ6CJD/ref=tracking",
      title: "Card Game Family Travel Kids",
      confirmation: "PROPOSE_EXACT_PRODUCT_LINK"
    });
    assert.equal(requests.some((item) => item.path === "/api/v1/user/purchase-intents" && item.method === "POST"), false);
    assert.equal(browser.document.querySelector('[data-panel="products"]')?.classList.contains("active"), true);
    assert.equal((browser.document.querySelector("#productReviewStatus") as HTMLElement).hidden, false);
    assert.match(browser.document.querySelector("#productReviewStatus")?.textContent ?? "", /Card Game Family Travel Kids.*In review/s);
    assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /No stock claim, plan, or store action was created/);

    libraryItems = [{
      variantId: "variant_target_onboarding",
      title: "Target Card Game",
      currency: "USD",
      storeCount: 1,
      inStockListingCount: 1,
      preorderListingCount: 0,
      outOfStockListingCount: 0,
      listings: [{
        listingId: "listing_target_onboarding",
        retailerId: "target",
        retailerName: "Target",
        retailerSku: "94972381",
        canonicalUrl: "https://www.target.com/p/-/A-94972381",
        status: "in_stock",
        currentPriceCents: 3999,
        currency: "USD",
        executionSupported: true
      }]
    }];
    setupSteps[2]!.state = "complete";
    setupSteps[3]!.state = "current";
    overview.setup.completedSteps = 3;
    overview.counts.products = 1;
    proposals[0]!.status = "approved";
    proposals[0]!.appliedListingId = "listing_target_onboarding";
    await browser.eval("refresh()");
    await eventually(() => assert.match(browser.document.querySelector("#productReviewStatus")?.textContent ?? "", /Card Game Family Travel Kids.*Available in Products.*Approved/s));
    (browser.document.querySelector('[data-tab="home"]') as HTMLButtonElement).click();
    await browser.eval("refresh()");
    await eventually(() => assert.match(browser.document.querySelector("#heroState")?.textContent ?? "", /Step 4 of 5/));
    (browser.document.querySelector('[data-setup-action="choose_product"]') as HTMLButtonElement).click();
    await eventually(() => assert.equal(browser.document.activeElement?.textContent?.trim(), "Quick add"));
    assert.equal(browser.document.querySelector('[data-panel="products"]')?.classList.contains("active"), true);
    assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Choose “Quick add” to create your first plan/);

    (browser.document.querySelector("#pauseButton") as HTMLButtonElement).click();
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Resume request sent for independent approval/));
    assert.equal(browser.document.querySelector("#pauseButton")?.textContent, "Resume actions");
    assert.equal(overview.settings.actionsPaused, true);
  } finally {
    browser.close();
  }
});
