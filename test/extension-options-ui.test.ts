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

const ROOT = join(process.cwd(), "apps", "extension");
const HTML = readFileSync(join(ROOT, "options.html"), "utf8");
const POPUP_STATE = readFileSync(join(ROOT, "popup-state.js"), "utf8");
const OPTIONS = readFileSync(join(ROOT, "options.js"), "utf8");

function click(window: Window, element: Element): void {
  const MouseEventConstructor = (window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  element.dispatchEvent(new MouseEventConstructor("click", { bubbles: true }));
}

async function turn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface OptionsHarnessOptions {
  paired?: boolean;
  connected?: boolean;
  planFailuresBeforeSuccess?: number;
}

async function optionsHarness(options: OptionsHarnessOptions = {}) {
  const dom = new JSDOM(HTML, {
    url: `chrome-extension://${"a".repeat(32)}/options.html`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const window = dom.window;
  const granted = new Set(["https://www.target.com/*"]);
  const requested: string[][] = [];
  const removed: string[][] = [];
  const messages: Array<Record<string, unknown>> = [];
  let planFailures = options.planFailuresBeforeSuccess ?? 0;
  let confirmCalls = 0;
  Object.assign(window, {
    confirm: () => { confirmCalls += 1; return true; },
    chrome: {
      runtime: {
        sendMessage: async (message: Record<string, unknown>) => {
          messages.push(message);
          if (message.type === "yoink:check-health") {
            return { ok: true, state: { paired: options.paired !== false, connected: options.connected !== false } };
          }
          if (message.type === "yoink:delete-local-data") {
            return { ok: true, deleted: true, verified: true };
          }
          if (message.type === "yoink:get-reverification-plan") {
            if (planFailures > 0) {
              planFailures -= 1;
              return { ok: false, message: "Plan unavailable." };
            }
            return {
              ok: true,
              plan: {
                lanes: [
                  { retailerId: "target", qualification: { status: "retired", warning: "version_changed" }, candidate: { retailerSku: "94972381" } },
                  { retailerId: "walmart", qualification: { status: "qualified", warning: "expiring" }, candidate: { retailerSku: "20252562938" } }
                ]
              }
            };
          }
          if (message.type === "yoink:reverify-retailer-lanes") {
            return {
              ok: true,
              results: (message.retailerIds as string[]).map((retailerId) => ({ retailerId, outcome: "passed" }))
            };
          }
          return { ok: false };
        }
      },
      permissions: {
        contains: async ({ origins }: { origins: string[] }) => origins.every((origin) => granted.has(origin)),
        request: async ({ origins }: { origins: string[] }) => {
          requested.push(origins);
          origins.forEach((origin) => granted.add(origin));
          return true;
        },
        remove: async ({ origins }: { origins: string[] }) => {
          removed.push(origins);
          origins.forEach((origin) => granted.delete(origin));
          return true;
        }
      }
    }
  });
  window.eval(`globalThis.YoinkRuntimeConfig = Object.freeze({
    profile: "local",
    appOrigin: "http://127.0.0.1:32991",
    localPackageUpdates: true
  });`);
  window.eval(`${POPUP_STATE}\nglobalThis.YoinkPopupStateModule = YoinkPopupStateModule;`);
  await window.eval(`(async () => { ${OPTIONS} })()`);
  return {
    dom,
    window,
    document: window.document,
    requested,
    removed,
    messages,
    confirmCalls: () => confirmCalls
  };
}

test("extension settings manage exact store permissions and verified local deletion", async () => {
  const fixture = await optionsHarness();
  const { window, document, requested, removed, messages } = fixture;

  assert.equal(document.title, "Extension settings");
  assert.equal(document.querySelector("h1")?.textContent, "Extension settings");
  assert.equal(document.querySelector("#store-access, #lane-readiness"), null, "Unused anchors were removed.");
  assert.equal(document.querySelector("#pairState")?.textContent, "Paired · Ready");
  assert.equal(document.querySelectorAll("#permissionList .permission-row").length, 13);
  const openYoink = document.querySelector("#openYoink") as HTMLAnchorElement;
  assert.equal(openYoink.href, "http://127.0.0.1:32991/#home");
  assert.equal(openYoink.textContent, "Open Yoink");
  assert.equal(openYoink.target, "_blank");
  assert.equal(openYoink.rel, "noopener");

  const target = [...document.querySelectorAll("#permissionList .permission-row")]
    .find((row) => row.querySelector("strong")?.textContent === "Target");
  assert.ok(target);
  click(window, target.querySelector("button") as HTMLButtonElement);
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(removed)), [["https://www.target.com/*"]]);
  assert.equal(target.querySelector("button")?.textContent, "Allow");

  const walmart = [...document.querySelectorAll("#permissionList .permission-row")]
    .find((row) => row.querySelector("strong")?.textContent === "Walmart");
  assert.ok(walmart);
  click(window, walmart.querySelector("button") as HTMLButtonElement);
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(requested)), [["https://*.walmart.com/*"]]);
  assert.equal(walmart.querySelector("button")?.textContent, "Remove");

  assert.equal(document.querySelector("#laneReadinessState")?.textContent, "2 of 2 ready");
  assert.equal((document.querySelector("#laneReadinessRetry") as HTMLButtonElement).hidden, true);
  assert.equal(document.querySelector("#reverifyLanes"), null);
  assert.equal(document.querySelectorAll("#laneReadinessList .lane-readiness-row").length, 2);
  const targetCheck = document.querySelector('[data-reverify-retailer="target"]') as HTMLElement;
  assert.match(targetCheck.textContent ?? "", /Check Target again without adding to cart/);
  click(window, targetCheck.querySelector("button") as HTMLButtonElement);
  await turn();
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(requested.at(-1))), ["https://www.target.com/*"]);
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.filter((message) => message.type === "yoink:reverify-retailer-lanes").at(-1)
  )), {
    type: "yoink:reverify-retailer-lanes",
    retailerIds: ["target"]
  });
  assert.equal(
    targetCheck.querySelector("[data-lane-status]")?.textContent,
    "Passed · no click"
  );

  click(window, walmart.querySelector("button") as HTMLButtonElement);
  await turn();
  const walmartCheck = document.querySelector('[data-reverify-retailer="walmart"]') as HTMLElement;
  click(window, walmartCheck.querySelector("button") as HTMLButtonElement);
  await turn();
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(requested.at(-1))), ["https://*.walmart.com/*"]);
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.filter((message) => message.type === "yoink:reverify-retailer-lanes").at(-1)
  )), { type: "yoink:reverify-retailer-lanes", retailerIds: ["walmart"] });
  assert.equal(walmartCheck.querySelector("[data-lane-status]")?.textContent, "Passed · no click");

  const deleteButton = document.querySelector("#deleteLocalData") as HTMLButtonElement;
  const cancelButton = document.querySelector("#cancelDeleteLocalData") as HTMLButtonElement;
  const deletionResult = document.querySelector("#deletionResult") as HTMLElement;
  assert.equal(deleteButton.textContent, "Delete local extension data");
  assert.equal(cancelButton.hidden, true);

  click(window, deleteButton);
  await turn();
  assert.equal(messages.some((message) => message.type === "yoink:delete-local-data"), false,
    "The first click only arms the deletion.");
  assert.equal(deleteButton.textContent, "Confirm delete");
  assert.equal(cancelButton.hidden, false);
  assert.match(deletionResult.textContent ?? "", /Your Yoink account data stays\./);

  click(window, cancelButton);
  assert.equal(deleteButton.textContent, "Delete local extension data");
  assert.equal(cancelButton.hidden, true);
  assert.equal(deletionResult.textContent, "");
  assert.equal(document.activeElement, deleteButton);

  click(window, deleteButton);
  assert.equal(deleteButton.textContent, "Confirm delete");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(deleteButton.textContent, "Delete local extension data");
  assert.equal(cancelButton.hidden, true);

  click(window, deleteButton);
  click(window, deleteButton);
  await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.find((message) => message.type === "yoink:delete-local-data")
  )), {
    type: "yoink:delete-local-data",
    confirmation: "DELETE_ALL_LOCAL_YOINK_DATA"
  });
  assert.equal(messages.filter((message) => message.type === "yoink:delete-local-data").length, 1);
  assert.equal(deletionResult.textContent, "Local extension data deleted and the receipt was verified.");
  assert.equal(deleteButton.textContent, "Delete local extension data");
  assert.equal(cancelButton.hidden, true);
  assert.equal(fixture.confirmCalls(), 0, "Deletion confirms inline instead of through a native dialog.");
  fixture.dom.window.close();
});

