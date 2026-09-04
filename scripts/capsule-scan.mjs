#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TERMS = join(ROOT, "test", "fixtures", "capsules", "scan-terms.json");
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scanCapsuleHtml(html, termConfig = { names: [] }) {
  const hits = [];
  const emailCount = [...String(html).matchAll(EMAIL)].length;
  const phoneCount = [...String(html).matchAll(PHONE)].length;
  if (emailCount) hits.push({ kind: "email", count: emailCount });
  if (phoneCount) hits.push({ kind: "phone", count: phoneCount });
  const names = Array.isArray(termConfig) ? termConfig : termConfig?.names;
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw || "").trim();
    if (name.length < 2) continue;
    const matches = String(html).match(new RegExp(`\\b${escapePattern(name)}\\b`, "gi"));
    if (matches?.length) hits.push({ kind: "name", term: name, count: matches.length });
  }
  return hits;
}

export function scanCapsuleFile(path, termsPath = DEFAULT_TERMS) {
  const bytes = readFileSync(resolve(path));
  const html = path.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  let terms = { names: [] };
  try { terms = JSON.parse(readFileSync(resolve(termsPath), "utf8")); } catch { /* an empty list is safe */ }
  return scanCapsuleHtml(html, terms);
}

async function main(argv) {
  const path = argv[0];
  const termsIndex = argv.indexOf("--terms");
  const termsPath = termsIndex >= 0 ? argv[termsIndex + 1] : DEFAULT_TERMS;
  if (!path || !termsPath) {
    process.stderr.write("Usage: capsule-scan <html-or-gzip> [--terms path]\n");
    return 2;
  }
  try {
    const hits = scanCapsuleFile(path, termsPath);
    process.stdout.write(`${JSON.stringify({ clean: hits.length === 0, hits })}\n`);
    return hits.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
