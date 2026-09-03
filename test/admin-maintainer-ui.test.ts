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

async function eventually(assertion: () => void, attempts = 100): Promise<void> {
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

function snapshot(view: string, permissions: string[]): Record<string, unknown> {
  return {
    view,
    version: "admin-maintainer-ui-test",
    permissions,
    actor: {
      displayName: "Admin Fixture",
      tenantName: "Fixture tenant",
      roleLabels: ["Fixture role"],
      sessionKind: "hosted",
      signOutUrl: ""
    },
    settings: { actionsPaused: false, executionMode: "live" },
    counts: { onlineDevices: 1, pendingCatalogProposals: 0, pendingAdminChanges: 0, openIncidents: 0 },
    trackalacker: { ready: true, mappedProducts: 1 },
    capabilities: {
      targetAddQualified: true,
      targetAddMutationAuthorized: true,
      walmartAddQualified: false,
      walmartAddMutationAuthorized: false,
      amazonAddQualified: false,
      amazonAddMutationAuthorized: false,
      bestBuyAddQualified: false,
      bestBuyAddMutationAuthorized: false
    },
    sources: [],
    strategies: [{ enabled: true, action: "add_to_cart" }],
    overview: { windows: { hours24: {}, days7: {} } },
    community: { consents: [], assertions: [], aggregates: [] },
    identityGovernance: { claims: [], projections: [] },
    observerRegistry: { recipes: [], recoveryEvidence: [] },
    catalogGovernance: {
      reviewCapable: false,
      identityProposalCapable: permissions.includes("catalog.identity.propose"),
      identityApprovalCapable: permissions.includes("catalog.identity.approve"),
      identityOperations: []
    },
    dataPlane: {}
  };
}

async function openAdmin(permissions: string[]): Promise<{
  browser: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  requests: string[];
}> {
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
      if (path.startsWith("/api/v1/admin/snapshot?view=")) {
        const view = new URL(path, "http://127.0.0.1:32991").searchParams.get("view") || "overview";
        return { ok: true, status: 200, json: async () => snapshot(view, permissions) };
      }
      if (path.startsWith("/api/v1/user/library")) {
        return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) };
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", { configurable: true, value: { escape: (value: string) => value } });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: false, note: "" }) }
  });
  await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
  await eventually(() => assert.equal(browser.document.querySelector("#modeChip")?.textContent, "Running"));
  return { browser, requests };
}

test("Maintainer stays hidden and direct routes canonicalize for an admin without permission", async () => {
  const { browser, requests } = await openAdmin(["admin.read"]);
  try {
    const maintainer = browser.document.querySelector('[data-admin-group="maintainer"]') as HTMLButtonElement;
    assert.equal(maintainer.hidden, true);
    assert.equal(browser.document.querySelector('[data-view-panel="community"]')?.classList.contains("active"), false);
    assert.equal(browser.document.querySelectorAll('[data-view-panel="overview"] textarea').length, 0);

    browser.location.hash = "community/observers";
    await eventually(() => assert.equal(browser.location.hash, "#overview"));
    assert.equal(requests.some((path) => path.endsWith("view=community")), false);
    assert.equal(browser.document.querySelector('[data-view-panel="community"]')?.classList.contains("active"), false);
  } finally {
    browser.close();
  }
});

test("Maintainer reveals only authorized technical destinations and owns the moved panels", async () => {
  const permissions = [
    "admin.read", "admin.maintainer", "recipe.manage", "worker.manage",
    "catalog.identity.propose", "catalog.identity.approve"
  ];
  const { browser } = await openAdmin(permissions);
  try {
    const maintainer = browser.document.querySelector('[data-admin-group="maintainer"]') as HTMLButtonElement;
    assert.equal(maintainer.hidden, false);
    maintainer.click();
    await eventually(() => assert.equal(browser.location.hash, "#community/sharing"));
    await eventually(() => assert.equal(browser.document.querySelectorAll("#communitySummary .metric").length, 4));
    assert.equal(browser.document.querySelector('[data-view-panel="community"]')?.classList.contains("active"), true);
    assert.equal((browser.document.querySelector('[data-community-view="observers"]') as HTMLElement).hidden, false);
    assert.equal((browser.document.querySelector('[data-community-view="catalog"]') as HTMLElement).hidden, false);
    assert.equal((browser.document.querySelector('[data-community-view="data"]') as HTMLElement).hidden, false);

    (browser.document.querySelector('[data-community-view="observers"]') as HTMLButtonElement).click();
    assert.equal(browser.location.hash, "#community/observers");
    assert.equal((browser.document.querySelector('[data-community-panel="observers"]') as HTMLElement).hidden, false);
    assert.equal(browser.document.querySelectorAll('[data-community-panel="observers"] textarea').length, 2);
    assert.ok(browser.document.querySelector("#observerRecoveryList"));
    assert.match(browser.document.querySelector('[data-community-panel="observers"]')?.textContent ?? "", /Normalized missing-field previews/);

    (browser.document.querySelector('[data-community-view="catalog"]') as HTMLButtonElement).click();
    assert.equal(browser.location.hash, "#community/catalog");
    assert.equal((browser.document.querySelector('[data-community-panel="catalog"]') as HTMLElement).hidden, false);
    assert.ok(browser.document.querySelector("#catalogIdentityOperationList"));

    (browser.document.querySelector('[data-community-view="data"]') as HTMLButtonElement).click();
    assert.equal(browser.location.hash, "#community/data");
    assert.equal((browser.document.querySelector('[data-community-panel="data"]') as HTMLElement).hidden, false);
    assert.ok(browser.document.querySelector("#postgresCutoverChecklist"));
    assert.equal(browser.document.querySelectorAll('[data-operations-view="data"]').length, 0);
    assert.equal(browser.document.querySelectorAll('.panel-heading > .button.danger').length, 0);
    assert.equal(browser.document.querySelectorAll('.danger-zone > .button.danger').length, 2);
  } finally {
    browser.close();
  }
});
