#!/usr/bin/env node
// Run: node --import tsx scripts/benchmark-cart-latency.mjs [output.json]
// Regression benchmark: all retailer documents are fixtures; every network
// request is intercepted. The slower reference transform stays in memory.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import * as contracts from "../packages/contracts/src/index.ts";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] || "/tmp/yoink-cart-latency.json");
const fixtures = [
  { store: "target", suffix: "Target", file: "target/product-first-party.html", sku: "1011483414", url: "https://www.target.com/p/fixture/-/A-1011483414", seller: "Target", cap: 6000, price: "[data-test='product-price']", control: "[data-fulfillment='shipping']" },
  { store: "walmart", suffix: "Walmart", file: "retailers/walmart-first-party.html", sku: "17354421975", url: "https://www.walmart.com/ip/fixture/17354421975", seller: "Walmart", cap: 4500, price: "[data-automation-id='product-price']", control: "[data-automation-id='atc']", sellerSelector: "[data-testid='seller-display-name']" },
  { store: "amazon", suffix: "Amazon", file: "retailers/amazon-first-party.html", sku: "B0GYTRYV7P", url: "https://www.amazon.com/dp/B0GYTRYV7P", seller: "Amazon.com", cap: 2200, price: ".a-offscreen", control: "#add-to-cart-button", sellerSelector: "#merchant-info" },
  { store: "bestbuy", suffix: "BestBuy", file: "retailers/bestbuy-first-party.html", sku: "6588149", url: "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149", seller: "Best Buy", cap: 699, price: "[data-testid='customer-price']", control: "[data-testid='buy-box'] .add-to-cart-button", sellerSelector: "[data-testid='sold-by']" }
];
const sha = (value) => createHash("sha256").update(value).digest("hex");
// Preserve the existing normalization for nonempty styles. Avoid invoking the
// locale machinery for the overwhelmingly common absent/empty style attribute.
const oldStyle = 'const style = String(current.getAttribute("style") || "").replace(/\\s+/g, "").toLocaleLowerCase("en-US");';
const fastStyle = 'const inlineStyle = current.getAttribute("style");\n    const style = inlineStyle ? inlineStyle.replace(/\\s+/g, "").toLocaleLowerCase("en-US") : "";';
const baselinePlugin = {
  name: "previous-empty-style-normalization",
  setup(builder) {
    builder.onLoad({ filter: /browser-adapters\/src\/(target|retailers)\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      assert.equal(source.split(fastStyle).length, 2, `Expected one visibility normalization in ${path}`);
      return { contents: source.replace(fastStyle, oldStyle), loader: "ts" };
    });
  }
};
const browser = await chromium.launch({ headless: true, ...(process.env.YOINK_TEST_CHROME ? { executablePath: process.env.YOINK_TEST_CHROME } : {}) });
const results = {
  generatedAt: new Date().toISOString(), chromium: browser.version(),
  environment: "Headless Chromium, fresh context per case, all network intercepted, synthetic saved HTML, unthrottled local CPU; not live signal-to-cart timing.",
  methodology: "5 warmups and 20 measured prepare+commit pairs per cell; alternating baseline/optimized order by store; nearest-rank percentiles; no selector instrumentation; no cart/server/network time included.",
  optimization: "Packaged empty-inline-style fast path versus an in-memory reference restoring previous normalization. No cached offer, visibility, authorization, or removed validation.",
  bundles: [], timings: [], scenarios: [], status: "running"
};
try {
  await writeFile(output, JSON.stringify(results, null, 2) + "\n");
  for (const [index, fixture] of fixtures.entries()) {
    const html = await readFile(resolve(root, "test/fixtures", fixture.file), "utf8");
    const packaged = await readFile(resolve(root, `apps/extension/${fixture.store}-action.js`), "utf8");
    const options = {
      absWorkingDir: root, entryPoints: [`apps/extension/src/${fixture.store}-action.ts`],
      bundle: true, format: "iife", globalName: `Yoink${fixture.suffix}ActionModule`,
      platform: "browser", target: "chrome120", legalComments: "none", write: false,
      outfile: resolve(root, `apps/extension/${fixture.store}-action.js`)
    };
    const current = (await build(options)).outputFiles[0].text;
    assert.equal(current, packaged, `${fixture.store} packaged bundle differs from source; rebuild before benchmarking`);
    const baseline = (await build({ ...options, plugins: [baselinePlugin] })).outputFiles[0].text;
    results.bundles.push({ store: fixture.store, adapterVersion: contracts[fixture.store.toUpperCase() + "_ADD_ADAPTER_VERSION"], packagedSha256: sha(packaged), baselineSha256: sha(baseline), fixtureSha256: sha(html) });
    const variants = index % 2 ? [["optimized", current], ["baseline", baseline]] : [["baseline", baseline], ["optimized", current]];
    for (const [variant, code] of variants) {
      for (const padding of [0, 3000]) {
        const context = await browser.newContext({ serviceWorkers: "block" });
        await context.route("**/*", (route) => route.request().isNavigationRequest() && route.request().url() === fixture.url
          ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
        const page = await context.newPage();
        await page.goto(fixture.url);
        await page.addScriptTag({ content: code });
        const value = await page.evaluate(async ({ fixture: f, padding, version }) => {
          if (padding) {
            const aside = document.createElement("aside");
            aside.innerHTML = Array.from({ length: padding }, (_, i) => `<div class="recommendation"><span>Related item ${i}</span><span>Description</span></div>`).join("");
            document.body.append(aside);
          }
          document.addEventListener("click", (event) => event.preventDefault(), true);
          const api = globalThis[`Yoink${f.suffix}Action`];
          const makeJob = () => ({ contractVersion: 1, jobId: "job_latency_fixture", retailerId: f.store, retailerSku: f.sku, canonicalUrl: f.url, action: "add_to_cart", quantity: 1, maxUnitPriceCents: f.cap, maxOrderTotalCents: f.cap, currency: "USD", sellerPolicy: "first_party_only", expectedSeller: f.seller, fulfillment: "shipping", expiresAt: new Date(Date.now() + 60_000).toISOString(), adapterVersion: version });
          const samples = [];
          for (let i = 0; i < 25; i += 1) {
            const job = makeJob();
            const start = performance.now();
            const prepared = api[`prepare${f.suffix}Add`](document, f.url, job);
            const middle = performance.now();
            if (!prepared.ok) throw Error(`prepare: ${prepared.reason}`);
            const committed = await api[`commit${f.suffix}Add`](document, f.url, job, prepared.authorizationId);
            const end = performance.now();
            if (!committed.ok || !committed.clicked) throw Error(`commit: ${committed.reason}`);
            if (i >= 5) samples.push({ prepareMs: middle - start, commitMs: end - middle, totalMs: end - start });
          }
          const stats = {};
          for (const key of Object.keys(samples[0])) {
            const values = samples.map((s) => s[key]).sort((a, b) => a - b);
            stats[key] = { p50: +values[Math.ceil(values.length * .5) - 1].toFixed(2), p95: +values[Math.ceil(values.length * .95) - 1].toFixed(2) };
          }
          return { padding, elements: document.querySelectorAll("*").length, n: samples.length, stats, shippingSelectionSupported: typeof api.selectBestBuyShipping === "function" };
        }, { fixture, padding, version: contracts[fixture.store.toUpperCase() + "_ADD_ADAPTER_VERSION"] });
        results.timings.push({ store: fixture.store, variant, ...value });
        console.log(JSON.stringify(results.timings.at(-1)));
        await context.close();
        await writeFile(output, JSON.stringify(results, null, 2) + "\n");
      }
      const cases = ["unchanged", "prior_rehearsal", "price_changed", "seller_changed", "control_replaced", "disabled", "challenge", "hidden_ancestor", "expired_authorization", "duplicate_commit", "inline_styles_visible", "visibility_hidden", "aria_hidden", "hidden_attribute"];
      if (fixture.store === "amazon") cases.push("offer_token_changed");
      if (fixture.store === "bestbuy") {
        cases.push("pickup_selected");
        if (results.timings.at(-1).shippingSelectionSupported) cases.push("shipping_selection", "shipping_selection_failed");
      }
      for (const scenario of cases) {
        const context = await browser.newContext({ serviceWorkers: "block" });
        await context.route("**/*", (route) => route.request().isNavigationRequest() && route.request().url() === fixture.url
          ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
        const page = await context.newPage();
        await page.goto(fixture.url);
        await page.addScriptTag({ content: code });
        const value = await page.evaluate(async ({ fixture: f, scenario, version }) => {
          const api = globalThis[`Yoink${f.suffix}Action`];
          const now = Date.now();
          const job = { contractVersion: 1, jobId: "job_latency_scenario", retailerId: f.store, retailerSku: f.sku, canonicalUrl: f.url, action: "add_to_cart", quantity: 1, maxUnitPriceCents: f.cap, maxOrderTotalCents: f.cap, currency: "USD", sellerPolicy: "first_party_only", expectedSeller: f.seller, fulfillment: "shipping", expiresAt: new Date(now + 60_000).toISOString(), adapterVersion: version };
          let clicks = 0;
          document.addEventListener("click", (event) => {
            event.preventDefault();
            if (event.target instanceof Element && event.target.matches(f.control)) clicks += 1;
          }, true);
          const prepare = () => api[`prepare${f.suffix}Add`](document, f.url, job, now);
          const commit = (authorization, time = now + 1) => api[`commit${f.suffix}Add`](document, f.url, job, authorization, time);
          const start = performance.now();
          if (scenario === "prior_rehearsal") {
            const rehearsal = api[`rehearse${f.suffix}Add`](document, f.url, job, now);
            if (!rehearsal.ok || clicks) throw Error("Rehearsal did not remain read-only");
          }
          if (scenario.startsWith("shipping_selection")) {
            const shipping = document.querySelector("[data-testid='fulfillment-option-shipping']");
            const pickup = document.querySelector("[data-testid='fulfillment-option-pickup']");
            shipping.setAttribute("aria-checked", "false"); pickup.setAttribute("aria-checked", "true");
            if (scenario === "shipping_selection") shipping.addEventListener("click", () => {
              shipping.setAttribute("aria-checked", "true"); pickup.setAttribute("aria-checked", "false");
            });
            const selected = await api.selectBestBuyShipping(document, f.url, f.sku, undefined, { timeoutMs: 400, quietMs: 200 });
            return { ok: selected.ok, reason: selected.reason, selectionClicked: selected.selectionClicked, clicks, elapsedMs: +(performance.now() - start).toFixed(2) };
          }
          const prepared = prepare();
          if (!prepared.ok) throw Error(`Initial preparation failed: ${prepared.reason}`);
          const control = document.querySelector(f.control);
          if (scenario === "price_changed") document.querySelector(f.price).textContent = "$999.99";
          if (scenario === "seller_changed") {
            let seller = f.sellerSelector && document.querySelector(f.sellerSelector);
            if (!seller) { seller = document.createElement("p"); seller.dataset.test = "seller-name"; control.parentElement.append(seller); }
            seller.textContent = "Sold and shipped by Marketplace Vendor";
          }
          if (scenario === "control_replaced") control.replaceWith(control.cloneNode(true));
          if (scenario === "disabled") control.setAttribute("disabled", "");
          if (scenario === "challenge") { const block = document.createElement("div"); block.textContent = "Verify you are human"; document.body.prepend(block); }
          if (scenario === "hidden_ancestor") control.parentElement.setAttribute("style", "DISPLAY: none");
          if (scenario === "inline_styles_visible") {
            control.setAttribute("style", "");
            control.parentElement.setAttribute("style", "   ");
            document.body.setAttribute("style", "COLOR: red; DISPLAY: block");
          }
          if (scenario === "visibility_hidden") control.parentElement.setAttribute("style", "visibility: hidden");
          if (scenario === "aria_hidden") control.parentElement.setAttribute("aria-hidden", "true");
          if (scenario === "hidden_attribute") control.parentElement.setAttribute("hidden", "");
          if (scenario === "offer_token_changed") document.querySelector("[name='offerListingID']").value = "CHANGED+TOKEN==";
          if (scenario === "pickup_selected") {
            document.querySelector("[data-testid='fulfillment-option-shipping']").setAttribute("aria-checked", "false");
            document.querySelector("[data-testid='fulfillment-option-pickup']").setAttribute("aria-checked", "true");
          }
          let committed = await commit(prepared.authorizationId, scenario === "expired_authorization" ? now + 10_001 : now + 1);
          if (scenario === "duplicate_commit") {
            if (!committed.ok || clicks !== 1) throw Error("Initial commit did not click exactly once");
            committed = await commit(prepared.authorizationId);
          }
          return { ok: committed.ok, reason: committed.reason, clicks, elapsedMs: +(performance.now() - start).toFixed(2) };
        }, { fixture, scenario, version: contracts[fixture.store.toUpperCase() + "_ADD_ADAPTER_VERSION"] });
        const successful = ["unchanged", "prior_rehearsal", "inline_styles_visible", "shipping_selection"].includes(scenario);
        assert.equal(value.ok, successful, `${fixture.store}/${variant}/${scenario}: ${JSON.stringify(value)}`);
        assert.equal(value.clicks, ["unchanged", "prior_rehearsal", "inline_styles_visible", "duplicate_commit"].includes(scenario) ? 1 : 0, `${fixture.store}/${variant}/${scenario}: Add count`);
        results.scenarios.push({ store: fixture.store, variant, scenario, ...value });
        await context.close();
      }
      console.log(`${fixture.store}/${variant}: ${cases.length} scenario assertions passed`);
      await writeFile(output, JSON.stringify(results, null, 2) + "\n");
    }
  }
  results.status = "passed";
  await writeFile(output, JSON.stringify(results, null, 2) + "\n");
  console.log(`Passed ${results.timings.length} timing cells and ${results.scenarios.length} scenario cases. Evidence: ${output}`);
} catch (error) {
  results.status = "failed";
  await writeFile(output, JSON.stringify(results, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
