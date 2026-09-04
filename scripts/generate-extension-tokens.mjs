import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { transform } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const tokenPath = resolve(root, "apps/web/tokens.css");
const contractPath = resolve(root, "packages/contracts/src/index.ts");
const addLanesPath = resolve(root, "packages/contracts/src/add-lanes.ts");
const adapterVersionsPath = resolve(root, "apps/extension/adapter-versions.js");
const selectorPackRoot = resolve(root, "packages/browser-adapters/packs");
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

function contractVersions(source, addLanes) {
  const constants = Object.fromEntries([...source.matchAll(
    /export const ([A-Z][A-Z0-9_]+(?:OBSERVER|ADAPTER)_VERSION) = "([^"]+)";/g
  )].map((match) => [match[1], match[2]]));
  const observerBlock = source.match(/export const RETAILER_OBSERVER_VERSIONS = \{([\s\S]*?)\n\} as const;/)?.[1];
  if (!observerBlock) throw new Error(`Missing RETAILER_OBSERVER_VERSIONS in ${contractPath}`);
  const observer = {};
  for (const match of observerBlock.matchAll(/^\s*([a-z0-9]+):\s*([A-Z0-9_]+),?$/gm)) {
    if (!constants[match[2]]) throw new Error(`Missing ${match[2]} in ${contractPath}`);
    observer[match[1]] = constants[match[2]];
  }
  const add = Object.fromEntries(Object.entries(addLanes)
    .map(([retailerId, lane]) => [retailerId, lane.contractVersion]));
  if (Object.values(add).some((value) => !value) || !constants.WALMART_DRAW_OBSERVER_VERSION) {
    throw new Error(`Missing add or Walmart Draw versions in ${contractPath}`);
  }
  return { observer, add, walmartDrawObserver: constants.WALMART_DRAW_OBSERVER_VERSION };
}

async function selectorPackVersions() {
  const versions = {};
  const files = (await readdir(selectorPackRoot)).filter((name) => name.endsWith(".json") && name !== "lock.json");
  for (const name of files) {
    const pack = JSON.parse(await readFile(resolve(selectorPackRoot, name), "utf8"));
    if (typeof pack.retailerId === "string") versions[pack.retailerId] = pack.packVersion;
    for (const retailerId of Object.keys(pack.retailers || {})) versions[retailerId] = pack.packVersion;
  }
  return versions;
}

function generatedAdapterVersions(source, pack, addLanes) {
  const versions = contractVersions(source, addLanes);
  for (const [retailerId, lane] of Object.entries(addLanes)) {
    if (versions.observer[retailerId] !== lane.observerVersion || pack[retailerId] !== lane.packVersion) {
      throw new Error(`Add-lane ${retailerId} versions do not match the observer and selector-pack contracts.`);
    }
  }
  return `"use strict";\n\n// GENERATED by scripts/generate-extension-tokens.mjs from contracts. DO NOT EDIT.\n` +
    `globalThis.YoinkAdapterVersions = Object.freeze({\n` +
    `  observer: Object.freeze(${JSON.stringify(versions.observer, null, 2).replaceAll("\n", "\n  ")}),\n` +
    `  add: Object.freeze(${JSON.stringify(versions.add, null, 2).replaceAll("\n", "\n  ")}),\n` +
    `  pack: Object.freeze(${JSON.stringify(Object.fromEntries(Object.keys(versions.observer).map((id) => [id, pack[id]])), null, 2).replaceAll("\n", "\n  ")}),\n` +
    `  walmartDrawObserver: ${JSON.stringify(versions.walmartDrawObserver)}\n` +
    `});\n`;
}

const check = process.argv.includes("--check");
const source = await readFile(tokenPath, "utf8");
const contracts = await readFile(contractPath, "utf8");
const addLanesSource = await readFile(addLanesPath, "utf8");
const compiledAddLanes = await transform(addLanesSource, { loader: "ts", format: "esm", target: "es2023" });
const addLanesModule = await import(`data:text/javascript;base64,${Buffer.from(compiledAddLanes.code).toString("base64")}`);
const addLanes = addLanesModule.ADD_LANES;
const block = generatedBlock(source);
const adapterVersions = generatedAdapterVersions(contracts, await selectorPackVersions(), addLanes);
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

const existingAdapterVersions = await readFile(adapterVersionsPath, "utf8").catch(() => "");
if (existingAdapterVersions !== adapterVersions) {
  stale = true;
  if (!check) await writeFile(adapterVersionsPath, adapterVersions);
}

if (check && stale) {
  console.error("Generated extension tokens or adapter versions are stale. Run node scripts/generate-extension-tokens.mjs.");
  process.exitCode = 1;
}