test("an unpaired profile is sent to Settings › Chrome in a new tab, and a lost Yoink is named", async () => {
  const unpaired = await optionsHarness({ paired: false });
  assert.equal(unpaired.document.querySelector("#pairState")?.textContent, "Not paired");
  const pairLink = unpaired.document.querySelector("#openYoink") as HTMLAnchorElement;
  assert.equal(pairLink.href, "http://127.0.0.1:32991/#settings/chrome");
  assert.equal(pairLink.textContent, "Open Yoink › Settings › Chrome");
  assert.equal(pairLink.target, "_blank");
  unpaired.dom.window.close();

  const disconnected = await optionsHarness({ connected: false });
  assert.equal(disconnected.document.querySelector("#pairState")?.textContent, "Paired · Yoink unavailable");
  assert.equal((disconnected.document.querySelector("#openYoink") as HTMLAnchorElement).href, "http://127.0.0.1:32991/#home");
  disconnected.dom.window.close();
});

test("a store-check plan that cannot load offers a retry", async () => {
  const fixture = await optionsHarness({ planFailuresBeforeSuccess: 1 });
  const { window, document } = fixture;
  const retry = document.querySelector("#laneReadinessRetry") as HTMLButtonElement;
  assert.equal(document.querySelector("#laneReadinessState")?.textContent, "Unavailable");
  assert.equal(retry.hidden, false);
  assert.equal(document.querySelectorAll("#laneReadinessList .lane-readiness-row").length, 0);

  click(window, retry);
  await turn();
  assert.equal(document.querySelector("#laneReadinessState")?.textContent, "2 of 2 ready");
  assert.equal(retry.hidden, true);
  assert.equal(document.querySelectorAll("#laneReadinessList .lane-readiness-row").length, 2);
  assert.equal(fixture.messages.filter((message) => message.type === "yoink:get-reverification-plan").length, 2);
  fixture.dom.window.close();
});
