import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { AdapterEnvironment } from "../packages/contracts/src/index.js";
import { athletaOfferBinding, athletaUrlSku, observeAthletaCart } from "../packages/browser-adapters/src/athleta.js";
import { prepareAthletaAdd, rehearseAthletaAdd, commitAthletaAdd, inspectAthletaCartBaseline, verifyAthletaAddedCart, type AthletaAddJob } from "../apps/extension/src/athleta-action.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const directory = "docs/store-evidence/athleta/";
const environment: AdapterEnvironment = { isVisible: element => !element.closest('[data-assessment-visible="false"], [hidden], [inert], [aria-hidden="true"]') };
const now = Date.now();
function product(name = "scrunchie") {
  const metadata = JSON.parse(readFileSync(`${directory}${name}-product-2026-09-06.json`, "utf8"));
  const dom = new JSDOM(`<!doctype html><html><body>${metadata.html}</body></html>`, { url: metadata.url });
  const document: Document = dom.window.document;
  const script = document.createElement("script"); script.type = "application/ld+json"; script.textContent = JSON.stringify(metadata.product); document.head.append(script);
  // The separately inspected live radio property agreed with data-selected.
  for (const input of document.querySelectorAll<HTMLInputElement>("input[data-selected]")) input.checked = input.getAttribute("data-selected") === "true";
  const job: AthletaAddJob = { adapterVersion: "athleta-add-v1", contractVersion: 1, jobId: `athleta_${metadata.sku}`, retailerId: "athleta",
    retailerSku: metadata.sku, canonicalUrl: `https://athleta.gap.com/browse/product.do?pid=${metadata.sku}`, action: "add_to_cart", quantity: 1,
    maxUnitPriceCents: 1500, maxOrderTotalCents: 1500, currency: "USD", expectedSeller: "Athleta", sellerPolicy: "first_party_only", fulfillment: "shipping",
    expiresAt: new Date(now + 60_000).toISOString() };
  return { dom, document, metadata, job };
}
function cart(name: string) {
  const capture = JSON.parse(readFileSync(`${directory}${name}-cart-2026-09-06.json`, "utf8"));
  const dom = new JSDOM(`<!doctype html><html><body><button id="shopping-bag" aria-label="${capture.bagLabel}"></button>${capture.emptyHtml || ""}<ul>${(capture.items || []).map((item: any) => item.html).join("")}</ul></body></html>`, { url: capture.url });
  return { dom, document: dom.window.document as Document };
}

test("Athleta binds both captured One Size offers, rehearses without clicks and commits once", () => {
  for (const name of ["scrunchie", "headband"]) {
    const p = product(name);
    try {
      assert.equal(athletaOfferBinding(p.document, p.document.URL, p.metadata.sku, environment)?.unitPriceCents, 1500, name);
      let clicks = 0; p.document.addEventListener("click", event => { event.preventDefault(); clicks++; });
      assert.equal(rehearseAthletaAdd(p.document, p.document.URL, p.job, now, environment).ok, true); assert.equal(clicks, 0);
      const prepared = prepareAthletaAdd(p.document, p.document.URL, p.job, now, environment);
      assert.equal(prepared.ok, true); if (!prepared.ok) continue;
      assert.equal(commitAthletaAdd(p.document, p.document.URL, p.job, prepared.authorizationId, now + 1, environment).clicked, true);
      assert.equal(commitAthletaAdd(p.document, p.document.URL, p.job, prepared.authorizationId, now + 2, environment).clicked, false);
      assert.equal(clicks, 1);
    } finally { p.dom.window.close(); }
  }
});

