#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PACK_ROOT = join(ROOT, "packages", "browser-adapters", "packs");
const LOCK_PATH = join(PACK_ROOT, "lock.json");
const FIELD_NAMES = new Set([
  "addControl", "price", "seller", "availability", "fulfillmentRoot", "fulfillmentTile",
  "quantity", "primaryScope", "merchandisingScope", "secondaryActionScope", "structuredData", "offerInput"
]);
const FORBIDDEN = [":has(", ":contains(", "javascript", "url(", "expression(", "@", "<", "/"];
const FORBIDDEN_ATTRIBUTE_VALUE = /(?:checkout|buy-now|buynow|place-order|placeorder|submit-order|payment|credit|debit|address|email|phone|account|password|cookie|csrf|token)/i;
const PACK_VERSION = /^[a-z]+-pack-v\d{1,4}$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  const copy = structuredClone(value);
  delete copy.packVersion;
  return createHash("sha256").update(stable(copy)).digest("hex");
}

function lintSelector(selector, label) {
  if (typeof selector !== "string" || !selector || selector.length > 200) throw new Error(`${label} must be 1 through 200 characters.`);
  const lower = selector.toLocaleLowerCase("en-US");
  const forbidden = FORBIDDEN.find((part) => lower.includes(part));
  if (forbidden) throw new Error(`${label} contains forbidden selector content ${forbidden}.`);
  if (!/^[A-Za-z0-9_*.#=\[\]'"^$|~:()\s>-]+$/.test(selector)) throw new Error(`${label} uses unsupported CSS syntax.`);
  const withoutAllowedPseudos = selector.replace(/\[[^\]]+\]/g, "")
    .replace(/:(?:not\([^()]+\)|first-child|last-child|checked|disabled|enabled)/gi, "");
  if (withoutAllowedPseudos.includes(":")) throw new Error(`${label} uses an unsupported pseudo-class.`);
  for (const match of selector.matchAll(/\[[^\]]*(?:[*^$|~]?=)\s*(['"]?)(.*?)\1(?:\s+i)?\]/g)) {
    if (FORBIDDEN_ATTRIBUTE_VALUE.test(match[2] || "")) throw new Error(`${label} contains a forbidden attribute value token.`);
  }
  // `button#placeOrderButton` or `.checkout-btn` names the same control an
  // attribute value would, so #id and .class tokens get the same check.
  for (const match of selector.replace(/\[[^\]]*\]/g, "").matchAll(/[#.]([A-Za-z0-9_-]+)/g)) {
    if (FORBIDDEN_ATTRIBUTE_VALUE.test(match[1] || "")) throw new Error(`${label} contains a forbidden #id or .class token.`);
  }
}

function fieldsForPack(value, filename) {
  if (filename === "retailers.json") {
    if (!value.retailers || typeof value.retailers !== "object" || Array.isArray(value.retailers)) {
      throw new Error("retailers.json requires a retailers object.");
    }
    return Object.entries(value.retailers).flatMap(([retailerId, fields]) => Object.entries(fields).map(([field, selectors]) => [
      `${retailerId}.${field}`, { selectors }
    ]));
  }
  if (!value.retailerId || !value.fields || typeof value.fields !== "object" || Array.isArray(value.fields)) {
    throw new Error(`${filename} requires retailerId and fields.`);
  }
  return Object.entries(value.fields);
}

export function lintSelectorPacks({ writeLock = false, packRoot = PACK_ROOT } = {}) {
  const files = readdirSync(packRoot).filter((name) => name.endsWith(".json") && name !== "lock.json").sort();
  const previous = (() => { try { return JSON.parse(readFileSync(join(packRoot, "lock.json"), "utf8")); } catch { return { version: 1, packs: {} }; } })();
  const next = { version: 1, packs: {} };
  for (const filename of files) {
    const path = join(packRoot, filename);
    const bytes = readFileSync(path);
    if (bytes.length > 32 * 1024) throw new Error(`${filename} exceeds 32 KiB.`);
    const value = JSON.parse(bytes.toString("utf8"));
    if (!PACK_VERSION.test(String(value.packVersion || ""))) throw new Error(`${filename} has an invalid packVersion.`);
    const fields = fieldsForPack(value, filename);
    if (fields.length > (filename === "retailers.json" ? 9 * 12 : 12)) throw new Error(`${filename} has too many fields.`);
    for (const [label, fieldValue] of fields) {
      const field = label.includes(".") ? label.slice(label.lastIndexOf(".") + 1) : label;
      if (!FIELD_NAMES.has(field)) throw new Error(`${filename} contains unknown field ${label}.`);
      const selectors = fieldValue?.selectors;
      if (!Array.isArray(selectors) || selectors.length > 40) throw new Error(`${filename} ${label} must contain at most 40 selectors.`);
      selectors.forEach((selector, index) => lintSelector(selector, `${filename} ${label}[${index}]`));
    }
    const descriptor = { packVersion: value.packVersion, sha256: contentHash(value) };
    next.packs[filename] = descriptor;
    const locked = previous.packs?.[filename];
    if (!writeLock && (!locked || locked.sha256 !== descriptor.sha256 || locked.packVersion !== descriptor.packVersion)) {
      const unchangedVersion = locked?.packVersion === descriptor.packVersion;
      throw new Error(unchangedVersion
        ? `${filename} content changed without a packVersion bump.`
        : `${filename} is not reflected in lock.json; review it and run node scripts/lint-selector-packs.mjs --write-lock.`);
    }
  }
  if (!writeLock && Object.keys(previous.packs || {}).sort().join() !== files.join()) throw new Error("lock.json contains a stale pack inventory.");
  if (writeLock) writeFileSync(join(packRoot, "lock.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function packRootArgument(argv) {
  const index = argv.indexOf("--pack-root");
  return index >= 0 && argv[index + 1] ? resolve(argv[index + 1]) : PACK_ROOT;
}

try {
  lintSelectorPacks({ writeLock: process.argv.includes("--write-lock"), packRoot: packRootArgument(process.argv) });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
