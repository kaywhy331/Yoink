import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tokenPath = resolve(root, "apps/web/tokens.css");
const targets = [
  resolve(root, "apps/extension/popup.css"),
  resolve(root, "apps/extension/options.css"),
];
const start = "/* GENERATED: YOINK TOKENS — DO NOT EDIT */";
const end = "/* END GENERATED: YOINK TOKENS */";

const colorNames = [
  "ground", "canvas", "surface", "surface-raised", "ink", "muted", "subtle", "rule",
  "accent", "accent-bright", "accent-strong", "accent-soft", "admin-accent", "admin-accent-strong",
  "admin-accent-soft", "violet", "violet-strong", "violet-soft", "good", "good-soft",
  "warning", "warning-soft", "bad", "bad-soft", "info", "info-soft", "on-accent", "inverse-surface",
  "inverse-ink", "inverse-muted", "store-target", "store-target-ink", "store-walmart", "store-walmart-ink",
  "store-amazon", "store-amazon-ink", "store-bestbuy", "store-bestbuy-ink",
];
const scalarNames = [
  "font-sans", "font-mono", "text-xs", "text-sm", "text-md", "text-lg", "text-xl",
  "text-2xl", "text-hero", "radius-sm", "radius-md", "radius-lg", "radius-xl", "radius-2xl", "space-1", "space-2",
  "space-3", "space-4", "space-5", "space-6", "space-7", "space-8", "space-10",
];
const rgbNames = ["ground", "surface", "ink", "accent", "accent-bright", "admin-accent", "violet", "warning", "bad", "info", "overlay"];

function declaration(source, name) {
  const match = source.match(new RegExp(`\\s--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing --${name} in ${tokenPath}`);
  return match[1].trim();
}

function rgb(hex, name) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`--${name} must be a six-digit hex color in tokens.css`);
  const value = Number.parseInt(match[1], 16);
  return `rgb(${value >> 16} ${(value >> 8) & 255} ${value & 255})`;
}

function generatedBlock(source) {
  const declarations = ["  color-scheme: dark;"];
  for (const name of colorNames) {
    declarations.push(`  --color-${name}: ${rgb(declaration(source, `theme-${name}-dark`), name)};`);
  }
  for (const name of rgbNames) declarations.push(`  --rgb-${name}: ${declaration(source, `theme-rgb-${name}-dark`)};`);
  declarations.push("  --rgb-inverse-ink: 255 255 255;");
  for (const name of scalarNames) declarations.push(`  --${name}: ${declaration(source, name)};`);
  declarations.push(
    "  --bg: var(--color-ground);",
    "  --surface: var(--color-surface);",
    "  --surface-raised: var(--color-surface-raised);",
    "  --line: var(--color-rule);",
    "  --text: var(--color-ink);",
    "  --muted: var(--color-muted);",
    "  --accent: var(--color-accent);",
    "  --accent-text: var(--color-on-accent);",
    "  --warning: var(--color-warning);",
    "  --danger: var(--color-bad);",
    "  --focus: var(--color-accent);",
    "  font: var(--text-md)/1.4 var(--font-sans);",
    "  background: var(--color-ground);",
    "  color: var(--color-ink);",
  );
  return `${start}\n:root {\n${declarations.join("\n")}\n}\n\n` +
    `:where(.button) { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--color-rule); border-radius: var(--radius-lg); padding: 9px 14px; color: var(--color-ink); background: var(--color-surface-raised); font: 750 var(--text-xs)/1.35 var(--font-sans); text-decoration: none; cursor: pointer; }\n` +
    `:where(.button.primary) { border-color: var(--color-accent); color: var(--color-on-accent); background: var(--color-accent); }\n` +
    `:where(.button.secondary, .button.quiet) { border-color: var(--color-rule); }\n` +
    `:where(.button.danger) { color: var(--color-bad); background: var(--color-bad-soft); }\n` +
    `:where(.button:disabled) { cursor: not-allowed; opacity: .48; }\n` +
    `:where(.tag, .chip) { display: inline-flex; width: fit-content; align-items: center; border-radius: 999px; padding: 4px 8px; color: var(--color-muted); background: var(--color-surface-raised); font: 750 var(--text-xs)/1.3 var(--font-sans); }\n` +
    `:where(.tag.good, .chip.good) { color: var(--color-good); background: var(--color-good-soft); }\n` +
    `:where(dialog) { border: 1px solid var(--color-rule); border-radius: var(--radius-lg); color: var(--color-ink); background: var(--color-surface); box-shadow: 0 24px 80px rgb(var(--rgb-overlay) / 32%); }\n` +
    `:where(dialog::backdrop) { background: rgb(var(--rgb-overlay) / 58%); }\n${end}`;
}

const check = process.argv.includes("--check");
const source = await readFile(tokenPath, "utf8");
const block = generatedBlock(source);
let stale = false;

for (const target of targets) {
  const existing = await readFile(target, "utf8");
  const blockStart = existing.indexOf(start);
  const blockEnd = existing.indexOf(end, blockStart + start.length);
  if (blockStart < 0 || blockEnd < 0) throw new Error(`${target} is missing the generated token markers`);
  const next = `${existing.slice(0, blockStart)}${block}${existing.slice(blockEnd + end.length)}`;
  if (next === existing) continue;
  stale = true;
  if (!check) await writeFile(target, next);
}

if (check && stale) {
  console.error("Extension CSS tokens are stale. Run node scripts/generate-extension-tokens.mjs.");
  process.exitCode = 1;
}
