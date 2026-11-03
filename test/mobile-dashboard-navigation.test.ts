import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

test("list refresh restores the same item's Want control after reorder and action changes", () => {
  const browser = new JSDOM('<div id="items"></div><button id="elsewhere">Elsewhere</button>', { runScripts: "outside-only" });
  try {
    const { document } = browser.window;
    const list = document.getElementById("items")!;
    const card = (key: string, action: string) => `<article data-ui-key="${key}"><button ${action}>Want</button><button>Details</button></article>`;
    list.innerHTML = card("first", 'data-want-listing="first"') + card("last", 'data-want-listing="last"');
    const script = read("apps/web/user.js");
    browser.window.eval(`const $ = selector => document.querySelector(selector);\n${script.slice(script.indexOf("function describeListControl("), script.indexOf("// Find's quick filters:"))}`);
    (list.lastElementChild!.firstElementChild as HTMLButtonElement).focus();
    browser.window.eval('window.restore = captureListUi("#items")');
    list.innerHTML = card("last", 'data-edit-plan="new-plan"') + card("first", 'data-want-listing="first"');
    browser.window.eval("window.restore()");
    assert.equal(document.activeElement, list.firstElementChild!.firstElementChild);
    browser.window.eval('window.restore = captureListUi("#items")');
    document.getElementById("elsewhere")!.focus();
    browser.window.eval("window.restore()");
    assert.equal(document.activeElement?.id, "elsewhere", "a refresh does not steal focus after the shopper moves on");
  } finally { browser.window.close(); }
});

test("shopper phone layout keeps a compact state and one scrollable tab row", () => {
  const html = read("apps/web/user.html");
  const css = read("apps/web/user.css");
  const script = read("apps/web/user.js");

  // The Auto-cart switch shows its state as a word and a track on every width.
  assert.match(html, /id="pauseButton"[^>]+role="switch"[^>]+aria-checked="false"/);
  assert.match(html, /id="modePill"[^>]+data-mobile-label="Loading"/);
  assert.match(script, /modePill\.dataset\.mobileLabel = label/);
  assert.match(script, /modePill\.dataset\.mobileState = stateName/);
  assert.match(css, /\.tabs \{[^}]+display: flex[^}]+overflow-x: auto/s);
  assert.match(css, /\.tab \{[^}]+flex: 0 0 auto/s);
  assert.doesNotMatch(css, /\.tabs\s*\{[^}]*grid-template-columns/s);
  assert.match(css, /\[aria-checked="true"\] > \.auto-cart-track \{ background: var\(--gradient-brand\)/);
  assert.match(css, /\.auto-cart\[data-state="test"\] > \.auto-cart-track \{ background: var\(--color-info\)/,
    "Test mode must not share the On colour");
  assert.match(css, /\.auto-cart-state \{[^}]+font-size: 12px/);
  assert.doesNotMatch(css, /\.auto-cart(?:-state|-track)?\s*\{[^}]*display: none/, "the switch stays visible on phones");
  assert.doesNotMatch(css, /\.mode-pill/);
  assert.doesNotMatch(css, /@media \(max-width: 560px\)[^{]*\{[\s\S]*?\.account-summary, \.header-boundary \{ display: none; \}/,
    "the compact header keeps the boundary visible");
  assert.match(css, /@media \(max-width: 560px\)[\s\S]+\.header-boundary \{[^}]+white-space: normal/);
});

test("admin phone layout keeps state visible and both nav rows scrollable", () => {
  const html = read("apps/web/index.html");
  const css = read("apps/web/styles.css");
  const script = read("apps/web/app.js");

  assert.match(html, /id="modeChip"[^>]+data-mobile-label="Checking"/);
  assert.match(script, /modeChip\.dataset\.mobileLabel = actionState/);
  assert.match(script, /modeChip\.dataset\.mobileState = settings\.actionsPaused/);
  assert.match(css, /\.primary-nav \{[^}]+display: flex[^}]+overflow-x: auto/s);
  assert.match(css, /\.secondary-nav \{[^}]+display: flex[^}]+overflow-x: auto/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]+\.secondary-nav \{[^}]+flex-wrap: nowrap/);
  assert.match(css, /#modeChip::before[^}]+background: var\(--mint\)/);
  assert.match(css, /#modeChip::after[^}]+content: attr\(data-mobile-label\)[^}]+font-size: 12px/);
  assert.doesNotMatch(css, /\.brand small, \.mode-chip[^}]+display: none/);
});
