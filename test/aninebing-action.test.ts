import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { prepareAnineBingAdd, rehearseAnineBingAdd, commitAnineBingAdd, inspectAnineBingCartBaseline, verifyAnineBingAddedCart,
  type AnineBingAddJob } from "../apps/extension/src/aninebing-action.js";
import { anineBingCartInventory } from "../packages/browser-adapters/src/aninebing.js";
import type { AdapterEnvironment } from "../packages/contracts/src/index.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const NOW = Date.parse("2026-09-06T08:00:00Z");
const CASES = [
  { handle: "anine-clutch-tango-red", variant: "41205281521736", price: 45000 },
  { handle: "york-scarf-anine-bing-tango-red", variant: "41205281194056", price: 15000 }
];
const environment: AdapterEnvironment = { isVisible: (element) => {
  for (let e: Element | null = element; e; e = e.parentElement) if (e.hasAttribute("hidden") || e.getAttribute("data-yoink-vis") === "0") return false;
  return true;
} };
const url = (fixture = CASES[0]!) => `https://www.aninebing.com/products/${fixture.handle}`;
const documentFor = (fixture = CASES[0]!): Document => new JSDOM(readFileSync(`test/fixtures/retailers/aninebing/${fixture.handle}.html`, "utf8"), { url: url(fixture) }).window.document;
const job = (fixture = CASES[0]!): AnineBingAddJob => ({ contractVersion: 1, adapterVersion: "aninebing-add-v1", jobId: `job_${fixture.variant}`,
  retailerId: "aninebing", retailerSku: fixture.variant, canonicalUrl: `${url(fixture)}?variant=${fixture.variant}`, action: "add_to_cart",
  quantity: 1, sellerPolicy: "first_party_only", expectedSeller: "ANINE BING", fulfillment: "shipping", currency: "USD",
  maxUnitPriceCents: fixture.price, maxOrderTotalCents: fixture.price, expiresAt: new Date(NOW + 60_000).toISOString() });

test("two captured live Anine Bing products rehearse without mutation and commit once", () => {
  for (const fixture of CASES) {
    const document = documentFor(fixture);
    let clicks = 0;
    document.addEventListener("click", event => { event.preventDefault(); clicks++; });
    const rehearsal = rehearseAnineBingAdd(document, url(fixture), job(fixture), NOW, environment);
    assert.equal(rehearsal.ok, true, JSON.stringify(rehearsal));
    assert.equal(clicks, 0);
    const preparation = prepareAnineBingAdd(document, url(fixture), job(fixture), NOW, environment);
    assert.equal(preparation.ok, true);
    if (!preparation.ok) continue;
    assert.equal(commitAnineBingAdd(document, url(fixture), job(fixture), preparation.authorizationId, NOW + 1, environment).clicked, true);
    assert.equal(commitAnineBingAdd(document, url(fixture), job(fixture), preparation.authorizationId, NOW + 2, environment).clicked, false);
    assert.equal(clicks, 1);
  }
});

test("Anine Bing requires consistent form, selected variant, price, stock and structured offer", () => {
  const mutations: Record<string, (d: Document) => void> = {
    quantity: d => { (d.querySelector("input[name='quantity']") as HTMLInputElement).value = "2"; },
    wrong_variant: d => { (d.querySelector("input[name='id']") as HTMLInputElement).value = CASES[1]!.variant; },
    wrong_button: d => d.querySelector("button[name='add']")!.setAttribute("data-variant-id", CASES[1]!.variant),
    wrong_color: d => d.querySelector("label.is-selected")!.setAttribute("data-product-handle", "anine-clutch-black"),
    no_selection: d => d.querySelector("label.is-selected")!.classList.remove("is-selected"),
    wrong_sku: d => d.querySelector("button[name='add']")!.setAttribute("data-sku", "another-sku"),
    wrong_price: d => { d.querySelector(".price--final .price__value")!.textContent = "$449"; },
    no_metadata: d => d.querySelector("script[type='application/ld+json']")!.remove(),
    duplicate_add: d => d.querySelector("form")!.append(d.querySelector("button[name='add']")!.cloneNode(true)),
    no_stock: d => d.querySelector("label.is-selected")!.setAttribute("data-variant-qty", "0"),
    preorder: d => d.querySelector("label.is-selected")!.setAttribute("data-preorder", "true"),
    app_exclusive: d => d.querySelector("label.is-selected")!.setAttribute("data-appexclusive", "true"),
    challenge: d => d.body.prepend("Please verify you are human"),
    disabled: d => d.querySelector("button[name='add']")!.setAttribute("disabled", ""),
    modal: d => d.body.insertAdjacentHTML("afterbegin", '<dialog open>Choose your country</dialog>')
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const document = documentFor(); mutate(document);
    assert.equal(prepareAnineBingAdd(document, url(), job(), NOW, environment).ok, false, name);
  }
  for (const override of [{ fulfillment: "pickup" }, { action: "submit_order" }, { currency: "CAD" }, { quantity: 2 },
    { maxOrderTotalCents: 100 }, { canonicalUrl: `https://evil.example/products/example?variant=${CASES[0]!.variant}` }]) {
    assert.equal(prepareAnineBingAdd(documentFor(), url(), { ...job(), ...override } as AnineBingAddJob, NOW, environment).ok, false);
  }
});

