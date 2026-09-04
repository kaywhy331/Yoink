#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCapsule } from "./replay-capsule.mjs";
import { scanCapsuleHtml } from "./capsule-scan.mjs";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(ROOT, "test", "fixtures", "capsules");
const PROMOTED_MAX_BYTES = Math.floor(1.5 * 1024 * 1024);

function parseArguments(argv) {
  const options = {
    identifier: "", slug: "", outcome: "", stage: "", reason: "", allowReason: "", notes: "",
    stripStyles: false, dataDirectory: process.env.YOINK_DATA_DIR || join(ROOT, "data"), outputDirectory: DEFAULT_OUTPUT,
    observation: {}
  };
  const values = new Map([
    ["--slug", "slug"], ["--expect-outcome", "outcome"], ["--expect-stage", "stage"],
    ["--expect-reason", "reason"], ["--allow", "allowReason"], ["--notes", "notes"],
    ["--data-dir", "dataDirectory"], ["--output-dir", "outputDirectory"]
  ]);
  const observationValues = new Map([
    ["--expect-availability", "availability"], ["--expect-price-cents", "unitPriceCents"],
    ["--expect-seller-type", "sellerType"], ["--expect-fulfillment", "fulfillment"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--strip-styles") options.stripStyles = true;
    else if (values.has(value) || observationValues.has(value)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value.`);
      index += 1;
      if (values.has(value)) options[values.get(value)] = next;
      else options.observation[observationValues.get(value)] = value === "--expect-price-cents" ? Number(next) : next;
    } else if (value.startsWith("--")) throw new Error(`Unknown option ${value}.`);
    else if (!options.identifier) options.identifier = value;
    else throw new Error("Only one capsule can be promoted at a time.");
  }
  options.dataDirectory = resolve(options.dataDirectory);
  options.outputDirectory = resolve(options.outputDirectory);
  if (!options.identifier || !options.slug || !options.outcome || !options.stage || !options.reason) {
    throw new Error("A capsule, --slug, --expect-outcome, --expect-stage, and --expect-reason are required.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)) throw new Error("--slug must be lowercase kebab-case.");
  if (Object.hasOwn(options.observation, "unitPriceCents")
    && (!Number.isSafeInteger(options.observation.unitPriceCents) || options.observation.unitPriceCents <= 0)) {
    throw new Error("--expect-price-cents must be a positive integer.");
  }
  return options;
}

function fixtureCount(root) {
  if (!existsSync(root)) return 0;
  const visit = (directory) => readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
    const path = join(directory, entry.name);
    return count + (entry.isDirectory() ? visit(path) : entry.isFile() && entry.name.endsWith(".json") && entry.name !== "scan-terms.json" ? 1 : 0);
  }, 0);
  return visit(root);
}

function terms(outputDirectory) {
  for (const path of [join(outputDirectory, "scan-terms.json"), join(DEFAULT_OUTPUT, "scan-terms.json")]) {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { /* try the next path */ }
  }
  return { names: [] };
}

function decodeSnapshot(capsule) {
  if (capsule?.snapshot?.encoding !== "gzip+base64" || !capsule.snapshot.html) {
    throw new Error("The capsule snapshot is unreadable.");
  }
  return gunzipSync(Buffer.from(capsule.snapshot.html, "base64"), { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8");
}

export async function promoteCapsule(options) {
  const capsule = loadCapsule(options.identifier, options.dataDirectory);
  const html = decodeSnapshot(capsule);
  const dom = new JSDOM(html, { url: capsule.url });
  const { sanitizeEvidenceDocument, serializeEvidenceDocument } = await import("../apps/extension/src/evidence-capsule.ts");
  const sanitized = sanitizeEvidenceDocument(dom.window.document, {
    isVisible(element) { return element.getAttribute("data-yoink-vis") === "1"; },
    rect(element) {
      const parts = String(element.getAttribute("data-yoink-rect") || "0,0,0,0").split(",").map(Number);
      return { x: parts[0] || 0, y: parts[1] || 0, width: parts[2] || 0, height: parts[3] || 0 };
    }
  });
  if (options.stripStyles) {
    for (const style of sanitized.document.querySelectorAll("style")) style.remove();
  }
  const cleanHtml = serializeEvidenceDocument(sanitized.document);
  const hits = scanCapsuleHtml(cleanHtml, terms(options.outputDirectory));
  if (hits.length && !String(options.allowReason || "").trim()) {
    const error = new Error(`Privacy scan refused promotion: ${hits.map((hit) => `${hit.kind}(${hit.count})`).join(", ")}. Use --allow with a recorded reason after review.`);
    error.code = "scan_refused";
    throw error;
  }
  const compressed = gzipSync(Buffer.from(cleanHtml, "utf8"), { level: 9 });
  if (compressed.length > PROMOTED_MAX_BYTES) {
    const error = new Error("The promoted snapshot exceeds 1.5 MiB gzipped. Retry with --strip-styles.");
    error.code = "fixture_too_large";
    throw error;
  }
  const retailerDirectory = join(options.outputDirectory, capsule.retailerId);
  const htmlPath = join(retailerDirectory, `${options.slug}.html.gz`);
  const metadataPath = join(retailerDirectory, `${options.slug}.json`);
  if (existsSync(htmlPath) || existsSync(metadataPath)) throw new Error("A promoted fixture with this store and slug already exists.");
  if (fixtureCount(options.outputDirectory) >= 80) throw new Error("The promoted capsule corpus is limited to 80 fixtures.");
  mkdirSync(retailerDirectory, { recursive: true });
  const sha256 = createHash("sha256").update(compressed).digest("hex");
  const metadata = {
    capsuleId: capsule.id,
    capturedAt: capsule.capturedAt,
    url: capsule.url,
    retailerId: capsule.retailerId,
    retailerSku: capsule.retailerSku,
    operation: capsule.operation,
    requiredFulfillment: capsule.requiredFulfillment || "shipping",
    observerVersion: capsule.observerVersion,
    addAdapterVersion: capsule.addAdapterVersion,
    packVersion: capsule.packVersion || "",
    sha256,
    expectations: {
      outcome: options.outcome,
      failureStage: options.stage,
      reasonCode: options.reason,
      ...options.observation
    },
    notes: String(options.notes || "Promoted from a local evidence capsule.").slice(0, 500),
    allowReason: hits.length ? String(options.allowReason).trim().slice(0, 500) : ""
  };
  writeFileSync(htmlPath, compressed, { flag: "wx", mode: 0o600 });
  try {
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    try { await import("node:fs/promises").then(({ unlink }) => unlink(htmlPath)); } catch { /* best effort rollback */ }
    throw error;
  }
  return { htmlPath, metadataPath, metadata, scanHits: hits };
}

export async function runPromoteCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
    const result = await promoteCapsule(options);
    process.stdout.write(`${JSON.stringify({ promoted: true, html: result.htmlPath, metadata: result.metadataPath })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return error?.code === "scan_refused" || error?.code === "fixture_too_large" ? 1 : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runPromoteCli();
}
