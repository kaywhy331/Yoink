import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { observeWalmartDrawHub, parseWalmartDrawCloseAt } from "../packages/browser-adapters/src/walmart-draw.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } };
};
const URL = "https://www.walmart.com/shop/collectibles/draw";
const NOW = "2026-08-24T19:10:00.000Z";

test("Walmart draw observer extracts all four exact current records without entry state or payment data", () => {
  const html = readFileSync(join(process.cwd(), "test", "fixtures", "retailers", "walmart-draw-hub.html"), "utf8");
  const document = new JSDOM(html, { url: URL }).window.document;
  const scan = observeWalmartDrawHub(document, URL, NOW);
  assert.equal(scan.outcome, "passed");
  assert.equal(scan.reasonCode, "verified");
  assert.equal(scan.expectedCardCount, 4);
  assert.equal(scan.observedCardCount, 4);
  assert.deepEqual(scan.items.map((item) => [item.retailerSku, item.unitPriceCents, item.orderMaxLimit]), [
    ["19624258216", 597, 99],
    ["19536452232", 597, 99],
    ["5631614124", 5997, 5],
    ["18029663536", 4998, 5]
  ]);
  assert.ok(scan.items.every((item) => item.sellerType === "first_party"));
  assert.ok(scan.items.every((item) => item.drawState === "active"));
  assert.ok(scan.items.every((item) => item.closesAt === "2026-08-24T22:00:00.000Z"));
  assert.ok(scan.items.every((item) => item.drawControlPresent && item.addControlSuppressed));
  assert.equal("addressLineOne" in scan, false);
  assert.equal("paymentMethod" in scan, false);
  assert.equal("entryId" in scan, false);
  assert.ok(scan.items.every((item) => !("offerToken" in item) && !("accountId" in item)));
});

test("Walmart draw observer fails closed on challenges and non-hub URLs", () => {
  const challenged = new JSDOM(`
    <main><h2>Robot or human?</h2><iframe title="Human verification challenge"></iframe></main>
  `, { url: URL }).window.document;
  const scan = observeWalmartDrawHub(challenged, URL, NOW);
  assert.equal(scan.outcome, "manual");
  assert.equal(scan.reasonCode, "security_challenge");
  assert.deepEqual(scan.items, []);
  assert.throws(
    () => observeWalmartDrawHub(challenged, "https://www.walmart.com/ip/example/19624258216", NOW),
    /exact Walmart Collectibles Draw hub/
  );
});

test("Walmart draw close labels are normalized to absolute instants and ambiguous labels stay unknown", () => {
  assert.equal(parseWalmartDrawCloseAt("today, 3:00pm PDT", NOW), "2026-08-24T22:00:00.000Z");
  assert.equal(parseWalmartDrawCloseAt("tomorrow, 12:30am PDT", NOW), "2026-08-25T07:30:00.000Z");
  assert.equal(parseWalmartDrawCloseAt("soon", NOW), null);
});

test("Walmart draw observer source is structurally read-only", () => {
  const source = readFileSync(join(process.cwd(), "packages", "browser-adapters", "src", "walmart-draw.ts"), "utf8");
  assert.doesNotMatch(source, /\.click\s*\(|dispatchEvent\s*\(|\bfetch\s*\(|\/draw\/enter/);
});

test("user and admin surfaces disclose contingent-order risk and expose no entry control", () => {
  const sources = ["apps/web/user.html", "apps/web/user.js", "apps/web/index.html", "apps/web/app.js"]
    .map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");
  assert.match(sources, /automatic (?:charge and order|order and charge)/i);
  assert.match(sources, /manual entry only|entry stays manual/i);
  assert.doesNotMatch(sources, /id=["'](?:enter|submit)WalmartDraw|\/draw\/enter/);
});