test("Anine Bing consumes authorization on offer changes and expiry", () => {
  for (const mode of ["quantity", "control", "job", "expiry"]) {
    const document = documentFor();
    const preparation = prepareAnineBingAdd(document, url(), job(), NOW, environment);
    assert.equal(preparation.ok, true);
    if (!preparation.ok) continue;
    if (mode === "quantity") (document.querySelector("input[name='quantity']") as HTMLInputElement).value = "2";
    if (mode === "control") document.querySelector("button[name='add']")!.replaceWith(document.querySelector("button[name='add']")!.cloneNode(true));
    const changedJob = mode === "job" ? { ...job(), maxUnitPriceCents: 50000 } : job();
    assert.equal(commitAnineBingAdd(document, url(), changedJob, preparation.authorizationId, NOW + (mode === "expiry" ? 10001 : 1), environment).clicked, false);
    assert.equal(commitAnineBingAdd(document, url(), job(), preparation.authorizationId, NOW + 2, environment).reason, "authorization_missing");
  }
});

const cartItem = (fixture = CASES[0]!, quantity = 1) => ({ id: Number(fixture.variant), variant_id: Number(fixture.variant), quantity,
  final_price: fixture.price, url: `/products/${fixture.handle}?variant=${fixture.variant}`, requires_shipping: true, gift_card: false });

test("Anine Bing cart evidence rejects partial counts, wrong identities, subscriptions and malformed rows", () => {
  const valid = { currency: "USD", item_count: 1, items: [cartItem()] };
  assert.equal(anineBingCartInventory(valid).complete, true);
  for (const value of [{ ...valid, item_count: 2 }, { ...valid, currency: "CAD" },
    ...[null, { ...cartItem(), url: "http://[" }, { ...cartItem(), id: 1 }, { ...cartItem(), requires_shipping: false },
      { ...cartItem(), selling_plan_allocation: {} }, { ...cartItem(), final_price: null }].map(item => ({ ...valid, items: [item] }))]) {
    assert.equal(anineBingCartInventory(value).complete, false);
  }
});

test("Anine Bing reads the cart without mutation and verifies +1 while preserving other products", async () => {
  let response = { currency: "USD", item_count: 1, items: [cartItem(CASES[1]!, 1)] };
  const document = new JSDOM('<main>Your cart</main>', { url: "https://www.aninebing.com/cart" }).window.document as Document;
  const reads: Array<[string, RequestInit]> = [];
  Object.defineProperty(document.defaultView, "fetch", { value: async (url: string, options: RequestInit) => {
    reads.push([url, options]); return { ok: true, headers: new Headers({ "content-type": "text/javascript; charset=utf-8" }), json: async () => response };
  } });
  const baseline = await inspectAnineBingCartBaseline(document, document.URL, NOW);
  const rehearsal = rehearseAnineBingAdd(documentFor(), url(), job(), NOW, environment);
  assert.equal(baseline.ok, true); assert.equal(rehearsal.ok, true);
  if (!baseline.ok || !rehearsal.ok) return;
  response = { currency: "USD", item_count: 2, items: [cartItem(CASES[1]!, 1), cartItem()] };
  assert.equal((await verifyAnineBingAddedCart(document, document.URL, job(), rehearsal.proof, baseline.proof, NOW + 1)).ok, true);
  response = { currency: "USD", item_count: 3, items: [cartItem(CASES[1]!, 2), cartItem()] };
  assert.equal((await verifyAnineBingAddedCart(document, document.URL, job(), rehearsal.proof, baseline.proof, NOW + 2)).ok, false);
  assert.equal(reads.every(([url, options]) => url === "https://www.aninebing.com/cart.js" && !options.method && !options.body), true);
});
