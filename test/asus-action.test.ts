import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { AdapterEnvironment } from "../packages/contracts/src/index.js";
import { prepareAsusAdd, rehearseAsusAdd, commitAsusAdd, inspectAsusCartBaseline, verifyAsusAddedCart, type AsusAddJob } from "../apps/extension/src/asus-action.js";
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

const NOW = Date.parse("2026-09-06T10:40:00Z");
function job(metadata: any): AsusAddJob {
  return { adapterVersion: "asus-add-v1", contractVersion: 1, jobId: `asus_${metadata.sku}`, retailerId: "asus",
    retailerSku: metadata.sku, canonicalUrl: metadata.url, action: "add_to_cart", quantity: 1,
    maxUnitPriceCents: metadata.priceCents, maxOrderTotalCents: metadata.priceCents, currency: "USD",
    sellerPolicy: "first_party_only", expectedSeller: "ASUS", fulfillment: "shipping",
    expiresAt: new Date(NOW + 300_000).toISOString() };
}

test("the ASUS runner rehearses without clicks and consumes the exact product authorization once", () => {
  for (const name of ["mouse", "pad"]) {
    const { dom, document, metadata } = product(name);
    try {
      let clicks = 0;
      document.addEventListener("click", event => { event.preventDefault(); clicks++; });
      const request = job(metadata);
      assert.equal(rehearseAsusAdd(document, document.URL, request, NOW, environment).ok, true);
      assert.equal(clicks, 0);
      const prepared = prepareAsusAdd(document, document.URL, request, NOW, environment);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) continue;
      assert.equal(commitAsusAdd(document, document.URL, request, prepared.authorizationId, NOW + 1, environment).clicked, true);
      assert.equal(commitAsusAdd(document, document.URL, request, prepared.authorizationId, NOW + 2, environment).clicked, false);
      assert.equal(clicks, 1);
    } finally { dom.window.close(); }
  }
});

test("ASUS authorization rejects a changed job, price, button, document or expired commitment", () => {
  for (const mode of ["job", "price", "button", "document", "expired"]) {
    const { dom, document, metadata } = product();
    let replacement: ReturnType<typeof product> | undefined;
    try {
      const request = job(metadata);
      const prepared = prepareAsusAdd(document, document.URL, request, NOW, environment);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) continue;
      if (mode === "job") request.maxUnitPriceCents++;
      if (mode === "price") document.querySelector('[data-price-type=finalPrice]')!.setAttribute('data-price-amount', '1.00');
      if (mode === "button") { const b = document.querySelector('#product-addtocart-button')!; b.replaceWith(b.cloneNode(true)); }
      if (mode === "document") replacement = product();
      const target = replacement?.document || document;
      let clicks = 0; target.addEventListener("click", event => { event.preventDefault(); clicks++; });
      assert.equal(commitAsusAdd(target, target.URL, request, prepared.authorizationId, NOW + (mode === "expired" ? 10_001 : 1), environment).clicked, false, mode);
      assert.equal(clicks, 0);
    } finally { dom.window.close(); replacement?.dom.window.close(); }
  }
});

test("ASUS fetches only the cart section and verifies exact additions while preserving unrelated quantities", async () => {
  const page = product();
  const cartDom = new JSDOM('<!doctype html><html><body>Your Cart</body></html>', { url: 'https://eshop.asus.com/us/checkout/cart/' });
  const after = JSON.parse(readFileSync(`${directory}cart-three-2026-09-06.json`, 'utf8')).cart;
  const before = structuredClone(after);
  before.items.find((x: any) => x.product_sku === page.metadata.sku).qty = 1;
  before.summary_count = 2; before.subtotalAmount = 94.98;
  let payload = before;
  let failed = false;
  let calls = 0;
  cartDom.window.fetch = async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(url, 'https://eshop.asus.com/us/customer/section/load/?sections=cart&force_new_section_timestamp=true');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.method, undefined);
    return new Response(JSON.stringify({ cart: payload }), { status: failed ? 503 : 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const d: Document = cartDom.window.document;
    const baseline = await inspectAsusCartBaseline(d, d.URL, NOW);
    const rehearsal = rehearseAsusAdd(page.document, page.document.URL, job(page.metadata), NOW, environment);
    assert.equal(baseline.ok, true); assert.equal(rehearsal.ok, true);
    if (!baseline.ok || !rehearsal.ok) return;
    payload = after;
    assert.equal((await verifyAsusAddedCart(d, d.URL, job(page.metadata), rehearsal.proof, baseline.proof, NOW + 1)).ok, true);
    payload = structuredClone(after);
    payload.items.find((x: any) => x.product_sku !== page.metadata.sku).qty = 2;
    payload.summary_count = 4; payload.subtotalAmount = 189.96;
    assert.equal((await verifyAsusAddedCart(d, d.URL, job(page.metadata), rehearsal.proof, baseline.proof, NOW + 1)).ok, false);
    failed = true;
    assert.equal((await inspectAsusCartBaseline(d, d.URL, NOW)).ok, false);
    assert.equal(calls, 4);
  } finally { page.dom.window.close(); cartDom.window.close(); }
});
