import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document; location: Location; URL: typeof URL } } };
const ROOT = process.cwd();
const PRODUCT_URL = "https://www.target.com/p/fixture/-/A-1011483414";

test("the browser bundle executes the shared Target observer and returns only the shadow contract", () => {
  const html = readFileSync(join(ROOT, "test", "fixtures", "target", "product-first-party.html"), "utf8");
  const dom = new JSDOM(html, { url: PRODUCT_URL });
  const source = readFileSync(join(ROOT, "apps", "extension", "target-shadow.js"), "utf8");
  const context = createContext({
    document: dom.window.document,
    location: dom.window.location,
    URL: dom.window.URL,
    Date,
    Set,
    Object,
    String,
    Number,
    RegExp,
    Array,
    Boolean,
    Math
  });
  runInContext(source, context);
  const result = runInContext("YoinkTargetShadow.collectTargetShadowObservation(document, location.href)", context) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    adapterVersion: "target-observer-v1",
    contractVersion: 1,
    observedAt: result.observedAt,
    pageKind: "product",
    retailerId: "target",
    retailerSku: "1011483414",
    availability: "in_stock",
    unitPriceCents: 5999,
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: ""
  });
  assert.equal("url" in result, false);
  assert.equal("pageText" in result, false);
  assert.doesNotMatch(source, /\.click\s*\(|dispatchEvent\s*\(|\bfetch\s*\(/);
});

test("the browser bundle fails closed outside an exact Target product URL", () => {
  const dom = new JSDOM("<main>Target fixture</main>", { url: "https://www.target.com/" });
  const source = readFileSync(join(ROOT, "apps", "extension", "target-shadow.js"), "utf8");
  const context = createContext({ document: dom.window.document, location: dom.window.location, URL: dom.window.URL, Date, Set, Object, String, Number, RegExp, Array, Boolean, Math });
  runInContext(source, context);
  assert.throws(
    () => runInContext("YoinkTargetShadow.collectTargetShadowObservation(document, location.href)", context),
    /exact Target product page/
  );
});
