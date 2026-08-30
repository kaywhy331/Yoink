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
}

async function turn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function popupHarness(options: PopupHarnessOptions = {}) {
  const requestCalls: Array<{ origins: string[] }> = [];
  const createdTabs: string[] = [];
  const session: Record<string, unknown> = {};
  const health = { ...READY, ...(options.health || {}) };
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
      sendMessage: async (message: { type?: string }) => {
        if (message.type === "yoink:check-health") return { ok: true, state: health };
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
              recordedAt: new Date().toISOString()
            }
          };
        }
        return { ok: true, state: health };
      },
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
      local: { get: async () => ({ readiness: health }) },
      session: {
        get: async (key: string) => ({ [key]: session[key] }),
        set: async (value: Record<string, unknown>) => { Object.assign(session, value); }
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
  return { dom, window, document: window.document, requestCalls, createdTabs, session };
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
  assert.equal(fixture.document.querySelector("#contextSupporting")?.textContent, "$39.99 · Shipping");
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
