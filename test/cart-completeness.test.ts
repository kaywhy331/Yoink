import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { captureCartBaseline, verifyCartAddDelta } from "../packages/browser-safety/src/index.js";
import { observeTargetCart } from "../packages/browser-adapters/src/target.js";
import { observeWalmartCart } from "../packages/browser-adapters/src/walmart.js";
import { observeAmazonCart } from "../packages/browser-adapters/src/amazon.js";
import { observeBestBuyCart } from "../packages/browser-adapters/src/bestbuy.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const fixtures = [
  { retailerId: "target", read: observeTargetCart, file: "target/cart.html", selector: "[data-test='cart-item']", identity: "data-tcin" },
  { retailerId: "walmart", read: observeWalmartCart, file: "walmart/cart.html", selector: "[data-testid='cart-item']", identity: "data-us-item-id" },
  { retailerId: "amazon", read: observeAmazonCart, file: "amazon/cart.html", selector: ".sc-list-item", identity: "data-asin" },
  { retailerId: "bestbuy", read: observeBestBuyCart, file: "retailers/bestbuy-cart-single.html", selector: "[data-testid='cart-item']", identity: "data-sku-id" }
];

test("Amazon removed-item acknowledgements are excluded while unresolved active rows remain blockers", () => {
  const document = new JSDOM('<main><section id="sc-active-cart"><h1>Your Amazon Cart is empty</h1><div class="sc-list-item" data-asin="B0GYTRYV7P" data-removed="true">This item was removed from Shopping Cart.</div></section></main>').window.document as Document;
  assert.equal(captureCartBaseline("amazon", observeAmazonCart(document)).ok, true);
  document.querySelector("section")!.insertAdjacentHTML("beforeend", '<div class="sc-list-item">An active item is loading</div>');
  assert.equal(captureCartBaseline("amazon", observeAmazonCart(document)).ok, false);
});

for (const fixture of fixtures) {
  test(`${fixture.retailerId} refuses a partial cart when an additional visible row has no usable identity`, () => {
    const document = new JSDOM(readFileSync(join(process.cwd(), "test/fixtures", fixture.file), "utf8")).window.document as Document;
    const line = document.querySelector(fixture.selector)!;
    const unknown = line.cloneNode(true) as Element;
    unknown.removeAttribute(fixture.identity);
    for (const link of unknown.querySelectorAll("a")) link.removeAttribute("href");
    unknown.textContent = "Another item is loading";
    line.after(unknown);
    const inventory = fixture.read(document);
    assert.equal(inventory.independentLineCount, 2, "Every visible cart row must be counted before parsing identity.");
    assert.equal(captureCartBaseline(fixture.retailerId, inventory).ok, false, "A partially read cart cannot become a baseline.");
  });

  test(`${fixture.retailerId} cannot prove an exact Add delta while another cart row is unreadable`, () => {
    const document = new JSDOM(readFileSync(join(process.cwd(), "test/fixtures", fixture.file), "utf8")).window.document as Document;
    const now = Date.now();
    const complete = fixture.read(document, new Date(now).toISOString());
    const expected = complete.lines[0]!;
    const line = document.querySelector(fixture.selector)!;
    const unknown = line.cloneNode(true) as Element;
    unknown.removeAttribute(fixture.identity);
    unknown.innerHTML = "<span>Updating item…</span>";
    line.after(unknown);
    const baseline = { contractVersion: 1 as const, retailerId: fixture.retailerId, observedAt: new Date(now).toISOString(), lineCount: 0, lines: [] };
    const sellerName = fixture.retailerId === "target" ? "Target" : fixture.retailerId === "walmart" ? "Walmart" : fixture.retailerId === "amazon" ? "Amazon.com" : "Best Buy";
    const job = { contractVersion: 1 as const, jobId: "audit_cart_complete", retailerId: fixture.retailerId, retailerSku: expected.retailerSku,
      canonicalUrl: fixture.retailerId === "target" ? `https://www.target.com/p/-/A-${expected.retailerSku}`
        : fixture.retailerId === "walmart" ? `https://www.walmart.com/ip/${expected.retailerSku}`
          : fixture.retailerId === "amazon" ? `https://www.amazon.com/dp/${expected.retailerSku}` : `https://www.bestbuy.com/site/-/${expected.retailerSku}.p`,
      action: "add_to_cart" as const, quantity: 1, maxUnitPriceCents: 6000, maxOrderTotalCents: 6000,
      currency: "USD" as const, sellerPolicy: "first_party_only" as const, expectedSeller: sellerName, fulfillment: "shipping" as const,
      expiresAt: new Date(now + 60000).toISOString() };
    const proof = { contractVersion: 1 as const, jobId: job.jobId, retailerId: fixture.retailerId, retailerSku: expected.retailerSku,
      observedAt: new Date(now).toISOString(), unitPriceCents: expected.unitPriceCents!, currency: "USD" as const,
      sellerName, sellerType: "first_party" as const, fulfillment: "shipping" as const };
    assert.equal(verifyCartAddDelta(job, baseline, complete, proof, now).ok, true, "The complete cart must prove the exact delta before adding the unreadable row.");
    assert.equal(verifyCartAddDelta(job, baseline, fixture.read(document), proof).ok, false);
  });
}
