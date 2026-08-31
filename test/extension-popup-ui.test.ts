import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

const EXTENSION_ROOT = join(process.cwd(), "apps", "extension");
const POPUP_HTML = readFileSync(join(EXTENSION_ROOT, "popup.html"), "utf8")
  .replace(/\s*<script[^>]*>[\s\S]*?<\/script>/g, "")
  .replace(/\s*<script[^>]*src="[^"]+"[^>]*><\/script>/g, "");
const POPUP_STATE = readFileSync(join(EXTENSION_ROOT, "popup-state.js"), "utf8");
const POPUP = readFileSync(join(EXTENSION_ROOT, "popup.js"), "utf8");

const READY = {
  connected: true,
  paired: true,
  version: "1.9.1",
  executionMode: "live",
  actionsPaused: false,
  chromeMutationEnabled: true,
  checkedAt: new Date().toISOString(),
  trackalackerPush: { ready: true, state: "ready" }
};

interface PopupHarnessOptions {
  url?: string;
  health?: Record<string, unknown>;
  permission?: boolean;
  updateResponse?: Record<string, unknown>;
  cartReady?: Record<string, unknown>;
  cartReadySound?: boolean;
}

async function turn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function popupHarness(options: PopupHarnessOptions = {}) {
  const requestCalls: Array<{ origins: string[] }> = [];
  const createdTabs: string[] = [];
  const runtimeMessages: Array<Record<string, unknown>> = [];
  const session: Record<string, unknown> = options.cartReady
    ? { yoinkCartReadyV1: options.cartReady } : {};
  let reloadCount = 0;
  const health = { ...READY, ...(options.health || {}) };
  const local: Record<string, unknown> = {
    readiness: health,
    yoinkCartReadySoundEnabledV1: options.cartReadySound === true
  };
  const dom = new JSDOM(POPUP_HTML, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html"
  });
  const window = dom.window as unknown as Window & typeof globalThis & {
    chrome: Record<string, unknown>;
    YoinkPopupController: {
      state: Record<string, unknown>;
      render(): void;
    };
  };
  const runtimeListeners: Array<(message: unknown) => boolean> = [];
  const storageListeners: Array<(changes: unknown, area: string) => void> = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: "1.9.1" }),
      getURL: (path: string) => `chrome-extension://${"a".repeat(32)}/${path}`,
      sendMessage: async (message: { type?: string }) => {
        runtimeMessages.push({ ...message });
        if (message.type === "yoink:check-health") return { ok: true, state: health };
        if (message.type === "yoink:open-cart-ready") {
          const empty = { schemaVersion: 1, items: [] };
          session.yoinkCartReadyV1 = empty;
          return { ok: true, opened: true, cartReady: empty };
        }
        if (message.type === "yoink:check-update") return options.updateResponse || { ok: false, message: "No update fixture." };
        if (message.type === "yoink:inspect-and-qualify") {
          return {
            ok: true,
            state: health,
            popupResult: {
              schemaVersion: 1,
              contextKey: "product:target:94972381",
              outcome: "qualified",
              summary: "Qualified · $39.99 · Shipping",
              details: "TCIN 94972381 · $39.99 · Target · Shipping · Exact offer binding verified · Qualification stopped at the final pre-click boundary.",
              recordedAt: new Date().toISOString(),
              productTitle: "Pokémon Deluxe Battle Action Pikachu"
            }
          };
        }
        return { ok: true, state: health };
      },
      reload: () => { reloadCount += 1; },
      onMessage: { addListener: (listener: (message: unknown) => boolean) => runtimeListeners.push(listener) }
    },
    tabs: {
      query: async () => [{ id: 17, url: options.url || "https://example.com/" }],
      create: async ({ url }: { url: string }) => { createdTabs.push(url); return { id: 18, url }; }
    },
    permissions: {
      contains: async () => options.permission === true,
      request: async (request: { origins: string[] }) => {
        requestCalls.push(request);
        return true;
      }
    },
    storage: {
      local: {
        get: async () => ({ ...local }),
        set: async (value: Record<string, unknown>) => { Object.assign(local, value); }
      },
      session: {
        get: async (key: string) => ({ [key]: session[key] }),
        set: async (value: Record<string, unknown>) => { Object.assign(session, value); },
        remove: async (key: string) => { delete session[key]; }
      },
      onChanged: { addListener: (listener: (changes: unknown, area: string) => void) => storageListeners.push(listener) }
    }
  };
  window.eval(`globalThis.YoinkRuntimeConfig = Object.freeze({
    profile: "local",
    appOrigin: "http://127.0.0.1:32991",
    localPackageUpdates: true
  });`);
  window.eval(`${POPUP_STATE}\nglobalThis.YoinkPopupStateModule = YoinkPopupStateModule;`);
  window.eval(POPUP);
  await turn();
  await turn();
  return { dom, window, document: window.document, requestCalls, createdTabs, runtimeMessages, session, local, reloadCount: () => reloadCount };
}