test("Athleta refuses mismatched selections, price, identity, quantity, fulfillment and interruptions", () => {
  const mutations: Record<string, (document: Document) => void> = {
    price: d => { d.querySelector(".fds__core-web-purchase-price")!.textContent = "$1.00"; },
    color: d => d.querySelector("input[name=buybox-color-swatch]:checked")!.setAttribute("aria-label", "Other"),
    size: d => { (d.querySelector("input[name=buybox-sizeDimension1]") as HTMLInputElement).checked = false; },
    quantity: d => { (d.querySelector("#AddToBag select") as HTMLSelectElement).value = "2"; },
    visibleQuantity: d => { d.querySelector("#pdp-quantity-selector")!.textContent = "2"; },
    shipping: d => { (d.querySelector("#shipping") as HTMLInputElement).checked = false; },
    shippingAttribute: d => d.querySelector("#shipping")!.setAttribute("data-selected", "false"),
    pickup: d => { (d.querySelector("#pickup") as HTMLInputElement).checked = true; },
    stock: d => { d.querySelector('[data-testid=shipping-inventory-status]')!.textContent = "Out of Stock"; },
    metadata: d => { const s = d.querySelector('script[type="application/ld+json"]')!; const p = JSON.parse(s.textContent!); p.offers[0].sku = "7678720420000"; s.textContent = JSON.stringify(p); },
    challenge: d => d.body.prepend("Access Denied"),
    dialog: d => d.body.insertAdjacentHTML("beforeend", '<dialog open>Choose a delivery address</dialog>'),
    duplicate: d => d.querySelector("#AddToBag")!.append(d.querySelector("#pdp-atb-btn")!.cloneNode(true))
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const p = product(); try { mutate(p.document); assert.equal(athletaOfferBinding(p.document, p.document.URL, p.metadata.sku, environment), null, name); }
    finally { p.dom.window.close(); }
  }
  for (const url of ["https://athleta.gap.com/browse/product.do?pid=784464022", "https://athleta.gap.com/browse/product.do?pid=7844640220000&vid=2", "https://athleta.gap.com/browse/product.do?pid=7844640220000&pid=7678720420000", "https://secure-athleta.gap.com/browse/product.do?pid=7844640220000"]) assert.equal(athletaUrlSku(url), "");
});

test("Athleta consumes authorization on changed binding, changed job or expired commitment", () => {
  for (const mode of ["button", "price", "job", "expired"]) {
    const p = product();
    try {
      const prepared = prepareAthletaAdd(p.document, p.document.URL, p.job, now, environment); assert.equal(prepared.ok, true); if (!prepared.ok) continue;
      if (mode === "button") { const button = p.document.querySelector("#pdp-atb-btn")!; button.replaceWith(button.cloneNode(true)); }
      if (mode === "price") p.document.querySelector(".fds__core-web-purchase-price")!.textContent = "$1.00";
      if (mode === "job") p.job.maxUnitPriceCents++;
      let clicks = 0; p.document.addEventListener("click", event => { event.preventDefault(); clicks++; });
      assert.equal(commitAthletaAdd(p.document, p.document.URL, p.job, prepared.authorizationId, now + (mode === "expired" ? 10_001 : 1), environment).clicked, false, mode);
      assert.equal(clicks, 0);
    } finally { p.dom.window.close(); }
  }
});

test("Athleta cart reader distinguishes a loading zero from an empty bag and uses current unit prices", () => {
  for (const [name, complete, quantities] of [["loading", false, []], ["empty", true, []], ["two-item", true, [1, 1]], ["three-unit", true, [1, 2]]] as const) {
    const c = cart(name);
    try {
      const inventory = observeAthletaCart(c.document, new Date(now).toISOString(), environment);
      assert.equal(inventory.complete, complete, name);
      assert.deepEqual(inventory.lines.map(line => line.quantity), quantities, name);
      for (const line of inventory.lines) assert.equal(line.unitPriceCents, 1500);
    } finally { c.dom.window.close(); }
  }
  const before = cart("two-item"), after = cart("three-unit"), p = product();
  try {
    const baseline = inspectAthletaCartBaseline(before.document, before.document.URL, now, environment);
    const rehearsal = rehearseAthletaAdd(p.document, p.document.URL, p.job, now, environment);
    assert.equal(baseline.ok, true); assert.equal(rehearsal.ok, true); if (!baseline.ok || !rehearsal.ok) return;
    assert.equal(verifyAthletaAddedCart(after.document, after.document.URL, p.job, rehearsal.proof, baseline.proof, now + 1, environment).ok, true);
    after.document.querySelector('[data-testid=product-quantity]')!.textContent = "2";
    after.document.querySelector("#shopping-bag")!.setAttribute("aria-label", "4 items in your shopping bag");
    assert.equal(verifyAthletaAddedCart(after.document, after.document.URL, p.job, rehearsal.proof, baseline.proof, now + 1, environment).ok, false);
  } finally { before.dom.window.close(); after.dom.window.close(); p.dom.window.close(); }
});
