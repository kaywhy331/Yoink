#!/usr/bin/env node
// Bundles the extension's TypeScript sources into the committed
// apps/extension/*.js files. `--check` builds in memory and exits 1 listing
// every committed bundle that differs from its source (PLAT-11), so a stale
// bundle cannot ship next to a green type-check; `npm run check` runs it.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, transform } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "apps/extension");
const sourceRoot = resolve(extensionRoot, "src");

async function addLanes() {
  const source = await readFile(resolve(root, "packages/contracts/src/add-lanes.ts"), "utf8");
  const compiled = await transform(source, { loader: "ts", format: "esm", target: "es2023" });
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
  return Object.values(module.ADD_LANES || {});
}

const checkOnly = process.argv.includes("--check");

const entries = [
  [resolve(root, "packages/extension-ui/src/popup-state.ts"), "popup-state.js", "YoinkPopupStateModule"],
  [resolve(sourceRoot, "evidence-capsule.ts"), "evidence-capsule.js", "YoinkEvidenceCapsuleModule"],
  [resolve(sourceRoot, "target-shadow.ts"), "target-shadow.js", "YoinkTargetShadowModule"],
  [resolve(sourceRoot, "retailer-shadow.ts"), "retailer-shadow.js", "YoinkRetailerShadowModule"],
  [resolve(sourceRoot, "observer-recipe-oracle.ts"), "observer-recipe-oracle.js", "YoinkObserverRecipeOracleModule"],
  [resolve(sourceRoot, "trackalacker-sync.ts"), "trackalacker-sync.js", "YoinkTrackalackerSyncModule"]
];

for (const lane of await addLanes()) {
  if (!/^[a-z0-9]+-action\.js$/.test(lane.runnerFile)
    || !/^Yoink[A-Za-z0-9]+Action$/.test(lane.runnerGlobal)) {
    throw new Error(`Add-lane ${String(lane.id || "unknown")} has an invalid packaged runner.`);
  }
  entries.push([
    resolve(sourceRoot, lane.runnerFile.replace(/\.js$/, ".ts")),
    lane.runnerFile,
    `${lane.runnerGlobal}Module`
  ]);
}

// `prebuild:extension` emits add-lanes.js with the esbuild CLI; the check
// covers it too, with the same options.
if (checkOnly) {
  entries.unshift([resolve(root, "packages/contracts/src/add-lanes.ts"), "add-lanes.js", "YoinkAddLaneRegistryModule"]);
}

const outputs = new Set();
const stale = [];
for (const [entryPoint, outputFile, globalName] of entries) {
  if (outputs.has(outputFile)) throw new Error(`Extension bundle output ${outputFile} is duplicated.`);
  outputs.add(outputFile);
  const outfile = resolve(extensionRoot, outputFile);
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "iife",
    globalName,
    platform: "browser",
    target: "chrome120",
    legalComments: "none",
    outfile,
    write: !checkOnly
  });
  if (!checkOnly) continue;
  const expected = result.outputFiles?.[0]?.contents;
  let committed = null;
  try {
    committed = await readFile(outfile);
  } catch {
    committed = null;
  }
  if (!expected || !committed || !Buffer.from(expected).equals(committed)) stale.push(outputFile);
}

if (checkOnly) {
  if (stale.length) {
    process.stderr.write(`Stale extension bundles (run npm run build:extension): ${stale.join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`All ${outputs.size} extension bundles match their sources.\n`);
}
