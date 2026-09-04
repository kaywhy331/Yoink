#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.ts";
import { YoinkDatabase } from "../packages/database/src/database.ts";
import { classifyAdapterDiagnostic } from "../packages/domain/src/adapter-diagnostic-class.ts";
import { loadCapsule, replayCapsuleObject } from "./replay-capsule.mjs";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_ATTRIBUTES = [
  "id", "class", "role", "name", "type", "disabled", "aria-label",
  "data-test", "data-testid", "data-test-id", "data-automation-id", "itemprop"
];
const SENSITIVE_VALUE = /(?:account|password|cookie|csrf|token|payment|credit|debit|address|email|phone)/i;
const INTENT = /(?:add(?:\s+to)?\s+(?:cart|bag)|atc|price|amount|cost|seller|merchant|vendor|sold\s+by|fulfill|shipping|delivery|pickup)/i;

function parseArguments(argv) {
  const options = {
    identifier: "",
    dataDirectory: resolve(process.env.YOINK_DATA_DIR || join(ROOT, "data")),
    databasePath: "",
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") options.json = true;
    else if (["--data-dir", "--database"].includes(value)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value.`);
      index += 1;
      if (value === "--data-dir") options.dataDirectory = resolve(next);
      else options.databasePath = resolve(next);
    } else if (value.startsWith("--")) throw new Error(`Unknown option ${value}.`);
    else if (!options.identifier) options.identifier = value;
    else throw new Error("Only one repair incident can be inspected at a time.");
  }
  if (!options.identifier) throw new Error("Provide an incident id, store:fingerprint, or capsule id.");
  options.databasePath = options.databasePath
    || resolve(process.env.YOINK_DATABASE_PATH || join(options.dataDirectory, "yoink.sqlite"));
  return options;
}

function readIndex(dataDirectory) {
  const path = join(dataDirectory, "evidence", "index.json");
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, "utf8"));
  return (Array.isArray(value) ? value : value.items) || [];
}

function snapshotHtml(capsule) {
  return gunzipSync(Buffer.from(String(capsule?.snapshot?.html || ""), "base64"), {
    maxOutputLength: 64 * 1024 * 1024
  }).toString("utf8");
}

function packField(reasonCode, failureStage) {
  const value = `${reasonCode} ${failureStage}`;
  if (/add_control/.test(value)) return "addControl";
  if (/price/.test(value)) return "price";
  if (/seller/.test(value)) return "seller";
  if (/fulfillment/.test(value)) return "fulfillmentTile";
  if (/availability|out_of_stock/.test(value)) return "availability";
  if (/offer|sku|route/.test(value)) return "offerInput";
  if (/quantity/.test(value)) return "quantity";
  return "primaryScope";
}

function traceStep(failureStage) {
  return ({
    page_identity: "page_identity",
    interactive_block: "interactive_block",
    availability_binding: "availability",
    offer_binding: "offer_scope",
    add_control: "add_control",
    sku_binding: "sku_binding",
    price_binding: "price",
    seller_binding: "seller",
    fulfillment_binding: "fulfillment",
    quantity_binding: "quantity",
    route_binding: "route"
  })[failureStage] || failureStage;
}

function packSelectors(retailerId, field) {
  if (["target", "walmart", "amazon", "bestbuy"].includes(retailerId)) {
    const pack = JSON.parse(readFileSync(join(ROOT, "packages", "browser-adapters", "packs", `${retailerId}.json`), "utf8"));
    return pack.fields?.[field]?.selectors || [];
  }
  const pack = JSON.parse(readFileSync(join(ROOT, "packages", "browser-adapters", "packs", "retailers.json"), "utf8"));
  return pack.retailers?.[retailerId]?.[field] || [];
}

export function repairCandidates(html, url) {
  const dom = new JSDOM(html, { url });
  const results = [];
  const selector = "button, input, select, [role='button'], [data-test], [data-testid], [data-test-id], [data-automation-id], [itemprop], [aria-label]";
  for (const element of dom.window.document.querySelectorAll(selector)) {
    const attributes = {};
    for (const name of ALLOWED_ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      const value = String(element.getAttribute(name) || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!SENSITIVE_VALUE.test(value)) attributes[name] = value;
    }
    const text = String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const intentText = `${element.tagName} ${Object.values(attributes).join(" ")} ${text}`;
    if (!INTENT.test(intentText)) continue;
    results.push({ tag: element.tagName.toLocaleLowerCase("en-US"), attributes, text });
    if (results.length >= 40) break;
  }
  dom.window.close();
  return results;
}

function findContext(options, entries, db) {
  const queue = db ? new AdapterDiagnosticRepository(db).listRepairQueue(2_000) : [];
  let retailerId = "";
  let operation = "";
  let fingerprint = "";
  let incident = null;
  let directCapsule = null;
  if (options.identifier.startsWith("cap_")) {
    directCapsule = entries.find((entry) => entry.id === options.identifier);
    if (!directCapsule) throw new Error(`Capsule ${options.identifier} was not found.`);
    ({ retailerId, operation, layoutFingerprint: fingerprint } = directCapsule);
  } else if (options.identifier.includes(":")) {
    [retailerId, fingerprint] = options.identifier.split(":", 2);
  } else {
    if (!db) throw new Error("The local database is required to resolve an incident id.");
    incident = db.get(
      `SELECT id, status, title, summary, retailer_id AS retailerId, operation,
              failure_stage AS failureStage, reason_code AS reasonCode,
              layout_fingerprint AS layoutFingerprint
       FROM operator_alert_incidents WHERE id = ?`,
      options.identifier
    );
    if (!incident) throw new Error(`Incident ${options.identifier} was not found.`);
    retailerId = incident.retailerId;
    operation = incident.operation;
    fingerprint = incident.layoutFingerprint;
  }
  const matchingGroups = queue.filter((item) => item.retailerId === retailerId
    && (!operation || item.operation === operation)
    && (item.layoutFingerprint === fingerprint || item.layoutFingerprint.startsWith(fingerprint)));
  if (matchingGroups.length > 1) throw new Error("The fingerprint prefix matches more than one repair group.");
  const group = matchingGroups[0] || null;
  if (group) {
    operation = group.operation;
    fingerprint = group.layoutFingerprint;
  }
  const capsules = entries.filter((entry) => entry.retailerId === retailerId
    && (!operation || entry.operation === operation)
    && (entry.layoutFingerprint === fingerprint || entry.id === directCapsule?.id))
    .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)));
  if (!capsules.length) throw new Error("No local evidence capsule is attached to this repair group.");
  return { incident, group, capsules, retailerId, operation, fingerprint };
}

export async function inspectRepair(options) {
  const entries = readIndex(options.dataDirectory);
  let db = null;
  if (existsSync(options.databasePath)) {
    db = new YoinkDatabase(options.databasePath, { readOnly: true, migrationMode: "require_current" });
  }
  try {
    const context = findContext(options, entries, db);
    const capsuleEntry = context.capsules[0];
    const capsule = loadCapsule(capsuleEntry.id, options.dataDirectory);
    const replay = await replayCapsuleObject(capsule, { bundle: false });
    const failureStage = context.group?.failureStage || capsule.failureStage;
    const reasonCode = context.group?.reasonCode || capsule.reasonCode;
    const field = packField(reasonCode, failureStage);
    const step = traceStep(failureStage);
    const filteredTrace = replay.trace.filter((entry) => entry.step === step);
    const selectors = packSelectors(context.retailerId, field).map((selector) => {
      const trace = replay.trace.find((entry) => entry.selector === selector);
      return {
        selector,
        matched: trace?.matched ?? 0,
        visible: trace?.visible ?? 0,
        scoped: trace?.scoped ?? 0
      };
    });
    const candidates = repairCandidates(snapshotHtml(capsule), capsule.url);
    const diagnosticClass = context.group?.diagnosticClass || classifyAdapterDiagnostic(replay.actual);
    const slug = `${context.retailerId}-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-${context.fingerprint.slice(0, 8)}`;
    const promoteCommand = `npm run capsule:promote -- ${capsuleEntry.id} --slug ${slug} --expect-outcome ${replay.actual.outcome} --expect-stage ${replay.actual.failureStage} --expect-reason ${replay.actual.reasonCode}`;
    return {
      incident: {
        id: context.incident?.id || "",
        status: context.incident?.status || context.group?.status || "unlinked",
        summary: context.incident?.summary || `${context.retailerId} ${context.operation} repair group`,
        retailerId: context.retailerId,
        operation: context.operation,
        layoutFingerprint: context.fingerprint,
        diagnosticClass,
        failureStage,
        reasonCode
      },
      capsules: context.capsules.map((entry) => ({
        id: entry.id,
        capturedAt: entry.capturedAt,
        observerVersion: entry.observerVersion,
        addAdapterVersion: entry.addAdapterVersion,
        packVersion: entry.packVersion,
        extensionVersion: entry.extensionVersion
      })),
      replay: { recorded: replay.recorded, actual: replay.actual, reproduced: replay.reproduced },
      failingTrace: filteredTrace,
      pack: { field, selectors },
      candidates,
      promoteCommand
    };
  } finally {
    db?.close();
  }
}

function printRepair(result) {
  process.stdout.write(`Incident ${result.incident.id || result.incident.layoutFingerprint}\n`);
  process.stdout.write(`${result.incident.summary}\n`);
  process.stdout.write(`class: ${result.incident.diagnosticClass} · status: ${result.incident.status}\n`);
  process.stdout.write(`failure: ${result.incident.failureStage} · ${result.incident.reasonCode}\n`);
  process.stdout.write("Capsules:\n");
  for (const capsule of result.capsules) {
    process.stdout.write(`- ${capsule.id} · ${capsule.capturedAt} · observer ${capsule.observerVersion} · add ${capsule.addAdapterVersion} · pack ${capsule.packVersion} · companion ${capsule.extensionVersion}\n`);
  }
  process.stdout.write(`Replay: ${result.replay.actual.outcome} · ${result.replay.actual.failureStage} · ${result.replay.actual.reasonCode} · reproduced ${result.replay.reproduced ? "yes" : "no"}\n`);
  process.stdout.write(`Pack field: ${result.pack.field}\nPackaged selectors:\n`);
  for (const selector of result.pack.selectors) {
    process.stdout.write(`- ${selector.selector} · matched ${selector.matched} · visible ${selector.visible} · scoped ${selector.scoped}\n`);
  }
  process.stdout.write(`Trace for ${result.incident.failureStage}:\n${JSON.stringify(result.failingTrace, null, 2)}\n`);
  process.stdout.write(`Candidates (${result.candidates.length}):\n${JSON.stringify(result.candidates, null, 2)}\n`);
  process.stdout.write(`Promote: ${result.promoteCommand}\n`);
}

export async function runRepairCli(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    const result = await inspectRepair(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else printRepair(result);
    return result.replay.reproduced ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runRepairCli();
}
