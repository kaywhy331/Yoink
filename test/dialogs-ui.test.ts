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
      YoinkDialogs: {
        confirmDialog(options: Record<string, unknown>): Promise<{ confirmed: boolean; note: string }>;
      };
    };
  };
};

function dialogBrowser() {
  const root = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(root, "user.html"), "utf8"), {
    url: "http://127.0.0.1:32991/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const prototype = browser.HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof prototype.showModal !== "function") {
    prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  }
  if (typeof prototype.close !== "function") {
    prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  }
  browser.eval(`${readFileSync(join(root, "dialogs.js"), "utf8")}\n//# sourceURL=dialogs-ui-test.js`);
  return { dom, browser };
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("the shared confirmation dialog validates notes and returns focus", async () => {
  const { dom, browser } = dialogBrowser();
  try {
    const opener = browser.document.createElement("button");
    opener.textContent = "Open decision";
    browser.document.body.append(opener);
    opener.focus();

    const resultPromise = browser.YoinkDialogs.confirmDialog({
      title: "Approve this listing?",
      summary: "The exact proposal will be applied.",
      scope: ["Exact store identity only", "No checkout authority"],
      note: {
        label: "Review note",
        required: true,
        helper: "Do not include account data."
      },
      confirmLabel: "Approve listing"
    });
    await nextTask();

    const dialog = browser.document.querySelector("#confirmDialog") as HTMLDialogElement;
    const form = browser.document.querySelector("#confirmDialogForm") as HTMLFormElement;
    const note = browser.document.querySelector("#confirmDialogNote") as HTMLTextAreaElement;
    const error = browser.document.querySelector("#confirmDialogError") as HTMLElement;
    assert.equal(dialog.open, true);
    assert.equal(browser.document.querySelector("#confirmDialogTitle")?.textContent, "Approve this listing?");
    assert.deepEqual(
      [...browser.document.querySelectorAll("#confirmDialogScope li")].map((item) => item.textContent),
      ["Exact store identity only", "No checkout authority"]
    );
    assert.equal(note.required, true);
    assert.equal(browser.document.activeElement, note);

    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(error.hidden, false);
    assert.match(error.textContent ?? "", /required note/i);
    assert.equal(note.getAttribute("aria-invalid"), "true");

    note.value = "Matched the independent exact identifier.";
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    const result = await resultPromise;
    assert.equal(result.confirmed, true);
    assert.equal(result.note, "Matched the independent exact identifier.");
    await nextTask();
    assert.equal(dialog.open, false);
    assert.equal(browser.document.activeElement, opener);
  } finally {
    dom.window.close();
  }
});

test("Escape cancels and Tab remains trapped inside the confirmation dialog", async () => {
  const { dom, browser } = dialogBrowser();
  try {
    const opener = browser.document.createElement("button");
    browser.document.body.append(opener);
    opener.focus();
    const resultPromise = browser.YoinkDialogs.confirmDialog({
      title: "Delete plan?",
      confirmLabel: "Delete plan",
      danger: true
    });
    await nextTask();

    const cancel = browser.document.querySelector("#confirmDialogCancel") as HTMLButtonElement;
    const submit = browser.document.querySelector("#confirmDialogSubmit") as HTMLButtonElement;
    assert.equal(submit.classList.contains("danger"), true);
    submit.focus();
    submit.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    assert.equal(browser.document.activeElement, cancel);
    cancel.dispatchEvent(new browser.KeyboardEvent("keydown", {
      key: "Tab", shiftKey: true, bubbles: true, cancelable: true
    }));
    assert.equal(browser.document.activeElement, submit);

    browser.document.dispatchEvent(new browser.KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true
    }));
    const result = await resultPromise;
    assert.equal(result.confirmed, false);
    assert.equal(result.note, "");
    await nextTask();
    assert.equal(browser.document.activeElement, opener);
  } finally {
    dom.window.close();
  }
});

test("loading dialogs.js on a page without #confirmDialog does not throw on keydown", () => {
  const root = join(process.cwd(), "apps", "web");
  const dom = new JSDOM(readFileSync(join(root, "docs.html"), "utf8"), {
    url: "http://127.0.0.1:32991/docs",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  try {
    assert.equal(browser.document.querySelector("#confirmDialog"), null);
    const errors: string[] = [];
    browser.addEventListener("error", (event) => {
      event.preventDefault();
      errors.push(String(event.error?.message || event.message));
    });
    browser.eval(`${readFileSync(join(root, "dialogs.js"), "utf8")}\n//# sourceURL=dialogs-ui-no-dialog.js`);
    assert.equal(typeof browser.YoinkDialogs.confirmDialog, "function");
    for (const init of [{ key: "Escape" }, { key: "Tab" }, { key: "Tab", shiftKey: true }, { key: "a" }]) {
      browser.document.dispatchEvent(new browser.KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
    }
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
  }
});

test("both dashboards expose exactly one shared confirmation surface and no native dialogs", () => {
  const root = join(process.cwd(), "apps", "web");
  for (const file of ["user.html", "index.html"]) {
    const html = readFileSync(join(root, file), "utf8");
    const dom = new JSDOM(html, {});
    try {
      assert.equal(dom.window.document.querySelectorAll("#confirmDialog").length, 1);
      assert.equal(dom.window.document.querySelector('script[src="/dialogs.js"]') !== null, true);
      assert.equal(dom.window.document.querySelector('link[href="/dialogs.css"]') !== null, true);
    } finally {
      dom.window.close();
    }
  }
  for (const file of ["user.js", "app.js"]) {
    const source = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(source, /\b(?:confirm|prompt)\s*\(/);
  }
});
