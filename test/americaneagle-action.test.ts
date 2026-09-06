import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { prepareAmericanEagleAdd, rehearseAmericanEagleAdd, commitAmericanEagleAdd, inspectAmericanEagleCartBaseline,
  verifyAmericanEagleAddedCart, type AmericanEagleAddJob } from "../apps/extension/src/americaneagle-action.js";
import { americanEagleOfferBinding, americanEagleUrlSku, observeAmericanEagleCart } from "../packages/browser-adapters/src/americaneagle.js";
import type { AdapterEnvironment } from "../packages/contracts/src/index.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const NOW = Date.parse("2026-09-06T09:00:00Z");
const CASES = [
  { name: "tote-product", sku: "0045503992", price: 3495 },
  { name: "charm-product", sku: "0045350782", price: 1795 }
];
const environment: AdapterEnvironment = { isVisible: e => !e.closest('[data-yoink-vis="0"], [hidden], [inert], [aria-hidden="true"]') };
function documentFor(name = CASES[0]!.name): Document {
  const metadata = JSON.parse(readFileSync(`test/fixtures/retailers/americaneagle/${name}.json`, "utf8"));
  return new JSDOM(readFileSync(`test/fixtures/retailers/americaneagle/${name}.html`, "utf8"), { url: metadata.url }).window.document;
}
function job(fixture = CASES[0]!): AmericanEagleAddJob {
  return { contractVersion: 1, adapterVersion: "americaneagle-add-v1", jobId: `job_${fixture.sku}`, retailerId: "americaneagle",
    retailerSku: fixture.sku, canonicalUrl: `${documentFor(fixture.name).URL}?sku=${fixture.sku}`, action: "add_to_cart", quantity: 1,
    sellerPolicy: "first_party_only", expectedSeller: "American Eagle", fulfillment: "shipping", currency: "USD",
    maxUnitPriceCents: fixture.price, maxOrderTotalCents: fixture.price, expiresAt: new Date(NOW + 60_000).toISOString() };
}

test("two live American Eagle captures rehearse without clicks and commit the exact child SKU once", () => {
  for (const fixture of CASES) {
    const d = documentFor(fixture.name); let clicks = 0;
    d.addEventListener("click", event => { event.preventDefault(); clicks++; });
    const binding = americanEagleOfferBinding(d, d.URL, fixture.sku, environment);
    assert.equal(binding?.retailerSku, fixture.sku);
    const rehearsal = rehearseAmericanEagleAdd(d, d.URL, job(fixture), NOW, environment);
    assert.equal(rehearsal.ok, true, JSON.stringify(rehearsal)); assert.equal(clicks, 0);
    const preparation = prepareAmericanEagleAdd(d, d.URL, job(fixture), NOW, environment);
    assert.equal(preparation.ok, true);
    if (!preparation.ok) continue;
    assert.equal(commitAmericanEagleAdd(d, d.URL, job(fixture), preparation.authorizationId, NOW + 1, environment).clicked, true);
    assert.equal(commitAmericanEagleAdd(d, d.URL, job(fixture), preparation.authorizationId, NOW + 2, environment).clicked, false);
    assert.equal(clicks, 1);
  }
});

test("American Eagle rejects ambiguous size, quantity, price, identity and action evidence", () => {
  const mutations: Record<string, (d: Document) => void> = {
    quantity: d => { d.querySelector('[data-testid="quantity-value"]')!.textContent = "2"; },
    child_sku: d => d.querySelector('li[data-value]')!.setAttribute("data-value", CASES[1]!.sku),
    missing_child: d => d.querySelector('li[data-value]')!.removeAttribute("data-value"),
    unselected: d => d.querySelector('li.active')!.classList.remove("active"),
    sized: d => { d.querySelector('[data-test-select-size]')!.setAttribute("data-test-sizes-count", "5"); },
    size_label: d => { d.querySelector('[data-test-dropdown-toggle] [data-test-text]')!.textContent = "M"; },
    price: d => { d.querySelector('[data-test-product-sku-price]')!.textContent = "$1.00"; },
    name: d => { d.querySelector('h1')!.textContent = "Another product"; },
    metadata: d => d.querySelector('script[type="application/ld+json"]')!.remove(),
    duplicate: d => d.querySelector('[data-test-psp]')!.append(d.querySelector('button[data-test-btn="addToBag"]')!.cloneNode(true)),
    hidden: d => d.querySelector('[data-test-psp]')!.setAttribute("hidden", ""),
    disabled: d => d.querySelector('button[data-test-btn="addToBag"]')!.setAttribute("disabled", ""),
    challenge: d => d.body.prepend("Please verify you are human"),
    dialog: d => d.body.insertAdjacentHTML("afterbegin", '<dialog open>Choose your location</dialog>'),
    pickup: d => d.querySelector('[data-test-psp]')!.insertAdjacentHTML("afterbegin", '<input type="radio" checked aria-label="Pickup">')
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const d = documentFor(); mutate(d); let clicks = 0; d.addEventListener("click", () => clicks++);
    assert.equal(prepareAmericanEagleAdd(d, d.URL, job(), NOW, environment).ok, false, name); assert.equal(clicks, 0);
  }
  for (const change of [{ fulfillment: "pickup" }, { action: "submit_order" }, { currency: "CAD" }, { quantity: 2 },
    { maxUnitPriceCents: 1 }, { canonicalUrl: "https://www.ae.com/us/en/p/0577_9778_900?sku=0045503992" }, { canonicalUrl: "https://www.ae.com/ca/en/p/0427_9775_410?sku=0045503992" }]) {
    const d = documentFor();
    assert.equal(prepareAmericanEagleAdd(d, d.URL, { ...job(), ...change } as AmericanEagleAddJob, NOW, environment).ok, false);
  }
  for (const url of ["https://ae.com.evil.example/us/en/p/0427_9775_410?sku=0045503992", "https://ae.com/us/en/p/0427_9775_410?sku=0045503992&sku=0045350782",
    "https://ae.com/ca/en/p/0427_9775_410?sku=0045503992", "https://ae.com/us/en/p/0427_9775_410"]) assert.equal(americanEagleUrlSku(url), "");
});