function click(window: Window, element: Element): void {
  const MouseEventConstructor = (window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  element.dispatchEvent(new MouseEventConstructor("click", { bubbles: true }));
}

test("the popup renders the minimal healthy, product, drawing, disconnected, and paused states", async () => {
  const idle = await popupHarness();
  assert.equal(idle.document.querySelector("#statusLabel")?.textContent, "Ready");
  assert.equal((idle.document.querySelector("#contextSurface") as HTMLElement).hidden, true);
  assert.equal((idle.document.querySelector("#primaryAction") as HTMLButtonElement).hidden, true);
  assert.equal(idle.document.querySelector("#activityStatus")?.textContent, "Signals live");

  const product = await popupHarness({
    url: "https://www.target.com/p/pokemon/-/A-94972381#lnk=sametab"
  });
  assert.equal(product.document.querySelector("#contextEyebrow")?.textContent, "TARGET");
  assert.equal(product.document.querySelector("#contextTitle")?.textContent, "Target product · TCIN 94972381");
  assert.equal(product.document.querySelector("#primaryAction")?.textContent, "Inspect product");
  assert.equal(product.document.querySelector("#activityStatus")?.textContent, "Signals live");

  const drawing = await popupHarness({ url: "https://www.walmart.com/shop/collectibles/draw/" });
  assert.equal(drawing.document.querySelector("#contextTitle")?.textContent, "Collectibles Draw");
  assert.equal(drawing.document.querySelector("#primaryAction")?.textContent, "Inspect drawings");

  const disconnected = await popupHarness({
    url: "https://www.bestbuy.com/product/card/J3ZPGXX9RP/sku/6685081",
    health: { trackalackerPush: { ready: false, state: "error" } }
  });
  assert.equal(disconnected.document.querySelector("#statusLabel")?.textContent, "Needs attention");
  assert.equal(disconnected.document.querySelector("#primaryAction")?.textContent, "Inspect product");
  assert.equal(disconnected.document.querySelector("#activityActionLabel")?.textContent, "TrackaLacker disconnected · Reconnect");

  const paused = await popupHarness({
    url: "https://www.amazon.com/dp/B00E4AMFKK",
    health: { actionsPaused: true }
  });
  assert.equal(paused.document.querySelector("#statusLabel")?.textContent, "Paused");
  assert.equal(paused.document.querySelector("#primaryAction")?.textContent, "Inspect product");
  assert.equal(paused.document.querySelector("#activityActionLabel")?.textContent, "Retailer actions paused · Review");

  for (const fixture of [idle, product, drawing, disconnected, paused]) fixture.dom.window.close();
});

test("a cart-ready handoff owns the popup action and opens only through the background validator", async () => {
  const fixture = await popupHarness({
    url: "https://www.target.com/p/pokemon/-/A-94972381",
    cartReady: {
      schemaVersion: 1,
      items: [{
        schemaVersion: 1,
        jobId: "job_target_fixture",
        retailerId: "target",
        retailerSku: "94972381",
        tabId: 42,
        recordedAt: new Date().toISOString(),
        latency: { leaseToCartReadyMs: 9_000 }
      }]
    }
  });
  const action = fixture.document.querySelector("#primaryAction") as HTMLButtonElement;
  assert.equal(fixture.document.querySelector("#statusLabel")?.textContent, "Needs attention");
  assert.equal(fixture.document.querySelector("#contextEyebrow")?.textContent, "CART READY");
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "Target cart ready");
  assert.equal(fixture.document.querySelector("#contextSupporting")?.textContent, "TCIN 94972381 · Checkout stays manual");
  assert.equal(action.textContent, "Open cart");
  click(fixture.window, action);
  await turn();
  await turn();
  assert.equal(fixture.runtimeMessages.some((message) => message.type === "yoink:open-cart-ready"
    && message.jobId === "job_target_fixture"), true);
  assert.equal((fixture.window.YoinkPopupController.state.cartReady as { items: unknown[] }).items.length, 0);
  fixture.dom.window.close();
});

