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
  cartOutcomeDraft?: Record<string, unknown>;
  cartReadySound?: boolean;
  purchaseOpportunity?: Record<string, unknown>;
  purchaseOpportunityAfterOpen?: Record<string, unknown> | null;
}

async function turn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function popupHarness(options: PopupHarnessOptions = {}) {
  const requestCalls: Array<{ origins: string[] }> = [];
  const createdTabs: string[] = [];
  const runtimeMessages: Array<Record<string, unknown>> = [];
  const session: Record<string, unknown> = {
    ...(options.cartReady ? { yoinkCartReadyV1: options.cartReady } : {}),
    ...(options.cartOutcomeDraft ? { yoinkCartOutcomeDraftV1: options.cartOutcomeDraft } : {})
  };
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
      sendMessage: async (message: {
        type?: string;
        jobId?: string;
        deliveryId?: string;
        outcome?: string;
        actualTotalCents?: number | null;
        confirmation?: string;
      }) => {
        runtimeMessages.push({ ...message });
        if (message.type === "yoink:check-health") return { ok: true, state: health };
        if (message.type === "yoink:get-purchase-opportunity") {
          return { ok: true, opportunity: options.purchaseOpportunity || null };
        }
        if (message.type === "yoink:open-purchase-opportunity") {
          return {
            ok: true,
            opened: true,
            opportunity: options.purchaseOpportunityAfterOpen || null
          };
        }
        if (message.type === "yoink:open-cart-ready") {
          const current = session.yoinkCartReadyV1 as {
            schemaVersion: 1;
            items: Array<Record<string, unknown>>;
          };
          const opened = {
            schemaVersion: 1,
            items: current.items.map((item) => item.jobId === message.jobId
              ? { ...item, openedAt: new Date().toISOString() }
              : item)
          };
          session.yoinkCartReadyV1 = opened;
          return { ok: true, opened: true, cartReady: opened };
        }
        if (message.type === "yoink:report-cart-outcome") {
          const current = session.yoinkCartReadyV1 as {
            schemaVersion: 1;
            items: Array<Record<string, unknown>>;
          };
          const closed = {
            schemaVersion: 1,
            items: current.items.filter((item) => item.jobId !== message.jobId)
          };
          session.yoinkCartReadyV1 = closed;
          return { ok: true, outcome: { disposition: "recorded" }, cartReady: closed };
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
              summary: "Check passed · $39.99 · Shipping",
              details: "TCIN 94972381 · $39.99 · Target · Shipping · Exact offer binding verified",
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
  assert.equal(idle.document.querySelector("#activityStatus")?.textContent, "Calls live");
  assert.equal(
    (idle.document.body.textContent || "").match(/Checkout stays manual\./g)?.length,
    1,
    "The popup states the checkout boundary once, in its footer."
  );
  assert.equal(idle.document.querySelector("footer .footer-boundary")?.textContent, "Checkout stays manual.");

  const product = await popupHarness({
    url: "https://www.target.com/p/pokemon/-/A-94972381#lnk=sametab"
  });
  assert.equal(product.document.querySelector("#contextEyebrow")?.textContent, "TARGET");
  assert.equal(product.document.querySelector("#contextTitle")?.textContent, "Target product · TCIN 94972381");
  assert.equal(product.document.querySelector("#primaryAction")?.textContent, "Inspect product");
  assert.equal(product.document.querySelector("#activityStatus")?.textContent, "Calls live");

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
  assert.equal(paused.document.querySelector("#activityActionLabel")?.textContent, "Store actions paused · Open Home");

  for (const fixture of [idle, product, drawing, disconnected, paused]) fixture.dom.window.close();
});

test("a pending Walmart purchase is recoverable from the popup without replacing exact page inspection", async () => {
  const opportunity = {
    schemaVersion: 1,
    deliveryId: "notification_walmart_popup",
    kind: "walmart_review_order",
    retailerId: "walmart",
    retailerName: "Walmart",
    identityLabel: "Item",
    retailerSku: "19988614228",
    title: "Walmart Direct Cart Fixture",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
  const idle = await popupHarness({ purchaseOpportunity: opportunity });
  const idleAction = idle.document.querySelector("#primaryAction") as HTMLButtonElement;
  assert.equal(idle.document.querySelector("#statusLabel")?.textContent, "Needs attention");
  assert.equal(idle.document.querySelector("#contextEyebrow")?.textContent, "WALMART");
  assert.equal(idleAction.textContent, "Buy at Walmart");
  click(idle.window, idleAction);
  await turn();
  await turn();
  assert.equal(idle.runtimeMessages.some((message) =>
    message.type === "yoink:open-purchase-opportunity"
      && message.deliveryId === "notification_walmart_popup"), true);
  assert.equal((idle.document.querySelector("#primaryAction") as HTMLButtonElement).hidden, true);

  const product = await popupHarness({
    url: "https://www.target.com/p/pokemon/-/A-94972381",
    purchaseOpportunity: opportunity
  });
  assert.equal(product.document.querySelector("#primaryAction")?.textContent, "Inspect product");
  assert.equal(
    product.document.querySelector("#activityActionLabel")?.textContent,
    "Walmart Item 19988614228 ready · Open"
  );
  click(product.window, product.document.querySelector("#activityAction") as HTMLButtonElement);
  await turn();
  assert.equal(product.runtimeMessages.some((message) =>
    message.type === "yoink:open-purchase-opportunity"
      && message.deliveryId === "notification_walmart_popup"), true);

  idle.dom.window.close();
  product.dom.window.close();
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
        reviewedMaximumCents: 3_999,
        latency: { leaseToCartReadyMs: 9_000 }
      }]
    }
  });
  const action = fixture.document.querySelector("#primaryAction") as HTMLButtonElement;
  assert.equal(fixture.document.querySelector("#statusLabel")?.textContent, "Needs attention");
  assert.equal(fixture.document.querySelector("#contextEyebrow")?.textContent, "CART READY");
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "Target cart ready");
  assert.equal(fixture.document.querySelector("#contextSupporting")?.textContent, "TCIN 94972381");
  assert.equal(action.textContent, "Open cart");
  click(fixture.window, action);
  await turn();
  await turn();
  assert.equal(fixture.runtimeMessages.some((message) => message.type === "yoink:open-cart-ready"
    && message.jobId === "job_target_fixture"), true);
  const openedItems = (fixture.window.YoinkPopupController.state.cartReady as {
    items: Array<{ openedAt?: string }>;
  }).items;
  assert.equal(openedItems.length, 1);
  assert.match(openedItems[0]?.openedAt || "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(action.textContent, "Return to cart");
  assert.equal((fixture.document.querySelector("#cartOutcome") as HTMLElement).hidden, false);
  assert.equal(fixture.document.querySelector("#cartOutcomePrompt")?.textContent, "Did you check out?");
  click(fixture.window, fixture.document.querySelector("#cartOutcomeGotIt") as HTMLButtonElement);
  assert.equal((fixture.document.querySelector("#cartOutcomeForm") as HTMLFormElement).hidden, false);
  const amount = fixture.document.querySelector("#cartOutcomeAmount") as HTMLInputElement;
  assert.equal(amount.value, "39.99");
  amount.value = "41.27";
  (fixture.document.querySelector("#cartOutcomeForm") as HTMLFormElement).dispatchEvent(
    new fixture.window.Event("submit", { bubbles: true, cancelable: true })
  );
  await turn();
  await turn();
  assert.deepEqual(fixture.runtimeMessages.find((message) => message.type === "yoink:report-cart-outcome"), {
    type: "yoink:report-cart-outcome",
    jobId: "job_target_fixture",
    outcome: "got_it",
    actualTotalCents: 4_127,
    confirmation: "I_REVIEWED_CHECKOUT_RESULT"
  });
  assert.equal((fixture.window.YoinkPopupController.state.cartReady as { items: unknown[] }).items.length, 0);
  assert.equal((fixture.document.querySelector("#cartOutcome") as HTMLElement).hidden, true);
  fixture.dom.window.close();
});

