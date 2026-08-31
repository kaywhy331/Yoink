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

test("extension settings manage exact store permissions and verified local deletion", async () => {
  const dom = new JSDOM(HTML, {
    url: `chrome-extension://${"a".repeat(32)}/options.html#store-access`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const window = dom.window;
  const granted = new Set(["https://www.target.com/*"]);
  const requested: string[][] = [];
  const removed: string[][] = [];
  const messages: Array<Record<string, unknown>> = [];
  Object.assign(window, {
    confirm: () => true,
    chrome: {
      runtime: {
        sendMessage: async (message: Record<string, unknown>) => {
          messages.push(message);
          if (message.type === "yoink:check-health") {
            return { ok: true, state: { paired: true, connected: true } };
          }
          if (message.type === "yoink:delete-local-data") {
            return { ok: true, deleted: true, verified: true };
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

  assert.equal(window.document.querySelector("#pairState")?.textContent, "Paired · Ready");
  assert.equal(window.document.querySelectorAll(".permission-row").length, 13);
  assert.equal((window.document.querySelector("#openYoink") as HTMLAnchorElement).href, "http://127.0.0.1:32991/");

  const target = [...window.document.querySelectorAll(".permission-row")]
    .find((row) => row.querySelector("strong")?.textContent === "Target");
  assert.ok(target);
  click(window, target.querySelector("button") as HTMLButtonElement);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(removed)), [["https://www.target.com/*"]]);
  assert.equal(target.querySelector("button")?.textContent, "Allow");

  const walmart = [...window.document.querySelectorAll(".permission-row")]
    .find((row) => row.querySelector("strong")?.textContent === "Walmart");
  assert.ok(walmart);
  click(window, walmart.querySelector("button") as HTMLButtonElement);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(requested)), [["https://*.walmart.com/*"]]);
  assert.equal(walmart.querySelector("button")?.textContent, "Remove");

  click(window, window.document.querySelector("#deleteLocalData") as HTMLButtonElement);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.find((message) => message.type === "yoink:delete-local-data")
  )), {
    type: "yoink:delete-local-data",
    confirmation: "DELETE_ALL_LOCAL_YOINK_DATA"
  });
  assert.equal(
    window.document.querySelector("#deletionResult")?.textContent,
    "Local extension data deleted and the receipt was verified."
  );
  dom.window.close();
});
