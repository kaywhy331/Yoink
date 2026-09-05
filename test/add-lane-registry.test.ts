import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ADD_LANES,
  ADD_LANE_IDS,
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  AMAZON_SELECTOR_PACK_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  BESTBUY_SELECTOR_PACK_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  TARGET_SELECTOR_PACK_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  WALMART_SELECTOR_PACK_VERSION
} from "../packages/contracts/src/index.js";
import {
  signalRetailerQualificationApplyFunctionSource
} from "../packages/database/src/postgres-signal-retailer-qualification-apply.js";

const root = process.cwd();

test("the guarded add registry carries every executable lane contract", () => {
  assert.deepEqual(ADD_LANE_IDS.slice(0, 4), ["target", "walmart", "amazon", "bestbuy"]);
  assert.equal(new Set(ADD_LANE_IDS).size, ADD_LANE_IDS.length);
  const legacyVersions: Partial<Record<(typeof ADD_LANE_IDS)[number], readonly [string, string, string]>> = {
    target: [TARGET_ADD_ADAPTER_VERSION, TARGET_OBSERVER_VERSION, TARGET_SELECTOR_PACK_VERSION],
    walmart: [WALMART_ADD_ADAPTER_VERSION, WALMART_OBSERVER_VERSION, WALMART_SELECTOR_PACK_VERSION],
    amazon: [AMAZON_ADD_ADAPTER_VERSION, AMAZON_OBSERVER_VERSION, AMAZON_SELECTOR_PACK_VERSION],
    bestbuy: [BESTBUY_ADD_ADAPTER_VERSION, BESTBUY_OBSERVER_VERSION, BESTBUY_SELECTOR_PACK_VERSION]
  } as const;
  for (const retailerId of ADD_LANE_IDS) {
    const lane = ADD_LANES[retailerId];
    assert.equal(lane.id, retailerId);
    const legacy = legacyVersions[retailerId];
    if (legacy) {
      assert.deepEqual(
        [lane.contractVersion, lane.observerVersion, lane.packVersion],
        [...legacy]
      );
    }
    assert.match(lane.domain, /^[a-z0-9.-]+$/);
    assert.match(lane.cartUrl, /^https:\/\//);
    assert.match(lane.skuPattern, /^\^/);
    assert.match(lane.activationConfirmation, /^ENABLE_[A-Z0-9_]+$/);
    assert.ok(lane.firstPartySeller);
    assert.ok(lane.runnerFile.endsWith("-action.js"));
    assert.ok(lane.runnerGlobal.startsWith("Yoink"));
    assert.equal(lane.trialRouteSlug, `${retailerId}-add`);
    assert.ok(lane.supportedFulfillment.includes("shipping"));
    assert.doesNotThrow(() => new RegExp(lane.skuPattern));
  }
});

test("server, companion, and PostgreSQL paths dispatch through the registry", () => {
  const api = readFileSync(join(root, "apps/api/src/app.ts"), "utf8");
  const repository = readFileSync(join(root, "packages/database/src/qualification-repository.ts"), "utf8");
  const background = readFileSync(join(root, "apps/extension/background.js"), "utf8");
  const build = readFileSync(join(root, "scripts/build-extension.mjs"), "utf8");
  const packager = readFileSync(join(root, "scripts/package-extension.mjs"), "utf8");
  assert.match(api, /const lane = addLane\(addTrialMatch\[1\]/);
  assert.match(api, /const lane = addLane\(activateAddMatch\[1\]/);
  assert.match(repository, /recordAddRehearsal\(\s*retailerId: AddLaneId/);
  assert.match(repository, /activateAdd\(\s*retailerId: AddLaneId/);
  assert.match(repository, /addQualified\(retailerId: AddLaneId/);
  assert.match(background, /async function rehearseAddTab\(retailerId,/);
  assert.match(background, /function addRehearsalJob\(lane, observation\)/);
  assert.doesNotMatch(background, /function (?:target|walmart|amazon|bestBuy)RehearsalJob/);
  assert.match(build, /lane\.runnerFile/);
  assert.match(build, /lane\.runnerGlobal/);
  assert.match(packager, /add-lanes\.ts/);
  assert.match(packager, /\.\.\.actionFiles/);

  const postgres = signalRetailerQualificationApplyFunctionSource();
  for (const retailerId of ADD_LANE_IDS.filter((value) => value !== "target")) {
    const lane = ADD_LANES[retailerId];
    assert.match(postgres, new RegExp(`activate_${retailerId}_add`));
    assert.match(postgres, new RegExp(lane.contractVersion));
    assert.match(postgres, new RegExp(lane.qualificationEvidenceNamespace));
  }
  assert.match(postgres, /FROM \(VALUES/);
  assert.doesNotMatch(postgres, /ELSIF operation_name = 'activate_/);
});

test("the fifth-store dry-run receipt stays within eight changed files", () => {
  const receipt = readFileSync(join(root, "docs/ADD_LANE_REGISTRY.md"), "utf8");
  const paths = [...receipt.matchAll(/^\d+\. `([^`]+)`$/gm)].map((match) => match[1]);
  assert.equal(paths.length, 8);
  assert.equal(new Set(paths).size, 8);
  assert.ok(paths.some((path) => path === "packages/contracts/src/add-lanes.ts"));
  assert.ok(paths.some((path) => path === "apps/extension/src/pokemoncenter-action.ts"));
  assert.equal(paths.filter((path) => path?.includes("test/fixtures/capsules/pokemoncenter/")).length, 6);
});

test("admin activation submits the confirmation required by each current lane", () => {
  const admin = readFileSync(join(root, "apps/web/app.js"), "utf8");
  for (const retailerId of ADD_LANE_IDS) {
    const request = admin.match(new RegExp(
      `api\\("/api/v1/admin/qualifications/${retailerId}-add/activate", \\{([\\s\\S]*?)\\n      \\}\\);`
    ));
    assert.ok(request, `${retailerId} activation request`);
    assert.equal(request[1]?.match(/confirmation: "([^"]+)"/)?.[1], ADD_LANES[retailerId].activationConfirmation);
  }
});
