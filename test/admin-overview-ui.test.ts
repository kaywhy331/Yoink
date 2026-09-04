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

function snapshot(overrides: {
  actionsPaused?: boolean;
  onlineDevices?: number;
  trackalackerReady?: boolean;
  mappedProducts?: number;
  qualified?: boolean;
  active?: boolean;
  purchaseRule?: boolean;
} = {}): Record<string, unknown> {
  const qualified = overrides.qualified ?? true;
  const active = overrides.active ?? true;
  return {
    view: "overview",
    version: "admin-overview-ui-test",
    actor: {
      displayName: "Admin Fixture",
      userId: "user_admin_fixture",
      tenantName: "Fixture tenant",
      roleLabels: ["Tenant administrator"],
      assuranceLevel: "local_trusted",
      assuranceFresh: true,
      assuranceExpiresAt: "local_session",
      sessionKind: "local",
      signOutUrl: ""
    },
    settings: { actionsPaused: overrides.actionsPaused ?? false, executionMode: "live" },
    counts: {
      onlineDevices: overrides.onlineDevices ?? 1,
      pendingCatalogProposals: 2,
      pendingAdminChanges: 1,
      variants: 12,
      listings: 20,
      missions: 4,
      signals: 31,
      openIncidents: 2,
      actionJobs: 7,
      pendingNotifications: 1
    },
    overview: {
      generatedAt: "2026-09-01T12:00:00.000Z",
      windows: {
        hours24: { signalsReceived: 11, jobsCreated: 8, carted: 5, gotIt: 3, missed: 1, deadLetters: 1, routesIssued: 7, clicks: 5, conversions: 2 },
        days7: { signalsReceived: 70, jobsCreated: 45, carted: 21, gotIt: 14, missed: 5, deadLetters: 2, routesIssued: 36, clicks: 22, conversions: 9 }
      },
      waiting: { catalogProposals: 2, changeRequests: 1, incidents: 2 },
      devicesOnline: overrides.onlineDevices ?? 1
    },
    trackalacker: {
      ready: overrides.trackalackerReady ?? true,
      mappedProducts: overrides.mappedProducts ?? 12,
      candidateListings: 20
    },
    capabilities: {
      targetReadOnlyShadow: true,
      targetAddQualified: qualified,
      targetAddMutationAuthorized: active,
      walmartAddQualified: false,
      walmartAddMutationAuthorized: false,
      amazonAddQualified: false,
      amazonAddMutationAuthorized: false,
      bestBuyAddQualified: false,
      bestBuyAddMutationAuthorized: false
    },
    sources: [],
    strategies: overrides.purchaseRule === false ? [] : [{ enabled: true, action: "add_to_cart" }]
  };
}

async function renderOverview(model: Record<string, unknown>): Promise<{
  browser: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  requests: string[];
}> {
  const webRoot = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: "http://127.0.0.1:32991/admin#overview",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const requests: string[] = [];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: async (pathValue: string) => {
      const path = String(pathValue);
      requests.push(path);
      const payload = path === "/api/v1/admin/snapshot?view=overview"
        ? model
        : path === "/api/v1/user/signals?limit=4&offset=0"
          ? { items: [], total: 0 }
          : {};
      return { ok: true, status: 200, json: async () => payload };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => { throw new Error("Native confirm must not run."); } });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: true, note: "" }) }
  });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
  await eventually(() => assert.doesNotMatch(
    browser.document.querySelector("#overviewHeadline")?.textContent ?? "",
    /Checking/
  ));
  return { browser, requests };
}