test("Missed it closes an opened cart handoff without asking for an amount", async () => {
  const fixture = await popupHarness({
    cartReady: {
      schemaVersion: 1,
      items: [{
        schemaVersion: 1,
        kind: "needs_you",
        jobId: "job_target_missed",
        retailerId: "target",
        retailerSku: "94972381",
        tabId: 42,
        recordedAt: new Date().toISOString(),
        reviewedMaximumCents: 3_999,
        reasonCode: "cart_unverified"
      }]
    }
  });
  click(fixture.window, fixture.document.querySelector("#primaryAction") as HTMLButtonElement);
  await turn();
  await turn();
  click(fixture.window, fixture.document.querySelector("#cartOutcomeMissedIt") as HTMLButtonElement);
  await turn();
  await turn();
  assert.deepEqual(fixture.runtimeMessages.find((message) => message.type === "yoink:report-cart-outcome"), {
    type: "yoink:report-cart-outcome",
    jobId: "job_target_missed",
    outcome: "missed_it",
    actualTotalCents: null,
    confirmation: "I_REVIEWED_CHECKOUT_RESULT"
  });
  assert.equal((fixture.window.YoinkPopupController.state.cartReady as { items: unknown[] }).items.length, 0);
  fixture.dom.window.close();
});

test("an opened handoff restores the checkout-result prompt when the popup reopens", async () => {
  const fixture = await popupHarness({
    cartReady: {
      schemaVersion: 1,
      items: [{
        schemaVersion: 1,
        kind: "cart_ready",
        jobId: "job_reopened_cart",
        retailerId: "walmart",
        retailerSku: "20252562938",
        tabId: 43,
        recordedAt: new Date(Date.now() - 30_000).toISOString(),
        openedAt: new Date(Date.now() - 20_000).toISOString(),
        reviewedMaximumCents: 8_497
      }]
    }
  });
  assert.equal(fixture.document.querySelector("#primaryAction")?.textContent, "Return to cart");
  assert.equal((fixture.document.querySelector("#cartOutcome") as HTMLElement).hidden, false);
  assert.equal(fixture.document.querySelector("#cartOutcomePrompt")?.textContent, "Did you check out?");
  fixture.dom.window.close();
});

