import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis & { close(): void } };
};

const root = join(process.cwd(), "apps", "web");

function pageCopy(file: string) {
  const dom = new JSDOM(readFileSync(join(root, file), "utf8"));
  const document = dom.window.document;
  document.querySelectorAll("script, style").forEach((node) => node.remove());
  const text = (document.body.textContent || "").replace(/\s+/g, " ").trim();
  return { dom, document, text, words: text ? text.split(/\s+/).length : 0 };
}

test("dashboard static copy stays within the reviewed budgets", () => {
  const shopper = pageCopy("user.html");
  const admin = pageCopy("index.html");
  try {
    // Includes browser/detail dialogs, notification history and Insights filter controls.
    // The checkout correction/refund dialog adds 45 static words in its own modal.
    const correctionWords = (shopper.document.querySelector("#checkoutReportDialog")?.textContent || "").trim().split(/\s+/).length;
    assert.ok(correctionWords <= 50, `checkout correction dialog copy is ${correctionWords} words`);
    // Each workspace still has a separate cap; users see one workspace at a time.
    for (const panel of shopper.document.querySelectorAll(".workspace")) {
      const words = (panel.textContent || "").trim().split(/\s+/).length;
      assert.ok(words < 200, `${panel.getAttribute("data-panel")} copy is ${words} words`);
    }
    assert.ok(shopper.words < 650, `shopper static copy is ${shopper.words} words`);
    assert.ok(admin.words < 1_200, `admin static copy is ${admin.words} words`);
  } finally {
    shopper.dom.window.close();
    admin.dom.window.close();
  }
});

test("each dashboard has one linked boundary and concise panel introductions", () => {
  for (const file of ["user.html", "index.html"]) {
    const page = pageCopy(file);
    try {
      assert.equal((page.text.match(/Checkout stays manual\./g) || []).length, 1, file);
      const boundary = page.document.querySelector('.header-boundary a[href="/docs#safety-boundaries"]');
      assert.ok(boundary, `${file} should link its one boundary to the rationale`);
      for (const intro of page.document.querySelectorAll(
        ".panel-heading p:not(.eyebrow), .section-heading p:not(.eyebrow), .page-heading p:not(.eyebrow)"
      )) {
        const value = (intro.textContent || "").trim();
        assert.ok(value.length <= 90, `${file} intro exceeds 90 characters: ${value}`);
      }
    } finally {
      page.dom.window.close();
    }
  }
});

test("boundary rationale lives in docs and popup copy does not repeat it", () => {
  const docs = new JSDOM(readFileSync(join(root, "docs.html"), "utf8"));
  try {
    assert.ok(docs.window.document.querySelector("#safety-boundaries"));
    assert.match(docs.window.document.querySelector("#safety-boundaries")?.textContent || "", /Independent store checks/);
  } finally {
    docs.window.close();
  }

  const popup = readFileSync(join(process.cwd(), "packages", "extension-ui", "src", "popup-state.ts"), "utf8");
  const shopper = readFileSync(join(root, "user.js"), "utf8");
  assert.doesNotMatch(popup, /Checkout stays manual/i);
  assert.doesNotMatch(shopper, /Checkout stays manual/i);
});
