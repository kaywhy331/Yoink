import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("shopper phone layout keeps a compact state and one scrollable tab row", () => {
  const html = read("apps/web/user.html");
  const css = read("apps/web/user.css");
  const script = read("apps/web/user.js");

  assert.match(html, /id="modePill"[^>]+data-mobile-label="Loading"/);
  assert.match(script, /modePill\.dataset\.mobileLabel = modeLabel/);
  assert.match(script, /modePill\.dataset\.mobileState = paused \? "paused" : settings\.executionMode === "live" \? "ready" : "monitoring"/);
  assert.match(css, /\.tabs \{[^}]+display: flex[^}]+overflow-x: auto/s);
  assert.match(css, /\.tab \{[^}]+flex: 0 0 auto/s);
  assert.doesNotMatch(css, /\.tabs\s*\{[^}]*grid-template-columns/s);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]+\.mode-pill::before[^}]+background: var\(--green\)/);
  assert.match(css, /\.mode-pill::after[^}]+content: attr\(data-mobile-label\)[^}]+font-size: 12px/);
  assert.match(css, /\.mode-pill\[data-mobile-state="paused"\]::before[^}]+background: var\(--amber\)/);
  assert.match(css, /\.mode-pill\[data-mobile-state="monitoring"\]::before[^}]+background: var\(--muted\)/,
    "Test mode must not share the Running dot colour on phones");
  assert.doesNotMatch(css, /\.brand small, \.mode-pill[^}]+display: none/);
  assert.doesNotMatch(css, /@media \(max-width: 560px\)[^{]*\{[\s\S]*?\.account-summary, \.header-boundary \{ display: none; \}/,
    "the compact header keeps the account summary and the boundary visible");
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
