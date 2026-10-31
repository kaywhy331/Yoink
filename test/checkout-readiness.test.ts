import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { inspectCheckoutReadiness } from "../apps/extension/src/checkout-readiness.js";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
const NOW = Date.parse("2026-10-14T16:00:00Z");
function check(html: string, retailerId = "amazon", sku = "B0WANTIT01", lineCount = 1, path = "/checkout/review") {
  const dom = new JSDOM(`<main>${html}</main>`, { url: `https://www.${retailerId}.com${path}` });
  try { return inspectCheckoutReadiness(dom.window.document, dom.window.location.href,
    { retailerId, retailerSku: sku, cartLineCount: lineCount }, NOW,
    (element) => !element.closest('[hidden], [aria-hidden="true"]')); }
  finally { dom.window.close(); }
}
const submit = '<button id="place-order">Place your order</button>';
for (const [store, attribute, sku] of [["amazon", "asin", "B0WANTIT01"], ["target", "tcin", "12345678"], ["walmart", "item-id", "12345678"], ["bestbuy", "sku", "1234567"]]) {
  test(`${store} requires the exact item and an actionable checkout`, () => {
    assert.equal(check(`<div data-${attribute}="${sku}">Your item</div>${submit}`, store, sku).availability, "available");
    assert.equal(check(`<div data-${attribute}="different">Other item</div>${submit}`, store, sku).availability, "unknown");
    assert.equal(check(`<div data-${attribute}="${sku}">Your item</div><button disabled>Place your order</button>`, store, sku).availability, "unknown");
  });
}
test("an Amazon cart add followed by an unavailable checkout item is out of stock", () => {
  assert.equal(check(`<div data-asin="B0WANTIT01">This item is no longer available</div>${submit}`).availability, "out_of_stock");
  assert.equal(check('<div role="alert">Some items in your order are no longer available</div>').availability, "out_of_stock");
});
test("another existing cart item's stock issue cannot label the selected item sold out", () => {
  assert.equal(check(`<div data-asin="B0WANTIT01">Your item</div><div role="alert">Some items are out of stock</div>${submit}`, "amazon", "B0WANTIT01", 2).availability, "unknown");
});
test("hidden stale stock errors, login, challenges and missing checkout controls are distinguished", () => {
  assert.equal(check(`<div data-asin="B0WANTIT01">Your item</div><div hidden role="alert">Out of stock</div>${submit}`).availability, "available");
  assert.equal(check('<input type="password">').reason, "checkout_sign_in_required");
  assert.equal(check('<div>Verify you are human</div>').reason, "security_challenge");
  assert.equal(check('<div data-asin="B0WANTIT01">Your item</div>').availability, "unknown");
  assert.equal(check(`<div data-asin="B0WANTIT01">Your item</div>${submit}`, "amazon", "B0WANTIT01", 1, "/gp/cart/view.html").availability, "unknown");
});
