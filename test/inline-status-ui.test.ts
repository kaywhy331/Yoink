import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & {
      close(): void;
      eval(source: string): unknown;
      YoinkStatus: {
        MAX_SUCCESS_TOAST_LENGTH: number;
        pushToast(root: Element, options: Record<string, unknown>): Element;
        setInlineStatus(element: Element, options: Record<string, unknown>): Element;
      };
    };
  };
};

function statusBrowser(file = "user.html") {
  const root = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(root, file), "utf8"), {
    url: file === "index.html" ? "http://127.0.0.1:32991/admin" : "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  browser.eval(`${readFileSync(join(root, "status.js"), "utf8")}\n//# sourceURL=inline-status-ui-test.js`);
  return { dom, browser };
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("errors persist beside their trigger and expose a copyable correlation reference", async () => {
  const { dom, browser } = statusBrowser();
  try {
    let copied = "";
    Object.defineProperty(browser.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; } }
    });
    const trigger = browser.document.querySelector("#saveProfileButton") as HTMLButtonElement;
    const status = browser.YoinkStatus.setInlineStatus(trigger, {
      state: "error",
      message: "The profile could not be saved. Reference req_ux06_123."
    });

    assert.equal(status.previousElementSibling, trigger);
    assert.equal(status.getAttribute("role"), "alert");
    assert.equal(status.textContent?.includes("req_ux06_123"), false);
    const copy = status.querySelector(".inline-status-action") as HTMLButtonElement;
    copy.click();
    await nextTask();
    assert.equal(copied, "req_ux06_123");
    assert.equal(copy.textContent, "Copied");

    (status.querySelector(".inline-status-dismiss") as HTMLButtonElement).click();
    assert.equal(browser.document.body.contains(status), false);
  } finally {
    dom.window.close();
  }
});

test("toast rendering caps success copy, stacks two, and keeps errors inline", () => {
  const { dom, browser } = statusBrowser("index.html");
  try {
    const root = browser.document.querySelector("#toast") as HTMLElement;
    const trigger = browser.document.querySelector("#actionsToggle") as HTMLButtonElement;
    for (const message of ["First saved.", "Second saved.", "Third saved."]) {
      browser.YoinkStatus.pushToast(root, { state: "success", message, element: trigger, durationMs: 10_000 });
    }
    const twoToasts = [...root.querySelectorAll(".toast-item")];
    assert.equal(twoToasts.length, 2);
    assert.deepEqual(twoToasts.map((item) => item.textContent), ["Second saved.", "Third saved."]);
    assert.equal(browser.YoinkStatus.MAX_SUCCESS_TOAST_LENGTH, 60);
    assert.equal(twoToasts.every((item) => (item.textContent?.length || 0) <= 60), true);

    const longSuccess = "This detailed profile propagation result belongs beside the control rather than in a fleeting toast.";
    browser.YoinkStatus.pushToast(root, { state: "success", message: longSuccess, element: trigger });
    assert.equal(root.querySelectorAll(".toast-item").length, 2);
    assert.equal(trigger.nextElementSibling?.textContent, longSuccess);

    browser.YoinkStatus.pushToast(root, {
      state: "error",
      message: "The protected update failed. Reference corr-456.",
      element: trigger
    });
    const error = trigger.nextElementSibling as HTMLElement;
    assert.equal(error.dataset.inlineStatus, "error");
    assert.match(error.textContent || "", /protected update failed/i);
    assert.equal(root.querySelectorAll(".toast-item").length, 2);
  } finally {
    dom.window.close();
  }
});

test("both dashboards load the shared status assets and route long workflow detail inline", () => {
  const root = join(process.cwd(), "apps", "web");
  for (const file of ["user.html", "index.html"]) {
    const dom = new JSDOM(readFileSync(join(root, file), "utf8"), {});
    try {
      assert.ok(dom.window.document.querySelector('script[src="/status.js"]'));
      assert.ok(dom.window.document.querySelector('link[href="/status.css"]'));
      assert.equal(dom.window.document.querySelectorAll("#toast").length, 1);
    } finally {
      dom.window.close();
    }
  }

  const shopper = readFileSync(join(root, "user.js"), "utf8");
  const admin = readFileSync(join(root, "app.js"), "utf8");
  assert.match(shopper, /setInlineStatus\(\$\("#planSummary"\),[\s\S]*stayed on Wanted/);
  assert.match(shopper, /setInlineStatus\(\$\("#storeSwitchList"\),[\s\S]*kept \$\{skipped\.length === 1 \? "its" : "their"\} stores/);
  assert.match(shopper, /Yoink adds it to your cart at \$\{watched\}/);
  assert.match(shopper, /error\.reference = reference/);
  assert.match(admin, /error\.reference = reference/);
});
