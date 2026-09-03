import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const cssFiles = [
  "apps/web/components.css",
  "apps/web/dialogs.css",
  "apps/web/docs.css",
  "apps/web/status.css",
  "apps/web/styles.css",
  "apps/web/tokens.css",
  "apps/web/user.css",
  "apps/extension/options.css",
  "apps/extension/popup.css"
];

const tokens = readFileSync(join(process.cwd(), "apps/web/tokens.css"), "utf8");
const textTokens = new Map(
  [...tokens.matchAll(/(--text-[\w-]+):\s*([0-9]*\.?[0-9]+)px;/g)].map((match) => [match[1]!, Number(match[2])])
);

// rem/em resolve against the file's own :root font size: a px value, a --text-* token
// (the extension roots use var(--text-md), 14px), or the browser default of 16px.
function rootFontSize(css: string): number {
  for (const block of css.matchAll(/:root[^{}]*\{([^{}]*)\}/g)) {
    const declaration = /(?:^|[\s;{])font(?:-size)?\s*:\s*([^;]+)/.exec(block[1]!);
    if (!declaration) continue;
    const px = /(?:^|\s)([0-9]*\.?[0-9]+)px(?=\/|\s|$)/.exec(declaration[1]!.trim());
    if (px) return Number(px[1]);
    const token = /var\((--text-[\w-]+)\)/.exec(declaration[1]!);
    if (token && textTokens.has(token[1]!)) return textTokens.get(token[1]!)!;
  }
  return 16;
}

// Size of a font-size value or the size slot of a font: shorthand, in px; null when it is not a length we lint.
function sizeInPixels(value: string, base: number): number | null {
  const head = value.split("/")[0]!.trim();
  const length = /(?:^|\s)([0-9]*\.?[0-9]+)(px|rem|em)$/.exec(head) || /(?:^|\s)([0-9]*\.?[0-9]+)(px|rem|em)(?=\s)/.exec(head);
  if (length) return length[2] === "px" ? Number(length[1]) : Number(length[1]) * base;
  const token = /var\((--text-[\w-]+)\)/.exec(head);
  if (token && textTokens.has(token[1]!)) return textTokens.get(token[1]!)!;
  return null;
}

test("dashboard and extension CSS never set readable text below 12px", () => {
  const failures: string[] = [];
  for (const file of cssFiles) {
    const css = readFileSync(join(process.cwd(), file), "utf8");
    const base = rootFontSize(css);
    const line = (index: number) => css.slice(0, index).split("\n").length;
    const report = (index: number, property: string, value: string, pixels: number) =>
      failures.push(`${file}:${line(index)} sets ${property}: ${value} (${Number(pixels.toFixed(2))}px at a ${base}px root)`);
    for (const match of css.matchAll(/font-size\s*:\s*([^;{}]+)/g)) {
      const value = match[1]!.trim();
      const pixels = sizeInPixels(value, base);
      if (pixels !== null && pixels < 12) report(match.index!, "font-size", value, pixels);
    }
    for (const match of css.matchAll(/(?:^|[\s;{])font\s*:\s*([^;{}]+)/g)) {
      const value = match[1]!.trim();
      const pixels = sizeInPixels(value, base);
      if (pixels !== null && pixels < 12) report(match.index!, "font", value, pixels);
    }
  }
  assert.deepEqual(failures, []);
});

test("labels and supporting copy are at least 12px", () => {
  const admin = readFileSync(join(process.cwd(), "apps/web/styles.css"), "utf8");
  const shopper = readFileSync(join(process.cwd(), "apps/web/user.css"), "utf8");
  const components = readFileSync(join(process.cwd(), "apps/web/components.css"), "utf8");
  assert.match(components, /:where\(small\)\s*\{[^}]+font-size:\s*inherit/,
    "The browser's relative <small> default must not shrink 12px rows to roughly 10px.");
  assert.match(admin, /\.decision-pill[^}]+font-size: 12px/s);
  assert.match(components, /:where\(\.tag, \.chip\)[^}]+var\(--text-xs\)/s);
  assert.match(admin, /\.operator-alert-detail[^}]+font-size: 12px/s);
  assert.match(admin, /\.adapter-repair-row code[^}]+font-size: 12px/s);
  assert.match(admin, /\.fine-print[^}]+font-size: 12px/s);
  assert.match(admin, /\.qualification-check p[^}]+font-size: 12px/s);
  assert.match(admin, /\.readiness-step p[^}]+font-size: 12px/s);
  assert.match(shopper, /\.setup-preflight span[^}]+font-size: 12px/s);
  assert.match(shopper, /\.preflight-costs small[^}]+font-size: 12px/s);
  assert.match(shopper, /\.automation-readiness li small[^}]+font-size: 12px/s);
});