test("an in-progress checkout amount is restored when the popup reopens", async () => {
  const recordedAt = new Date().toISOString();
  const cartReady = {
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      kind: "cart_ready",
      jobId: "job_reopened_amount",
      retailerId: "target",
      retailerSku: "94972381",
      tabId: 42,
      recordedAt,
      openedAt: recordedAt,
      reviewedMaximumCents: 3_999
    }]
  };
  const first = await popupHarness({ cartReady });
  click(first.window, first.document.querySelector("#cartOutcomeGotIt") as HTMLButtonElement);
  const amount = first.document.querySelector("#cartOutcomeAmount") as HTMLInputElement;
  amount.value = "41.27";
  amount.dispatchEvent(new first.window.Event("input", { bubbles: true }));
  await turn();
  const draft = first.session.yoinkCartOutcomeDraftV1 as Record<string, unknown>;
  assert.equal(draft.amount, "41.27");
  first.dom.window.close();

  const reopened = await popupHarness({ cartReady, cartOutcomeDraft: draft });
  assert.equal((reopened.document.querySelector("#cartOutcomeForm") as HTMLFormElement).hidden, false);
  assert.equal((reopened.document.querySelector("#cartOutcomeAmount") as HTMLInputElement).value, "41.27");
  reopened.dom.window.close();
});

test("multiple carts keep the opened handoff closeable before advancing to the next cart", async () => {
  const fixture = await popupHarness({
    cartReady: {
      schemaVersion: 1,
      items: [{
        schemaVersion: 1,
        kind: "cart_ready",
        jobId: "job_target_older",
        retailerId: "target",
        retailerSku: "94972381",
        tabId: 42,
        recordedAt: new Date().toISOString()
      }, {
        schemaVersion: 1,
        kind: "cart_ready",
        jobId: "job_walmart_newer",
        retailerId: "walmart",
        retailerSku: "20252562938",
        tabId: 43,
        recordedAt: new Date().toISOString()
      }]
    }
  });
  const action = fixture.document.querySelector("#primaryAction") as HTMLButtonElement;
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "2 carts ready");
  assert.equal(action.textContent, "Open cart");

  click(fixture.window, action);
  await turn();
  await turn();
  let state = fixture.window.YoinkPopupController.state as {
    view: { cartReady: { jobId: string } | null };
  };
  assert.equal(fixture.runtimeMessages.filter((message) => message.type === "yoink:open-cart-ready").at(-1)?.jobId,
    "job_walmart_newer");
  assert.equal(state.view.cartReady?.jobId, "job_walmart_newer");
  assert.equal(action.textContent, "Return to cart");
  assert.equal((fixture.document.querySelector("#cartOutcome") as HTMLElement).hidden, false);

  click(fixture.window, fixture.document.querySelector("#cartOutcomeMissedIt") as HTMLButtonElement);
  await turn();
  await turn();
  state = fixture.window.YoinkPopupController.state as typeof state;
  assert.equal(state.view.cartReady?.jobId, "job_target_older");
  assert.equal(action.textContent, "Open cart");

  click(fixture.window, action);
  await turn();
  await turn();
  state = fixture.window.YoinkPopupController.state as typeof state;
  assert.equal(fixture.runtimeMessages.filter((message) => message.type === "yoink:open-cart-ready").at(-1)?.jobId,
    "job_target_older");
  assert.equal(state.view.cartReady?.jobId, "job_target_older");
  assert.equal(action.textContent, "Return to cart");
  fixture.dom.window.close();
});