test("Admin Overview reduces healthy, paused, and setup-needed state to one priority surface", async () => {
  const healthy = await renderOverview(snapshot());
  try {
    assert.match(healthy.browser.document.querySelector("#overviewHeadline")?.textContent ?? "", /ready for guarded adds/i);
    assert.match(healthy.browser.document.querySelector("#heroStatus")?.textContent ?? "", /Ready/);
    assert.equal(healthy.browser.document.querySelectorAll("#heroStatus .hero-status-row").length, 3);
    assert.equal(healthy.browser.document.querySelectorAll("#metricGrid .metric").length, 6);
    assert.match(healthy.browser.document.querySelector("#metricGrid")?.textContent ?? "", /Calls11Last 24 hours/);
    assert.match(healthy.browser.document.querySelector("#overviewAttributionStrip")?.textContent ?? "", /7 routes.*5 clicks.*2 conversions.*View analytics/);
    assert.equal(healthy.browser.document.querySelector("#overviewAttributionStrip")?.getAttribute("aria-label"), "Attribution in the last 24 hours");
    assert.equal(healthy.browser.document.querySelector("#metricGrid")?.getAttribute("aria-label"), "Activity in the last 24 hours");
    (healthy.browser.document.querySelector('[data-overview-window="days7"]') as HTMLButtonElement).click();
    assert.match(healthy.browser.document.querySelector("#metricGrid")?.textContent ?? "", /Calls70Last 7 days/);
    assert.match(healthy.browser.document.querySelector("#overviewAttributionStrip")?.textContent ?? "", /36 routes.*22 clicks.*9 conversions/);
    assert.equal(healthy.browser.document.querySelector("#metricGrid")?.getAttribute("aria-label"), "Activity in the last 7 days");
    assert.equal((healthy.browser.document.querySelector('[data-overview-window="days7"]') as HTMLButtonElement).getAttribute("aria-pressed"), "true");
    assert.equal((healthy.browser.document.querySelector("#overviewReviewPanel") as HTMLElement).hidden, false);
    assert.equal(healthy.browser.document.querySelectorAll("#overviewReviewList [data-open-view]").length, 3);
    assert.match(healthy.browser.document.querySelector("#overviewReviewList")?.textContent ?? "", /Catalog reviews2Open Catalog reviews/);
    assert.match(healthy.browser.document.querySelector("#overviewReviewList")?.textContent ?? "", /Approvals1Open Approvals/);
    assert.doesNotMatch(healthy.browser.document.querySelector("#overviewReviewList")?.textContent ?? "", /Protected changes|Review(?!s)/);
    assert.equal(healthy.browser.document.querySelector("#heroStatus .text-button")?.textContent, "Open Stores",
      "the hero link names its destination even when setup is complete");
    assert.equal((healthy.browser.document.querySelector("#readinessPanel") as HTMLElement).hidden, true);
    assert.equal(healthy.browser.document.querySelector("#safetyBanner"), null);
    const callsLink = healthy.browser.document.querySelector('#view-overview [data-open-view="signals"]') as HTMLButtonElement;
    const sourcesLink = healthy.browser.document.querySelector('#view-overview [data-open-view="sources"].full') as HTMLButtonElement;
    assert.equal(callsLink.textContent?.trim(), "Open Calls");
    assert.equal(healthy.browser.document.querySelector('#view-signals h1')?.textContent?.trim(), "Calls");
    assert.equal(sourcesLink.textContent?.trim(), "Open Sources");
    assert.equal(healthy.browser.document.querySelector('#view-connections h1')?.textContent?.trim(), "Sources");
    assert.equal(healthy.browser.document.querySelector("#adminAccountName")?.textContent, "Admin Fixture");
    assert.equal(healthy.browser.document.querySelector("#adminAccountRole")?.textContent, "Tenant administrator");
    assert.equal(healthy.browser.document.querySelector("#adminAccountSession")?.textContent, "Local session");
    assert.equal((healthy.browser.document.querySelector("#adminSignOutLink") as HTMLElement).hidden, true);
    assert.equal(healthy.browser.document.querySelector("#actionsToggle")?.textContent, "Pause all actions");
    assert.equal(healthy.browser.document.querySelector("#modeChip")?.textContent, "Running");
    assert.equal((healthy.browser.document.querySelector("#actionsToggleReason") as HTMLElement).hidden, true);
    assert.doesNotMatch(healthy.browser.document.querySelector("#heroStatus")?.textContent ?? "", /Local control plane|Target add-only/);
    assert.deepEqual(healthy.requests, [
      "/api/v1/admin/snapshot?view=overview",
      "/api/v1/user/signals?limit=4&offset=0"
    ]);
  } finally {
    healthy.browser.close();
  }

  const paused = await renderOverview(snapshot({ actionsPaused: true }));
  try {
    assert.match(paused.browser.document.querySelector("#overviewHeadline")?.textContent ?? "", /actions are paused/i);
    assert.match(paused.browser.document.querySelector("#heroStatus")?.textContent ?? "", /Paused/);
    assert.match(paused.browser.document.querySelector("#heroStatus")?.textContent ?? "", /1 active · paused/);
    assert.equal(paused.browser.document.querySelector("#actionsToggle")?.textContent, "Resume all actions");
    assert.equal(paused.browser.document.querySelector("#modeChip")?.textContent, "Paused");
    assert.equal((paused.browser.document.querySelector("#actionsToggleReason") as HTMLElement).hidden, true);
    assert.equal((paused.browser.document.querySelector("#readinessPanel") as HTMLElement).hidden, true);
  } finally {
    paused.browser.close();
  }

  const resumeBlocked = await renderOverview(snapshot({ actionsPaused: true, qualified: false, active: false }));
  try {
    assert.equal((resumeBlocked.browser.document.querySelector("#actionsToggle") as HTMLButtonElement).disabled, true);
    assert.equal((resumeBlocked.browser.document.querySelector("#actionsToggleReason") as HTMLElement).hidden, false);
    assert.equal(resumeBlocked.browser.document.querySelector("#actionsToggleReason")?.textContent, "Set up a store before resuming actions.");
  } finally {
    resumeBlocked.browser.close();
  }

  const setupNeeded = await renderOverview(snapshot({
    onlineDevices: 0,
    trackalackerReady: false,
    mappedProducts: 0,
    qualified: false,
    active: false,
    purchaseRule: false
  }));
  try {
    assert.match(setupNeeded.browser.document.querySelector("#overviewHeadline")?.textContent ?? "", /Pair Chrome/i);
    assert.match(setupNeeded.browser.document.querySelector("#heroStatus")?.textContent ?? "", /Needs attention/);
    assert.equal((setupNeeded.browser.document.querySelector("#readinessPanel") as HTMLElement).hidden, false);
    assert.equal(setupNeeded.browser.document.querySelectorAll("#readinessGuide .readiness-step").length, 1);
    assert.match(setupNeeded.browser.document.querySelector("#readinessGuide")?.textContent ?? "", /Chrome companion/);
    assert.equal(setupNeeded.browser.document.querySelector("#readinessGate")?.textContent, "Step 1 of 5");
    assert.equal(setupNeeded.browser.document.querySelector("#readinessGuide .text-button")?.textContent, "Open Sources");
    assert.equal(setupNeeded.browser.document.querySelector("#readinessGuide .readiness-mark")?.getAttribute("aria-hidden"), "true");
    assert.equal(setupNeeded.browser.document.querySelector("#heroStatus .text-button")?.textContent, "Open Sources");
  } finally {
    setupNeeded.browser.close();
  }

  const storeToFinish = await renderOverview(snapshot({ qualified: true, active: false }));
  try {
    assert.equal((storeToFinish.browser.document.querySelector("#readinessPanel") as HTMLElement).hidden, false);
    const link = storeToFinish.browser.document.querySelector("#readinessGuide .text-button") as HTMLButtonElement;
    assert.equal(link.textContent, "Open Stores");
    assert.equal(link.dataset.openRoute, "stores/qualification/target", "setup deep-links to the store that still needs activation");
    link.click();
    await eventually(() => assert.equal(storeToFinish.browser.location.hash, "#stores/qualification/target"));
  } finally {
    storeToFinish.browser.close();
  }
});
