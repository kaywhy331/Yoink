#!/usr/bin/env node
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

const outputs = new Set();
for (const [entryPoint, outputFile, globalName] of entries) {
  if (outputs.has(outputFile)) throw new Error(`Extension bundle output ${outputFile} is duplicated.`);
  outputs.add(outputFile);
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "iife",
    globalName,
    platform: "browser",
    target: "chrome120",
    legalComments: "none",
    outfile: resolve(extensionRoot, outputFile)
  });
}