test("a pending checkout prompt stays in front of a newer cart handoff until it is answered", async () => {
  const fixture = await popupHarness({
    cartReady: {
      schemaVersion: 1,
      items: [{
        schemaVersion: 1,
        kind: "cart_ready",
        jobId: "job_cart_opened",
        retailerId: "target",
        retailerSku: "94972381",
        tabId: 42,
        recordedAt: new Date(Date.now() - 40_000).toISOString(),
        openedAt: new Date(Date.now() - 30_000).toISOString(),
        reviewedMaximumCents: 3_999
      }, {
        schemaVersion: 1,
        kind: "cart_ready",
        jobId: "job_cart_newer",
        retailerId: "walmart",
        retailerSku: "20252562938",
        tabId: 43,
        recordedAt: new Date().toISOString()
      }]
    }
  });
  const action = fixture.document.querySelector("#primaryAction") as HTMLButtonElement;
  let state = fixture.window.YoinkPopupController.state as { view: { cartReady: { jobId: string } | null } };
  assert.equal(state.view.cartReady?.jobId, "job_cart_opened");
  assert.equal(action.textContent, "Return to cart");
  assert.equal((fixture.document.querySelector("#cartOutcome") as HTMLElement).hidden, false);
  assert.equal(fixture.document.querySelector("#cartOutcomePrompt")?.textContent, "Did you check out?");

  click(fixture.window, fixture.document.querySelector("#cartOutcomeMissedIt") as HTMLButtonElement);
  await turn();
  await turn();
  state = fixture.window.YoinkPopupController.state as typeof state;
  assert.equal(state.view.cartReady?.jobId, "job_cart_newer");
  assert.equal(action.textContent, "Open cart");
  assert.equal((fixture.document.querySelector("#cartOutcome") as HTMLElement).hidden, true);
  fixture.dom.window.close();
});

