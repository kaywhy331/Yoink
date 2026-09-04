#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADD_RETAILERS = new Set(["target", "walmart", "amazon", "bestbuy"]);
const POLICY_REASONS = new Set([
  "out_of_stock", "third_party_seller", "over_unit_cap", "fulfillment_not_supported",
  "seller_policy_not_supported", "quantity_not_supported", "unsupported_action", "job_expired"
]);

function parseArguments(argv) {
  const options = {
    identifiers: [], fulfillment: "", json: false, expectation: "", bundle: false,
    all: false, retailerId: "", dataDirectory: process.env.YOINK_DATA_DIR || join(ROOT, "data")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") options.json = true;
    else if (value === "--bundle") options.bundle = true;
    else if (value === "--all") options.all = true;
    else if (["--fulfillment", "--expect", "--retailer", "--data-dir"].includes(value)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value.`);
      index += 1;
      if (value === "--fulfillment") options.fulfillment = next;
      if (value === "--expect") options.expectation = next;
      if (value === "--retailer") options.retailerId = next;
      if (value === "--data-dir") options.dataDirectory = resolve(next);
    } else if (value.startsWith("--")) throw new Error(`Unknown option ${value}.`);
    else options.identifiers.push(value);
  }
  if (options.fulfillment && !["shipping", "pickup"].includes(options.fulfillment)) {
    throw new Error("--fulfillment must be shipping or pickup.");
  }
  if (options.expectation && !["reproduce", "pass"].includes(options.expectation)) {
    throw new Error("--expect must be reproduce or pass.");
  }
  return options;
}

function decodeJsonFile(path) {
  const bytes = readFileSync(path);
  const decoded = path.endsWith(".gz") ? gunzipSync(bytes) : bytes;
  return JSON.parse(decoded.toString("utf8"));
}

export function loadCapsule(identifier, dataDirectory = join(ROOT, "data")) {
  if (!identifier) throw new Error("A capsule id or path is required.");
  const direct = resolve(identifier);
  if (identifier.includes("/") || identifier.endsWith(".json") || identifier.endsWith(".gz")) {
    return decodeJsonFile(direct);
  }
  const evidenceRoot = join(resolve(dataDirectory), "evidence");
  const indexPath = join(evidenceRoot, "index.json");
  const indexValue = JSON.parse(readFileSync(indexPath, "utf8"));
  const items = Array.isArray(indexValue) ? indexValue : indexValue.items;
  const entry = Array.isArray(items) ? items.find((candidate) => candidate?.id === identifier) : null;
  if (!entry?.path) throw new Error(`Capsule ${identifier} was not found.`);
  const path = resolve(evidenceRoot, String(entry.path));
  if (path !== evidenceRoot && !path.startsWith(`${evidenceRoot}/`)) throw new Error("The capsule index contains an unsafe path.");
  return decodeJsonFile(path);
}

function snapshotHtml(capsule) {
  if (capsule?.snapshot?.encoding !== "gzip+base64" || !capsule.snapshot.html) {
    throw new Error("The capsule snapshot is unreadable.");
  }
  return gunzipSync(Buffer.from(capsule.snapshot.html, "base64"), { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8");
}

function failureStage(reason) {
  if (["offer_id_missing_or_ambiguous", "offer_binding_changed"].includes(reason)) return "offer_binding";
  if (["add_control_unavailable", "add_control_changed"].includes(reason)) return "add_control";
  if (reason === "seller_unverified") return "seller_binding";
  if (reason === "price_unavailable") return "price_binding";
  if (["fulfillment_unverified", "fulfillment_selection_failed"].includes(reason)) return "fulfillment_binding";
  if (["listing_mismatch", "product_page_unverified"].includes(reason)) return "page_identity";
  return "runner";
}

function buildRehearsalJob(capsule, observation, versions) {
  const price = Number(observation.unitPriceCents);
  if (!Number.isSafeInteger(price) || price <= 0) return null;
  const expectedSeller = capsule.retailerId === "walmart" ? "Walmart"
    : capsule.retailerId === "amazon" ? "Amazon.com"
      : capsule.retailerId === "bestbuy" ? "Best Buy" : "Target";
  return {
    adapterVersion: versions[capsule.retailerId],
    contractVersion: 1,
    jobId: `replay_${String(capsule.id).slice(0, 100)}`,
    retailerId: capsule.retailerId,
    retailerSku: capsule.retailerSku,
    canonicalUrl: capsule.url,
    action: "add_to_cart",
    quantity: 1,
    maxUnitPriceCents: price,
    maxOrderTotalCents: price,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller,
    fulfillment: capsule.requiredFulfillment === "pickup" ? "pickup" : "shipping",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

async function sourceRuntime() {
  const [contracts, retailerShadow, targetShadow, targetAction, walmartAction, amazonAction, bestBuyAction] = await Promise.all([
    import("../packages/contracts/src/index.ts"),
    import("../apps/extension/src/retailer-shadow.ts"),
    import("../apps/extension/src/target-shadow.ts"),
    import("../apps/extension/src/target-action.ts"),
    import("../apps/extension/src/walmart-action.ts"),
    import("../apps/extension/src/amazon-action.ts"),
    import("../apps/extension/src/bestbuy-action.ts")
  ]);
  return {
    contracts,
    addLanes: contracts.ADD_LANES,
    collect: {
      target: targetShadow.collectTargetShadowAttempt,
      retailer: retailerShadow.collectRetailerShadowAttempt
    },
    rehearse: {
      target: targetAction.rehearseTargetAdd,
      walmart: walmartAction.rehearseWalmartAdd,
      amazon: amazonAction.rehearseAmazonAdd,
      bestbuy: bestBuyAction.rehearseBestBuyAdd
    }
  };
}

async function bundleRuntime(dom, retailerId) {
  const window = dom.window;
  window.eval(readFileSync(join(ROOT, "apps", "extension", "add-lanes.js"), "utf8"));
  const shadowName = retailerId === "target" ? "target-shadow.js" : "retailer-shadow.js";
  window.eval(readFileSync(join(ROOT, "apps", "extension", shadowName), "utf8"));
  if (ADD_RETAILERS.has(retailerId)) window.eval(readFileSync(join(ROOT, "apps", "extension", `${retailerId}-action.js`), "utf8"));
  return {
    addLanes: window.YoinkAddLaneRegistryModule?.ADD_LANES,
    collect: {
      target: window.YoinkTargetShadow?.collectTargetShadowAttempt,
      retailer: window.YoinkRetailerShadow?.collectRetailerShadowAttempt
    },
    rehearse: {
      target: window.YoinkTargetAction?.rehearseTargetAdd,
      walmart: window.YoinkWalmartAction?.rehearseWalmartAdd,
      amazon: window.YoinkAmazonAction?.rehearseAmazonAdd,
      bestbuy: window.YoinkBestBuyAction?.rehearseBestBuyAdd
    }
  };
}

export async function replayCapsuleObject(capsule, options = {}) {
  const html = options.html ?? snapshotHtml(capsule);
  const fulfillment = options.fulfillment || capsule.requiredFulfillment || "shipping";
  const dom = new JSDOM(html, { url: capsule.url, runScripts: "outside-only" });
  const runtime = options.bundle ? await bundleRuntime(dom, capsule.retailerId) : await sourceRuntime();
  const trace = [];
  const environment = {
    trace: { record(entry) { trace.push(entry); } },
    isVisible(element) { return element.getAttribute("data-yoink-vis") === "1"; }
  };
  const collect = capsule.retailerId === "target" ? runtime.collect.target : runtime.collect.retailer;
  if (typeof collect !== "function") throw new Error(`No replay adapter exists for ${capsule.retailerId}.`);
  const attempt = capsule.retailerId === "target"
    ? collect(dom.window.document, capsule.url, fulfillment, 1, false, environment)
    : collect(dom.window.document, capsule.url, capsule.retailerId, fulfillment, 1, false, environment);
  const collectedTrace = Array.isArray(attempt.trace) ? attempt.trace : trace;
  let current = { ...attempt.diagnostic };
  let rehearsal = null;
  if (["rehearse_add", "live_add"].includes(capsule.operation) && ADD_RETAILERS.has(capsule.retailerId)) {
    current = { ...current, operation: capsule.operation };
    if (attempt.diagnostic.outcome === "passed") {
      const versions = Object.fromEntries(Object.entries(runtime.addLanes || {})
        .map(([retailerId, lane]) => [retailerId, lane.contractVersion]));
      const job = buildRehearsalJob({ ...capsule, requiredFulfillment: fulfillment }, attempt.observation, versions);
      const rehearse = runtime.rehearse[capsule.retailerId];
      rehearsal = job && typeof rehearse === "function"
        ? await rehearse(dom.window.document, capsule.url, job, Date.now(), environment)
        : { ok: false, reason: "offer_not_actionable" };
      const reason = rehearsal?.ok === true ? "verified" : String(rehearsal?.reason || "rehearsal_failed");
      current = {
        ...current,
        outcome: rehearsal?.ok === true ? "passed" : reason === "manual_action_required" || POLICY_REASONS.has(reason) ? "rejected" : "failed",
        failureStage: rehearsal?.ok === true ? "complete" : reason === "manual_action_required" ? "interactive_block"
          : POLICY_REASONS.has(reason) ? "policy" : failureStage(reason),
        reasonCode: reason
      };
    }
  }
  const recorded = {
    outcome: capsule.outcome,
    failureStage: capsule.failureStage,
    reasonCode: capsule.reasonCode
  };
  const actual = {
    outcome: current.outcome,
    failureStage: current.failureStage,
    reasonCode: current.reasonCode
  };
  const reproduced = JSON.stringify(recorded) === JSON.stringify(actual);
  return {
    id: capsule.id,
    retailerId: capsule.retailerId,
    retailerSku: capsule.retailerSku,
    observation: attempt.observation,
    diagnostic: current,
    trace: collectedTrace,
    rehearsal,
    recorded,
    actual,
    reproduced
  };
}

function allIdentifiers(dataDirectory, retailerId) {
  const indexPath = join(resolve(dataDirectory), "evidence", "index.json");
  if (!existsSync(indexPath)) return [];
  const value = JSON.parse(readFileSync(indexPath, "utf8"));
  const items = Array.isArray(value) ? value : value.items;
  return (Array.isArray(items) ? items : [])
    .filter((entry) => !retailerId || entry.retailerId === retailerId)
    .map((entry) => entry.id);
}

function expectationHeld(result, expectation) {
  if (!expectation) return true;
  return expectation === "reproduce" ? result.reproduced : result.actual.outcome === "passed";
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`${result.retailerId}/${result.id}: ${result.actual.outcome} · ${result.actual.failureStage} · ${result.actual.reasonCode}\n`);
  process.stdout.write(`recorded: ${result.recorded.outcome} · ${result.recorded.failureStage} · ${result.recorded.reasonCode}\n`);
  process.stdout.write(`reproduced: ${result.reproduced ? "yes" : "no"}\n`);
  process.stdout.write(`${JSON.stringify({ observation: result.observation, diagnostic: result.actual, trace: result.trace }, null, 2)}\n`);
}

export async function runReplayCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  let identifiers = options.identifiers;
  try {
    if (options.all) identifiers = allIdentifiers(options.dataDirectory, options.retailerId);
    if (!options.all && identifiers.length !== 1) throw new Error("Provide one capsule id or path, or use --all.");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const results = [];
  let unreadable = 0;
  let adapterErrors = 0;
  for (const identifier of identifiers) {
    let capsule;
    try {
      capsule = loadCapsule(identifier, options.dataDirectory);
    } catch (error) {
      unreadable += 1;
      results.push({ id: identifier, error: "unreadable", message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    try {
      results.push(await replayCapsuleObject(capsule, options));
    } catch (error) {
      adapterErrors += 1;
      results.push({ id: identifier, retailerId: capsule?.retailerId || "unknown", error: "adapter", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (options.all) {
    const valid = results.filter((result) => !result.error);
    const summary = {
      total: results.length,
      reproduced: valid.filter((result) => result.reproduced).length,
      notReproduced: valid.filter((result) => !result.reproduced).length,
      errored: results.filter((result) => result.error).length,
      byStore: Object.fromEntries([...new Set(results.map((result) => result.retailerId).filter(Boolean))].sort().map((retailerId) => {
        const store = results.filter((result) => result.retailerId === retailerId);
        return [retailerId, {
          reproduced: store.filter((result) => result.reproduced).length,
          notReproduced: store.filter((result) => !result.error && !result.reproduced).length,
          errored: store.filter((result) => result.error).length
        }];
      }))
    };
    process.stdout.write(`${options.json ? JSON.stringify({ summary, results }) : JSON.stringify(summary, null, 2)}\n`);
  } else if (results[0]?.error) {
    process.stderr.write(`${results[0].message}\n`);
  } else {
    printResult(results[0], options.json);
  }
  if (unreadable) return 2;
  if (adapterErrors) return 3;
  return results.every((result) => !result.error && expectationHeld(result, options.expectation)) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runReplayCli();
}