test("American Eagle consumes authorization on changes, rebinding, stale documents and expiry", () => {
  for (const mode of ["price", "child", "control", "root", "document", "job", "expiry", "clock_backwards"]) {
    let d = documentFor(); const currentJob = { ...job(), maxUnitPriceCents: 5000 };
    const prepared = prepareAmericanEagleAdd(d, d.URL, currentJob, NOW, environment); assert.equal(prepared.ok, true);
    if (!prepared.ok) continue;
    if (mode === "price") {
      d.querySelector('[data-test-product-sku-price]')!.textContent = "$30.00";
      const script = d.querySelector('script[type="application/ld+json"]')!;
      const product = JSON.parse(script.textContent!); product.offers.price = "30.00"; script.textContent = JSON.stringify(product);
    }
    if (mode === "child") d.querySelector('li[data-value]')!.setAttribute("data-value", CASES[1]!.sku);
    if (mode === "control") { const button = d.querySelector('button[data-test-btn="addToBag"]')!; button.replaceWith(button.cloneNode(true)); }
    if (mode === "root") { const root = d.querySelector('[data-test-sticky-content]')!; root.replaceWith(root.cloneNode(true)); }
    if (mode === "document") d = documentFor();
    if (mode === "job") currentJob.maxUnitPriceCents++;
    const now = mode === "expiry" ? NOW + 10001 : mode === "clock_backwards" ? NOW - 1 : NOW + 1;
    let clicks = 0; d.addEventListener("click", () => clicks++);
    assert.equal(commitAmericanEagleAdd(d, d.URL, currentJob, prepared.authorizationId, now, environment).clicked, false, mode);
    assert.equal(commitAmericanEagleAdd(d, d.URL, currentJob, prepared.authorizationId, NOW + 2, environment).reason, "authorization_missing");
    assert.equal(clicks, 0);
  }
});

test("American Eagle verifies both real cart deltas and preserves existing child SKUs", () => {
  for (const [index, fixture] of CASES.entries()) {
    const before = documentFor(index ? "tote-cart" : "empty-cart");
    const after = documentFor(index ? "two-item-cart" : "tote-cart");
    const product = documentFor(fixture.name);
    const baseline = inspectAmericanEagleCartBaseline(before, before.URL, NOW, environment);
    const rehearsal = rehearseAmericanEagleAdd(product, product.URL, job(fixture), NOW, environment);
    assert.equal(baseline.ok, true); assert.equal(rehearsal.ok, true);
    if (!baseline.ok || !rehearsal.ok) continue;
    assert.equal(verifyAmericanEagleAddedCart(after, after.URL, job(fixture), rehearsal.proof, baseline.proof, NOW + 1, environment).ok, true);
    after.querySelector('[data-sku-id]')!.setAttribute("data-sku-id", "9999999999");
    assert.equal(verifyAmericanEagleAddedCart(after, after.URL, job(fixture), rehearsal.proof, baseline.proof, NOW + 2, environment).ok, false);
  }
  for (const mutation of [
    (d: Document) => { d.querySelector('a.qa-tnav-bag-icon [data-test-content]')!.textContent = "3"; },
    (d: Document) => d.querySelector('.cart-item')!.remove(),
    (d: Document) => d.querySelector('.cart-item')!.setAttribute("data-product-id", "9999_9999_999"),
    (d: Document) => d.querySelector('.cart-item')!.setAttribute("data-sku-id", "0045503992"),
    (d: Document) => { d.querySelector('[data-test-cart-item-price]')!.textContent = "CA$17.95"; }
  ]) { const d = documentFor("two-item-cart"); mutation(d); assert.equal(observeAmericanEagleCart(d, undefined, environment).complete, false); }
  const empty = documentFor("empty-cart"); empty.body.textContent = "Loading";
  assert.equal(inspectAmericanEagleCartBaseline(empty, empty.URL, NOW, environment).ok, false);
});

test("American Eagle's captured quantity-two row uses the line total to verify one extra unit", () => {
  const before = documentFor("two-item-cart"), after = documentFor("three-unit-cart"), product = documentFor();
  const baseline = inspectAmericanEagleCartBaseline(before, before.URL, NOW, environment);
  const rehearsal = rehearseAmericanEagleAdd(product, product.URL, job(), NOW, environment);
  assert.equal(baseline.ok, true); assert.equal(rehearsal.ok, true);
  if (!baseline.ok || !rehearsal.ok) return;
  const result = verifyAmericanEagleAddedCart(after, after.URL, job(), rehearsal.proof, baseline.proof, NOW + 1, environment);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(result.proof.unitPriceCents, 3495);
  after.querySelector('[data-sku-id="0045350782"] [data-testid="quantity"]')!.textContent = "Qty: 2";
  after.querySelector('a.qa-tnav-bag-icon [data-test-content]')!.textContent = "4";
  assert.equal(verifyAmericanEagleAddedCart(after, after.URL, job(), rehearsal.proof, baseline.proof, NOW + 1, environment).ok, false);
});
