#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.ts";
import { YoinkDatabase } from "../packages/database/src/database.ts";
import { classifyAdapterDiagnostic } from "../packages/domain/src/adapter-diagnostic-class.ts";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.ts";
import { loadCapsule, replayCapsuleObject } from "./replay-capsule.mjs";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACK_ROOT = join(ROOT, "packages", "browser-adapters", "packs");
// The lane registry repeats each add lane's pack version and the token
// generator refuses to build when the two disagree, so a pack bump has to
// land in both places at once.
const REGISTRY_PATH = join(ROOT, "packages", "contracts", "src", "add-lanes.ts");
// The contracts module exports each pack version as a constant as well; the
// selector-pack test refuses a tree where it disagrees with the pack file.
const CONTRACTS_PATH = join(ROOT, "packages", "contracts", "src", "index.ts");
const ADD_PACK_RETAILERS = new Set(["target", "walmart", "amazon", "bestbuy"]);
const OBSERVE_ONLY_FIELDS = new Set(["addControl", "price", "seller"]);
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
    json: false,
    selector: "",
    packRoot: PACK_ROOT,
    registryPath: REGISTRY_PATH,
    contractsPath: CONTRACTS_PATH
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") options.json = true;
    else if (["--data-dir", "--database", "--apply", "--pack-root", "--registry", "--contracts"].includes(value)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value.`);
      index += 1;
      if (value === "--data-dir") options.dataDirectory = resolve(next);
      else if (value === "--database") options.databasePath = resolve(next);
      else if (value === "--apply") options.selector = next;
      else if (value === "--registry") options.registryPath = resolve(next);
      else if (value === "--contracts") options.contractsPath = resolve(next);
      else options.packRoot = resolve(next);
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

function packSelectors(retailerId, field, packRoot = PACK_ROOT) {
  if (ADD_PACK_RETAILERS.has(retailerId)) {
    const pack = JSON.parse(readFileSync(join(packRoot, `${retailerId}.json`), "utf8"));
    return pack.fields?.[field]?.selectors || [];
  }
  const pack = JSON.parse(readFileSync(join(packRoot, "retailers.json"), "utf8"));
  return pack.retailers?.[retailerId]?.[field] || [];
}

function bumpedPackVersion(current) {
  const match = /^([a-z]+)-pack-v(\d{1,4})$/.exec(String(current || ""));
  if (!match) throw new Error(`The pack version ${current} cannot be bumped.`);
  return `${match[1]}-pack-v${Number(match[2]) + 1}`;
}

// Keeps the hand-maintained one-line-per-field layout so a one-selector
// repair reads as a one-line diff.
function formatPack(pack, addPack) {
  if (addPack) {
    const fields = Object.entries(pack.fields || {})
      .map(([field, value]) => `    ${JSON.stringify(field)}: { "selectors": ${JSON.stringify(value.selectors || [])} }`)
      .join(",\n");
    return `{\n  "packVersion": ${JSON.stringify(pack.packVersion)},\n  "retailerId": ${JSON.stringify(pack.retailerId)},\n  "fields": {\n${fields}\n  }\n}\n`;
  }
  const retailers = Object.entries(pack.retailers || {}).map(([retailerId, fields]) => {
    const lines = Object.entries(fields).map(([field, selectors]) => `      ${JSON.stringify(field)}: ${JSON.stringify(selectors)}`).join(",\n");
    return `    ${JSON.stringify(retailerId)}: {\n${lines}\n    }`;
  }).join(",\n");
  return `{\n  "packVersion": ${JSON.stringify(pack.packVersion)},\n  "retailers": {\n${retailers}\n  }\n}\n`;
}

function runCommand(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  return { status: result.status ?? 1, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
}

const DEFAULT_APPLY_HOOKS = {
  lint(packRoot) {
    return runCommand(process.execPath, ["scripts/lint-selector-packs.mjs", "--write-lock", "--pack-root", packRoot]);
  },
  regenerate() {
    return runCommand(process.execPath, ["scripts/generate-extension-tokens.mjs"]);
  },
  replay(capsuleId, dataDirectory) {
    return runCommand(process.execPath, ["--import", "tsx", "scripts/replay-capsule.mjs", capsuleId, "--expect", "pass", "--data-dir", dataDirectory]);
  }
};

/**
 * Applies one selector to the failing pack field, bumps the pack version,
 * rewrites the lock, regenerates the packaged version file, and replays the
 * capsule in a fresh process. A replay that does not pass restores the pack
 * so the tree never carries an unproven selector.
 */
export async function applyRepair(options, hooks = {}) {
  const apply = { ...DEFAULT_APPLY_HOOKS, ...hooks };
  const selector = String(options.selector || "").trim();
  if (!selector) throw new Error("--apply requires a selector.");
  const inspection = await inspectRepair(options);
  const { retailerId } = inspection.incident;
  const field = inspection.pack.field;
  const packRoot = options.packRoot || PACK_ROOT;
  const addPack = ADD_PACK_RETAILERS.has(retailerId);
  if (!addPack && !OBSERVE_ONLY_FIELDS.has(field)) {
    throw new Error(`The ${retailerId} pack cannot express the ${field} field; repair the adapter source instead.`);
  }
  const packPath = join(packRoot, addPack ? `${retailerId}.json` : "retailers.json");
  const lockPath = join(packRoot, "lock.json");
  const registryPath = options.registryPath || REGISTRY_PATH;
  const contractsPath = options.contractsPath || CONTRACTS_PATH;
  const backups = [
    [packPath, `${packPath}.repair-backup`],
    [lockPath, `${lockPath}.repair-backup`],
    [contractsPath, `${contractsPath}.repair-backup`],
    [registryPath, `${registryPath}.repair-backup`]
  ];
  for (const [source, backup] of backups) if (existsSync(source)) copyFileSync(source, backup);
  const discardBackups = () => {
    for (const [, backup] of backups) if (existsSync(backup)) unlinkSync(backup);
  };
  const restore = () => {
    for (const [source, backup] of backups) if (existsSync(backup)) copyFileSync(backup, source);
    discardBackups();
  };
  const pack = JSON.parse(readFileSync(packPath, "utf8"));
  const previousVersion = pack.packVersion;
  const selectors = addPack
    ? (pack.fields[field] ??= { selectors: [] }).selectors
    : (pack.retailers[retailerId] ??= {})[field] ??= [];
  const alreadyPresent = selectors.includes(selector);
  if (!alreadyPresent) selectors.push(selector);
  pack.packVersion = bumpedPackVersion(previousVersion);
  writeFileSync(packPath, formatPack(pack, addPack));
  // A per-store pack is declared by exactly one add lane. The shared
  // retailers pack is declared by every add lane built on it, and the token
  // generator refuses a registry where any of them still names the old
  // version, so all of them move together (observe-only stores declare none).
  const registry = readFileSync(registryPath, "utf8");
  const declaration = `packVersion: "${previousVersion}"`;
  const declarations = registry.split(declaration).length - 1;
  const sharingLanes = Object.values(ADD_LANES).filter((lane) => lane.packVersion === previousVersion).length;
  if (addPack ? declarations !== 1 : declarations !== sharingLanes) {
    restore();
    throw new Error(`The lane registry does not declare ${previousVersion} for ${retailerId}; repair the registry by hand.`);
  }
  if (declarations > 0) writeFileSync(registryPath, registry.replaceAll(declaration, `packVersion: "${pack.packVersion}"`));
  const contracts = readFileSync(contractsPath, "utf8").split("\n");
  const constantLine = contracts.findIndex((line) => /SELECTOR_PACK_VERSION = "/.test(line) && line.includes(`"${previousVersion}"`));
  if (constantLine < 0) {
    restore();
    throw new Error(`The contracts module does not export ${previousVersion}; repair the constant by hand.`);
  }
  contracts[constantLine] = contracts[constantLine].replace(`"${previousVersion}"`, `"${pack.packVersion}"`);
  writeFileSync(contractsPath, contracts.join("\n"));
  const steps = [];
  const fail = (step, output) => {
    restore();
    apply.regenerate();
    return { applied: false, retailerId, field, selector, previousVersion, packVersion: previousVersion, failedStep: step, output, steps };
  };
  const lint = apply.lint(packRoot);
  steps.push({ step: "lint", status: lint.status });
  if (lint.status !== 0) return fail("lint", lint.output);
  const regenerate = apply.regenerate();
  steps.push({ step: "regenerate", status: regenerate.status });
  if (regenerate.status !== 0) return fail("regenerate", regenerate.output);
  const capsuleId = inspection.capsules[0].id;
  const replay = apply.replay(capsuleId, options.dataDirectory);
  steps.push({ step: "replay", status: replay.status });
  if (replay.status !== 0) return fail("replay", replay.output);
  discardBackups();
  const slug = `${retailerId}-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-${inspection.incident.layoutFingerprint.slice(0, 8)}`;
  return {
    applied: true,
    retailerId,
    field,
    selector,
    alreadyPresent,
    previousVersion,
    packVersion: pack.packVersion,
    capsuleId,
    steps,
    promoteCommand: `npm run capsule:promote -- ${capsuleId} --slug ${slug} --expect-outcome passed --expect-stage complete --expect-reason verified`,
    nextSteps: [
      "npm run test:adapters",
      "npm run release:local",
      "Check stores now in the companion menu, then confirm the incident shows Fixed, waiting for a live check"
    ]
  };
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
    const selectors = packSelectors(context.retailerId, field, options.packRoot || PACK_ROOT).map((selector) => {
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

function printApply(result) {
  if (!result.applied) {
    process.stdout.write(`Not applied: ${result.failedStep} failed for ${result.retailerId} ${result.field}; the pack was restored to ${result.previousVersion}.\n${result.output}\n`);
    return;
  }
  process.stdout.write(`Applied ${result.selector} to ${result.retailerId} ${result.field}${result.alreadyPresent ? " (already listed)" : ""}: ${result.previousVersion} -> ${result.packVersion}\n`);
  process.stdout.write(`Replay of ${result.capsuleId} passed under the edited pack.\nPromote: ${result.promoteCommand}\nNext:\n`);
  for (const step of result.nextSteps) process.stdout.write(`- ${step}\n`);
}

export async function runRepairCli(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    if (options.selector) {
      const applied = await applyRepair(options);
      if (options.json) process.stdout.write(`${JSON.stringify(applied)}\n`);
      else printApply(applied);
      return applied.applied ? 0 : 1;
    }
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