test("status and overflow reveals maintain ARIA, keyboard navigation, Escape, and focus restoration", async () => {
  const fixture = await popupHarness();
  const { document, window } = fixture;
  const statusButton = document.querySelector("#statusButton") as HTMLButtonElement;
  const statusPanel = document.querySelector("#statusPanel") as HTMLElement;
  click(window, statusButton);
  assert.equal(statusButton.getAttribute("aria-expanded"), "true");
  assert.equal(statusPanel.hidden, false);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(statusButton.getAttribute("aria-expanded"), "false");
  assert.equal(statusPanel.hidden, true);
  assert.equal(document.activeElement, statusButton);

  const menuButton = document.querySelector("#menuButton") as HTMLButtonElement;
  const menu = document.querySelector("#overflowPanel") as HTMLElement;
  click(window, menuButton);
  assert.equal(menuButton.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.id, "syncProducts");
  menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.equal(document.activeElement?.id, "manageStoreAccess");
  menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(document.activeElement?.id, "settings");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(menuButton.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, menuButton);
  fixture.dom.window.close();
});

test("cart-ready sound is explicitly opt-in and persists from the overflow menu", async () => {
  const fixture = await popupHarness();
  const control = fixture.document.querySelector("#cartReadySound") as HTMLButtonElement;
  assert.equal(control.getAttribute("aria-checked"), "false");
  click(fixture.window, control);
  await turn();
  assert.equal(control.getAttribute("aria-checked"), "true");
  assert.equal(fixture.local.yoinkCartReadySoundEnabledV1, true);
  fixture.dom.window.close();
});

test("popup navigation options open their distinct intended Yoink workspaces", async () => {
  const fixture = await popupHarness();
  const { document, window } = fixture;
  click(window, document.querySelector("#openYoink") as HTMLButtonElement);
  click(window, document.querySelector("#manageStoreAccess") as HTMLButtonElement);
  click(window, document.querySelector("#diagnostics") as HTMLButtonElement);
  click(window, document.querySelector("#settings") as HTMLButtonElement);
  click(window, document.querySelector("#statusDiagnostics") as HTMLButtonElement);
  await turn();
  assert.deepEqual(fixture.createdTabs, [
    "http://127.0.0.1:32991/",
    `chrome-extension://${"a".repeat(32)}/options.html#store-access`,
    "http://127.0.0.1:32991/#health",
    `chrome-extension://${"a".repeat(32)}/options.html`,
    "http://127.0.0.1:32991/#health"
  ]);
  fixture.dom.window.close();
});

