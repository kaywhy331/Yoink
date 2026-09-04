import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  RETAILER_SELECTOR_PACK_VERSIONS,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_ADD_CONTRACT_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_ADD_CONTRACT_VERSION
} from "../packages/contracts/src/index.js";
import {
  ADD_SELECTOR_PACKS,
  OBSERVE_ONLY_SELECTOR_PACK,
  SELECTOR_PACK_VERSIONS,
  selectorsFor
} from "../packages/browser-adapters/src/selector-packs.js";
// JavaScript command modules intentionally expose their validator for focused contract tests.
// @ts-expect-error scripts are not part of the TypeScript build surface
import { lintSelectorPacks, PACK_ROOT } from "../scripts/lint-selector-packs.mjs";

test("selector packs are local, frozen, version-aligned, and lint-clean", () => {
  assert.deepEqual(lintSelectorPacks(), { version: 1, packs: JSON.parse(
    readFileSync(join(PACK_ROOT, "lock.json"), "utf8")
  ).packs });
  assert.equal(TARGET_ADD_CONTRACT_VERSION, TARGET_ADD_ADAPTER_VERSION);
  assert.equal(WALMART_ADD_CONTRACT_VERSION, WALMART_ADD_ADAPTER_VERSION);
  assert.deepEqual(SELECTOR_PACK_VERSIONS, RETAILER_SELECTOR_PACK_VERSIONS);
  assert.equal(Object.isFrozen(ADD_SELECTOR_PACKS), true);
  assert.equal(Object.isFrozen(ADD_SELECTOR_PACKS.target.fields.addControl), true);
  assert.equal(Object.isFrozen(OBSERVE_ONLY_SELECTOR_PACK.retailers.disney.price), true);
  assert.ok(selectorsFor("target", "addControl").includes("button[data-test='shipItButton']"));
  assert.ok(selectorsFor("walmart", "structuredData").includes("script#__NEXT_DATA__"));
  assert.ok(selectorsFor("pokemoncenter", "price").length > 0);

  const source = readFileSync(new URL("../packages/browser-adapters/src/selector-packs.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|https?:\/\//);
});

test("pack content cannot change behind an unchanged version", () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-selector-packs-"));
  try {
    cpSync(PACK_ROOT, root, { recursive: true });
    const path = join(root, "walmart.json");
    const pack = JSON.parse(readFileSync(path, "utf8"));
    pack.fields.addControl.selectors.unshift("button[data-testid='new-atc']");
    writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`);
    assert.throws(() => lintSelectorPacks({ packRoot: root }), /without a packVersion bump/);
    pack.packVersion = "walmart-pack-v2";
    writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`);
    assert.throws(() => lintSelectorPacks({ packRoot: root }), /not reflected in lock\.json/);
    assert.equal(lintSelectorPacks({ packRoot: root, writeLock: true }).packs["walmart.json"].packVersion, "walmart-pack-v2");
    assert.doesNotThrow(() => lintSelectorPacks({ packRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the two observer modules consume pack-managed selector lists", () => {
  const retailers = readFileSync(new URL("../packages/browser-adapters/src/retailers.ts", import.meta.url), "utf8");
  const target = readFileSync(new URL("../packages/browser-adapters/src/target.ts", import.meta.url), "utf8");
  assert.doesNotMatch(retailers, /addSelectors:\s*\[/);
  assert.doesNotMatch(retailers, /priceSelectors:\s*\[/);
  assert.doesNotMatch(retailers, /sellerSelectors:\s*\[/);
  assert.doesNotMatch(target, /const TARGET_CURRENT_PRICE_SELECTORS\s*=\s*\[/);
  assert.doesNotMatch(target, /const TARGET_FULFILLMENT_(?:ROOT|TILE)_SELECTOR\s*=\s*\[/);
});
