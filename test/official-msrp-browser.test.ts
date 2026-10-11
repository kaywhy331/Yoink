import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import type { BrowserActionContract } from "../packages/browser-safety/src/index.js";
import { prepareAmazonAdd, commitAmazonAdd } from "../apps/extension/src/amazon-action.js";
import { prepareTargetAdd, commitTargetAdd } from "../apps/extension/src/target-action.js";
import { prepareWalmartAdd, commitWalmartAdd } from "../apps/extension/src/walmart-action.js";
import { prepareBestBuyAdd, commitBestBuyAdd } from "../apps/extension/src/bestbuy-action.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options: { url: string }) => { window: { document: Document; close(): void } } };
const NOW = Date.parse("2026-10-01T16:00:00.000Z");
// Static, synthetic DOMs only. None of these tests contact or mutate a retailer.
const CASES = [
  { retailer: "amazon", sku: "B0GYTRYV7P", url: "https://www.amazon.com/dp/B0GYTRYV7P", price: 2186,
    file: "retailers/amazon-first-party.html", priceSelector: ".a-offscreen", control: "#add-to-cart-button",
    offerRoot: "#addToCart", prepare: prepareAmazonAdd, commit: commitAmazonAdd },
  { retailer: "target", sku: "1011483414", url: "https://www.target.com/p/fixture/-/A-1011483414", price: 5999,
    file: "target/product-first-party.html", priceSelector: "[data-test='product-price']", control: "button",
    offerRoot: "main", prepare: prepareTargetAdd, commit: commitTargetAdd },
  { retailer: "walmart", sku: "17354421975", url: "https://www.walmart.com/ip/fixture/17354421975", price: 4499,
    file: "retailers/walmart-first-party.html", priceSelector: "[data-automation-id='product-price']", control: "[data-automation-id='atc']",
    offerRoot: "[data-testid='buy-box']", prepare: prepareWalmartAdd, commit: commitWalmartAdd },
  { retailer: "bestbuy", sku: "6588149", url: "https://www.bestbuy.com/product/best-buy-essentials-cable/J2FPJKS4SK/sku/6588149", price: 699,
    file: "retailers/bestbuy-first-party.html", priceSelector: "[data-testid='customer-price']", control: "[data-testid='buy-box'] .add-to-cart-button",
    offerRoot: "[data-testid='buy-box']", prepare: prepareBestBuyAdd, commit: commitBestBuyAdd }
] as const;

for (const c of CASES) {
  for (const change of ["none", "lower_price", "higher_price", "variant", "missing_msrp", "expired", "rehearsal"] as const) {
    // Kevin, 2026-10-11: the job's max is the limit, so a lower live price still adds.
    const adds = change === "none" || change === "lower_price";
    test(`${c.retailer}: guarded DOM fixture ${change} ${adds ? "clicks once" : "never clicks"}`, async () => {
      const dom = new JSDOM(readFileSync(`test/fixtures/${c.file}`, "utf8"), { url: c.url });
      try {
        const document = dom.window.document;
        let clicks = 0;
        document.querySelector(c.control)!.addEventListener("click", event => { event.preventDefault(); clicks++; });
        const job: BrowserActionContract & { adapterVersion: string } = {
          contractVersion: 1, jobId: `fixture_${c.retailer}`, retailerId: c.retailer, retailerSku: c.sku,
          canonicalUrl: c.url, action: "add_to_cart", quantity: 1, maxUnitPriceCents: c.price,
          maxOrderTotalCents: c.price + 1000, currency: "USD", sellerPolicy: "first_party_only",
          expectedSeller: ADD_LANES[c.retailer].firstPartySeller, fulfillment: "shipping",
          expiresAt: new Date(NOW + 60_000).toISOString(), adapterVersion: ADD_LANES[c.retailer].contractVersion,
          officialMsrp: { version: 1, evidenceId: `official_msrp_${"a".repeat(32)}`, evidenceHash: "b".repeat(64),
            listingIdentityHash: "c".repeat(64), retailerId: c.retailer, retailerSku: c.sku,
            desiredVariant: "Standard single item", variantAttributes: {}, msrpCents: c.price + 100,
            unitPriceCents: c.price, currency: "USD", signalObservedAt: new Date(NOW).toISOString(),
            expiresAt: new Date(NOW + 60_000).toISOString() }
        };
        if (change === "missing_msrp") delete job.officialMsrp;
        if (change === "rehearsal") job.validationMode = "rehearsal";
        // Each case supplies its matching adapter version; the function union has disjoint literal types.
        const prepared = c.prepare(document, c.url, job as never, NOW);
        assert.equal(prepared.ok, true, JSON.stringify(prepared));
        if (!prepared.ok) return;
        if (change === "lower_price" || change === "higher_price") {
          document.querySelector(c.priceSelector)!.textContent = `$${((c.price + (change === "lower_price" ? -1 : 1)) / 100).toFixed(2)}`;
        }
        if (change === "variant") document.querySelector(c.offerRoot)!.insertAdjacentHTML("beforeend",
          "<select name='color' aria-label='Color'><option selected>Blue</option></select>");
        const result = await c.commit(document, c.url, job as never, prepared.authorizationId, NOW + (change === "expired" ? 61_000 : 100));
        assert.equal(result.ok, adds, JSON.stringify(result));
        assert.equal(clicks, adds ? 1 : 0);
        if (adds) {
          assert.equal((await c.commit(document, c.url, job as never, prepared.authorizationId, NOW + 200)).ok, false);
          assert.equal(clicks, 1, "the consumed authorization cannot click a second time");
        }
      } finally { dom.window.close(); }
    });
  }
}