test("retailer access is requested only after the contextual action receives a user click", async () => {
  const fixture = await popupHarness({
    url: "https://www.target.com/p/pokemon/-/A-94972381",
    permission: false
  });
  const action = fixture.document.querySelector("#primaryAction") as HTMLButtonElement;
  assert.equal(fixture.requestCalls.length, 0);
  assert.equal(action.textContent, "Inspect product");
  click(fixture.window, action);
  await turn();
  await turn();
  assert.equal(fixture.requestCalls.length, 1);
  assert.equal(fixture.requestCalls[0]?.origins.join(","), "https://www.target.com/*");
  assert.equal(action.textContent, "Qualified");
  assert.equal(action.getAttribute("aria-label"), "Qualified. Inspect product again.");
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "Pokémon Deluxe Battle Action Pikachu");
  assert.equal(fixture.document.querySelector("#contextSupporting")?.textContent, "TCIN 94972381 · $39.99 · Shipping");
  const resultDetails = fixture.document.querySelector("#resultDetails") as HTMLElement;
  const resultDetailsButton = fixture.document.querySelector("#resultDetailsButton") as HTMLButtonElement;
  assert.equal(resultDetails.hidden, true);
  assert.equal(resultDetailsButton.hidden, false);
  click(fixture.window, resultDetailsButton);
  assert.equal(resultDetailsButton.getAttribute("aria-expanded"), "true");
  assert.equal(resultDetails.hidden, false);
  fixture.document.dispatchEvent(new fixture.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(resultDetailsButton.getAttribute("aria-expanded"), "false");
  assert.equal(resultDetails.hidden, true);
  assert.equal(fixture.document.activeElement, resultDetailsButton);
  fixture.dom.window.close();
});

test("community evidence appears only for an opted-in exact page and requires visible confirmation", async () => {
  const fixture = await popupHarness({
    url: "https://www.target.com/p/pokemon/-/A-94972381",
    health: { communitySharingRetailers: ["target"] }
  });
  const menuButton = fixture.document.querySelector("#menuButton") as HTMLButtonElement;
  const share = fixture.document.querySelector("#shareEvidence") as HTMLButtonElement;
  click(fixture.window, menuButton);
  assert.equal(share.hidden, false);
  click(fixture.window, share);
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "Share Target evidence?");
  assert.equal(fixture.document.querySelector("#primaryAction")?.textContent, "Share evidence");
  assert.equal((fixture.document.querySelector("#cancelContext") as HTMLButtonElement).hidden, false);
  assert.equal(fixture.requestCalls.length, 0);
  fixture.document.dispatchEvent(new fixture.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "Target product · TCIN 94972381");
  assert.equal((fixture.document.querySelector("#cancelContext") as HTMLButtonElement).hidden, true);
  assert.equal(fixture.document.activeElement, menuButton);
  fixture.dom.window.close();
});

test("a downloaded local update becomes a persistent reload handoff", async () => {
  const recordedAt = new Date().toISOString();
  const handoff = {
    schemaVersion: 1,
    channel: "local",
    releaseVersion: "1.9.2",
    recordedAt
  };
  const fixture = await popupHarness({
    health: { version: "1.9.2" },
    updateResponse: {
      ok: true,
      update: {
        installedVersion: "1.9.1",
        releaseVersion: "1.9.2",
        updateAvailable: true,
        downloadStarted: true,
        handoff
      }
    }
  });
  const action = fixture.document.querySelector("#primaryAction") as HTMLButtonElement;
  assert.equal(action.textContent, "Update companion");
  click(fixture.window, action);
  await turn();
  await turn();
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "Replace extension files");
  assert.equal(action.textContent, "Reload companion");
  assert.deepEqual(fixture.session.yoinkUpdateHandoffV1, handoff);
  click(fixture.window, action);
  await turn();
  assert.equal(fixture.reloadCount(), 1);
  assert.equal(fixture.session.yoinkUpdateHandoffV1, undefined);
  fixture.dom.window.close();
});