test("a Needs-you handoff replaces passive product context with one review action", async () => {
  const fixture = await popupHarness({
    url: "https://www.target.com/p/pokemon/-/A-94972381",
    cartReady: {
      schemaVersion: 1,
      items: [{
        schemaVersion: 1,
        kind: "needs_you",
        jobId: "job_target_review",
        retailerId: "target",
        retailerSku: "94972381",
        tabId: 42,
        recordedAt: new Date().toISOString(),
        reasonCode: "cart_unverified"
      }]
    }
  });
  assert.equal(fixture.document.querySelector("#contextEyebrow")?.textContent, "NEEDS YOU");
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "Target needs review");
  assert.equal(fixture.document.querySelector("#primaryAction")?.textContent, "Review store");
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
  assert.equal(document.activeElement?.id, "checkStoresNow");
  menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.equal(document.activeElement?.id, "checkUpdate");
  menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(document.activeElement?.id, "extensionSettings");
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

test("popup navigation options have one accurately labelled destination each", async () => {
  const fixture = await popupHarness();
  const { document, window } = fixture;
  assert.equal(document.querySelector("#openYoink")?.textContent?.trim(), "Open Yoink ›");
  click(window, document.querySelector("#openYoink") as HTMLButtonElement);
  assert.equal(document.querySelector("#statusConnections")?.textContent?.trim(), "Settings › Chrome ›");
  click(window, document.querySelector("#statusConnections") as HTMLButtonElement);
  assert.equal(document.querySelector("#extensionSettings")?.textContent, "Extension settings");
  click(window, document.querySelector("#extensionSettings") as HTMLButtonElement);
  await turn();
  assert.deepEqual(fixture.createdTabs, [
    "http://127.0.0.1:32991/#home",
    "http://127.0.0.1:32991/#settings/chrome",
    `chrome-extension://${"a".repeat(32)}/options.html`
  ]);
  assert.equal(document.querySelector("#diagnostics"), null);
  assert.equal(document.querySelector("#manageStoreAccess"), null);
  assert.equal(document.querySelectorAll("footer, #statusPanel, #activityAction").length, 3);
  assert.doesNotMatch(POPUP_HTML, /→/, "The popup uses one chevron glyph for every destination.");
  fixture.dom.window.close();
});

test("popup call-to-action buttons build on the shared button primitives", async () => {
  const fixture = await popupHarness();
  assert.equal(fixture.document.querySelector("#primaryAction")?.className, "button primary popup-cta");
  assert.equal(fixture.document.querySelector("#cartOutcomeConfirm")?.className, "button primary popup-cta");
  assert.equal(fixture.document.querySelector("#cartOutcomeGotIt")?.className, "button secondary popup-choice");
  assert.equal(fixture.document.querySelector("#cartOutcomeMissedIt")?.className, "button secondary popup-choice");
  const css = readFileSync(join(EXTENSION_ROOT, "popup.css"), "utf8");
  const custom = css.slice(css.indexOf("/* END GENERATED: YOINK TOKENS */"));
  assert.doesNotMatch(custom, /\.primary-action|\.cart-outcome-choices button/);
  assert.doesNotMatch(custom, /rgb\(\s*\d/, "Colour literals outside the generated block must come from tokens.");
  assert.match(custom, /\.popup-cta \{[^}]*min-height: 44px[^}]*\}/);
  fixture.dom.window.close();
});

test("popup review actions route to the control that can resolve them", async () => {
  const paused = await popupHarness({ health: { actionsPaused: true } });
  assert.equal(paused.document.querySelector("#contextTitle")?.textContent, "Store actions paused");
  assert.equal(paused.document.querySelector("#primaryAction")?.textContent, "Open Home");
  click(paused.window, paused.document.querySelector("#primaryAction") as HTMLButtonElement);
  await turn();
  assert.deepEqual(paused.createdTabs, ["http://127.0.0.1:32991/#home"]);

  const monitoring = await popupHarness({
    health: { executionMode: "shadow", chromeMutationEnabled: false }
  });
  assert.equal(monitoring.document.querySelector("#contextTitle")?.textContent, "Test mode");
  assert.equal(monitoring.document.querySelector("#primaryAction")?.textContent, "Open Insights");
  click(monitoring.window, monitoring.document.querySelector("#primaryAction") as HTMLButtonElement);
  await turn();
  assert.deepEqual(monitoring.createdTabs, ["http://127.0.0.1:32991/#activity/insights"]);
  paused.dom.window.close();
  monitoring.dom.window.close();
});

test("Sync products requests only TrackaLacker origins", async () => {
  const fixture = await popupHarness();
  click(fixture.window, fixture.document.querySelector("#syncProducts") as HTMLButtonElement);
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.requestCalls)), [{
    origins: ["https://trackalacker.com/*", "https://www.trackalacker.com/*"]
  }]);
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
  assert.equal(action.textContent, "Inspect again");
  assert.equal(action.getAttribute("aria-label"), "Inspect again");
  const resultStatus = fixture.document.querySelector("#contextResultStatus") as HTMLElement;
  assert.equal(resultStatus.textContent, "Check passed");
  assert.equal(resultStatus.dataset.tone, "success");
  assert.equal(resultStatus.hidden, false);
  assert.equal(action.hasAttribute("data-outcome"), false);
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
  assert.equal(action.textContent, "Update Chrome companion");
  click(fixture.window, action);
  await turn();
  await turn();
  assert.equal(fixture.document.querySelector("#contextTitle")?.textContent, "Replace extension files");
  assert.equal(action.textContent, "Reload Chrome companion");
  assert.deepEqual(fixture.session.yoinkUpdateHandoffV1, handoff);
  click(fixture.window, action);
  await turn();
  assert.equal(fixture.reloadCount(), 1);
  assert.equal(fixture.session.yoinkUpdateHandoffV1, undefined);
  fixture.dom.window.close();
});
