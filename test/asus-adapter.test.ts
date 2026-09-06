import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { asusOfferBinding, asusCartInventory, asusUrlSku } from "../packages/browser-adapters/src/asus.js";
import type { AdapterEnvironment } from "../packages/contracts/src/index.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const directory = "docs/store-evidence/asus/";
const environment: AdapterEnvironment = { isVisible: element => !element.closest('[data-assessment-visible="false"], [hidden], [inert], [aria-hidden="true"]') };
function product(name = "mouse") {
  const metadata = JSON.parse(readFileSync(`${directory}${name}-product-2026-09-06.json`, "utf8"));
  const dom = new JSDOM(readFileSync(`${directory}${name}-product-2026-09-06.html`, "utf8"), { url: metadata.url });
  const document: Document = dom.window.document;
  // Rejoin the observed head values saved alongside each reduced product root.
  for (const [field, value] of [["currency", metadata.currency], ["amount", String(metadata.priceCents / 100)]]) {
    const meta = document.createElement("meta");
    meta.setAttribute("property", `product:price:${field}`); meta.content = value;
    document.head.append(meta);
  }
  return { dom, document, metadata };
}

test("ASUS binds both captured simple products to the exact form and USD price without clicks", () => {
  for (const name of ["mouse", "pad"]) {
    const { dom, document, metadata } = product(name);
    try {
      let clicks = 0; document.addEventListener("click", () => clicks++);
      const binding = asusOfferBinding(document, document.URL, metadata.sku, environment);
      assert.equal(binding?.retailerSku, metadata.sku);
      assert.equal(binding?.unitPriceCents, metadata.priceCents);
      assert.equal(binding?.productId, metadata.productId);
      assert.equal(binding?.control.id, "product-addtocart-button");
      assert.equal(clicks, 0);
    } finally { dom.window.close(); }
  }
});

test("ASUS refuses changed identities, selectable configurations, ambiguous prices and interruptions", () => {
  const cases: Record<string, (document: Document) => void> = {
    sku: d => d.querySelector('form')!.setAttribute('data-product-sku', '90MP03H0-BPAA00'),
    action: d => d.querySelector('form')!.setAttribute('action', 'https://example.com/us/checkout/cart/add/product/48256/'),
    quantity: d => { (d.querySelector('[name=qty]') as HTMLInputElement).value = '2'; },
    configuration: d => { (d.querySelector('[name=selected_configurable_option]') as HTMLInputElement).value = '123'; },
    bundle: d => d.querySelector('form')!.insertAdjacentHTML('beforeend', '<select name="bundle_option[1]"></select>'),
    duplicate: d => d.querySelector('form')!.append(d.querySelector('#product-addtocart-button')!.cloneNode(true)),
    hidden: d => d.querySelector('.product-info-main')!.setAttribute('hidden', ''),
    disabled: d => d.querySelector('#product-addtocart-button')!.setAttribute('disabled', ''),
    currency: d => d.querySelector('meta[property="product:price:currency"]')!.setAttribute('content', 'CAD'),
    price: d => d.querySelector('[data-price-type=finalPrice]')!.setAttribute('data-price-amount', '1.00'),
    challenge: d => d.body.prepend('Access Denied'),
    dialog: d => d.body.insertAdjacentHTML('beforeend', '<dialog open>Choose a delivery address</dialog>')
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const { dom, document, metadata } = product();
    try { mutate(document); assert.equal(asusOfferBinding(document, document.URL, metadata.sku, environment), null, name); }
    finally { dom.window.close(); }
  }
  assert.equal(asusUrlSku('https://eshop.asus.com/ca-en/90mp04d0-bmaa02-mouse.html'), '');
  assert.equal(asusUrlSku('https://eshop.asus.com/us/90mp04d0-bmaa02-mouse.html?config=another'), '');
  assert.equal(asusUrlSku('https://eshop.asus.com.evil.test/us/90mp04d0-bmaa02-mouse.html'), '');
});

test("ASUS cart evidence counts quantities independently and reads a unit price from a two-unit line", () => {
  const captured = JSON.parse(readFileSync(`${directory}cart-three-2026-09-06.json`, "utf8")).cart;
  const inventory = asusCartInventory(captured);
  assert.equal(inventory.complete, true);
  assert.equal(inventory.independentlyCounted, true);
  assert.equal(inventory.independentLineCount, 2);
  assert.deepEqual(inventory.lines.find(line => line.retailerSku === '90MP04D0-BMAA02'), {
    retailerSku: '90MP04D0-BMAA02', quantity: 2, unitPriceCents: 4499, sellerName: 'ASUS', sellerType: 'first_party'
  });
  for (const mutate of [
    (cart: any) => { cart.summary_count = 2; },
    (cart: any) => { cart.subtotalAmount = 94.98; },
    (cart: any) => { cart.items[1].qty = null; },
    (cart: any) => { cart.items[1].product_price_value = 89.98; },
    (cart: any) => { cart.items[1].product_url = cart.items[0].product_url; },
    (cart: any) => { cart.items[1].preorder = 'yes'; },
    (cart: any) => { cart.items[1].options = [{ label: 'Color', value: 'Red' }]; },
    (cart: any) => { cart.items.push(cart.items[1]); cart.summary_count += 2; cart.subtotalAmount += 89.98; }
  ]) { const cart = structuredClone(captured); mutate(cart); assert.equal(asusCartInventory(cart).complete, false); }
  assert.equal(asusCartInventory(null).complete, false);
  const empty = JSON.parse(readFileSync(`${directory}cart-empty-2026-09-06.json`, "utf8")).cart;
  assert.equal(asusCartInventory(empty).complete, true);
  assert.equal(asusCartInventory({ ...empty, summary_count: 1 }).complete, false);
});
