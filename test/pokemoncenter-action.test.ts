import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  commitPokemonCenterAdd, inspectPokemonCenterCartBaseline, preparePokemonCenterAdd,
  rehearsePokemonCenterAdd, verifyPokemonCenterAddedCart, type PokemonCenterAddJob
} from "../apps/extension/src/pokemoncenter-action.js";
import { POKEMONCENTER_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const URL = "https://www.pokemoncenter.com/product/10-10320-101/binder";
const CART = "https://www.pokemoncenter.com/cart";
const NOW = Date.parse("2026-09-06T01:00:00Z");
const HTML = readFileSync("test/fixtures/retailers/pokemoncenter-add-product.html", "utf8");
const dom = (html = HTML, url = URL): Document => new JSDOM(html, { url }).window.document;
const job = (overrides: Partial<PokemonCenterAddJob> = {}): PokemonCenterAddJob => ({
  adapterVersion: POKEMONCENTER_ADD_ADAPTER_VERSION, contractVersion: 1, jobId: "job_pokemoncenter_fixture",
  retailerId: "pokemoncenter", retailerSku: "10-10320-101", canonicalUrl: URL, action: "add_to_cart",
  quantity: 1, maxUnitPriceCents: 2999, maxOrderTotalCents: 2999, currency: "USD",
  sellerPolicy: "first_party_only", expectedSeller: "Pokémon Center", fulfillment: "shipping",
  expiresAt: new Date(NOW + 60_000).toISOString(), ...overrides
});
const cart = (lines: Array<[string, number]> = [], count = lines.reduce((n, line) => n + line[1], 0)): Document => dom(
  `<main><h1>Shopping cart</h1><span data-cart-quantity="${count}">${count} items</span>${lines.length ? lines.map(([sku, qty]) =>
    `<article class="cart-item" data-sku="${sku}"><a href="/product/${sku}/item">Product</a><span data-testid="unit-price">$29.99</span><input name="quantity" value="${qty}"></article>`).join("") : "<p>Your cart is empty</p>"}</main>`, CART);

test("Pokémon Center rehearses without a click, then clicks the bound Add exactly once", () => {
  const document = dom();
  const clicks: string[] = [];
  document.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => clicks.push(button.getAttribute("data-testid") || "recommendation")));
  assert.equal(rehearsePokemonCenterAdd(document, URL, job(), NOW).ok, true);
  assert.deepEqual(clicks, []);
  const prepared = preparePokemonCenterAdd(document, URL, job(), NOW);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(commitPokemonCenterAdd(document, URL, job(), prepared.authorizationId, NOW + 1).clicked, true);
  assert.equal(commitPokemonCenterAdd(document, URL, job(), prepared.authorizationId, NOW + 2).clicked, false);
  assert.deepEqual(clicks, ["product-add-to-cart"]);
});

test("Pokémon Center requires complete product evidence and rejects ambiguous or blocked layouts", () => {
  const cases: Record<string, (d: Document) => void> = {
    quantity: (d) => { (d.querySelector("input") as HTMLInputElement).value = "2"; },
    missing_quantity: (d) => d.querySelector("input")!.remove(),
    limit_zero: (d) => d.querySelector("input")!.setAttribute("max", "0"),
    duplicate_add: (d) => d.querySelector("article")!.append(d.querySelector("button")!.cloneNode(true)),
    missing_sku: (d) => { d.querySelector("article")!.removeAttribute("data-sku"); d.querySelector("article p")!.remove(); },
    wrong_variant: (d) => d.querySelector("article")!.setAttribute("data-sku", "10-10320-102"),
    unavailable: (d) => d.querySelector("article")!.append(" Out of stock"),
    preorder: (d) => d.querySelector("article")!.append(" Pre-order"),
    currency: (d) => d.querySelector(".product-price")!.setAttribute("data-currency", "CAD"),
    missing_shipping: (d) => { d.querySelectorAll("article p")[2]!.textContent = "Details"; },
    unavailable_shipping: (d) => { d.querySelectorAll("article p")[2]!.textContent = "Shipping not available"; },
    price: (d) => { d.querySelector(".product-price")!.textContent = "$30.00"; },
    hidden_price: (d) => d.querySelector(".product-price")!.setAttribute("style", "display:none"),
    hidden_add: (d) => d.querySelector("button")!.setAttribute("hidden", ""),
    disabled: (d) => d.querySelector("button")!.setAttribute("disabled", ""),
    marketplace: (d) => d.querySelector("article")!.append(" Sold by Another Store"),
    challenge: (d) => d.body.insertAdjacentHTML("afterbegin", '<iframe src="/_Incapsula_Resource"></iframe>'),
    queue: (d) => d.body.prepend("You’re in line. Virtual queue"),
    signin: (d) => d.body.insertAdjacentHTML("afterbegin", '<input autocomplete="current-password" type="password">'),
    overlay: (d) => d.body.insertAdjacentHTML("afterbegin", '<div role="dialog" aria-modal="true">Please continue</div>'),
    variant_unselected: (d) => d.querySelector("article")!.insertAdjacentHTML("beforeend", '<select name="size"><option value="">Select size</option></select>'),
    buy_now: (d) => { d.querySelector("button")!.textContent = "Buy now"; }
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const document = dom(); mutate(document);
    let clicks = 0; document.addEventListener("click", () => { clicks++; });
    assert.equal(preparePokemonCenterAdd(document, URL, job(), NOW).ok, false, name);
    assert.equal(clicks, 0, name);
  }
});

test("Pokémon Center refuses wrong hosts, regions, pages, contracts and purchase actions", () => {
  for (const url of [URL.replace("www.pokemoncenter.com", "pokemoncenter.com.evil.test"), URL.replace("https:", "http:"),
    URL.replace("/product/", "/en-ca/product/"), CART, "https://www.pokemoncenter.com/checkout"]) {
    assert.equal(preparePokemonCenterAdd(dom(HTML, url), url, job({ canonicalUrl: url }), NOW).ok, false, url);
  }
  for (const override of [{ fulfillment: "pickup" }, { action: "submit_order" }, { quantity: 2 },
    { retailerSku: "10-10320" }, { currency: "CAD" }, { maxOrderTotalCents: 100 },
    { adapterVersion: "pokemoncenter-add-v0" }, { expiresAt: new Date(NOW).toISOString() }]) {
    assert.equal(preparePokemonCenterAdd(dom(), URL, job(override as Partial<PokemonCenterAddJob>), NOW).ok, false);
  }
  assert.equal(preparePokemonCenterAdd(dom(HTML, CART), URL, job(), NOW).ok, false);
});

test("Pokémon Center consumes authorization and stops if the document, offer, variant, control or job changes", () => {
  for (const mode of ["price", "quantity", "variant", "control", "document", "job", "expiry", "challenge"]) {
    let document = dom();
    document.querySelector("article")!.insertAdjacentHTML("beforeend", '<select name="size"><option value="one">One</option><option value="two">Two</option></select>');
    let currentJob = job({ maxUnitPriceCents: 4000, maxOrderTotalCents: 4000 });
    const prepared = preparePokemonCenterAdd(document, URL, currentJob, NOW);
    assert.equal(prepared.ok, true, mode);
    if (!prepared.ok) continue;
    if (mode === "price") document.querySelector(".product-price")!.textContent = "$30.00";
    if (mode === "quantity") (document.querySelector("input") as HTMLInputElement).value = "2";
    if (mode === "variant") (document.querySelector("select") as HTMLSelectElement).value = "two";
    if (mode === "control") document.querySelector("button")!.replaceWith(document.querySelector("button")!.cloneNode(true));
    if (mode === "document") document = dom();
    if (mode === "job") currentJob = { ...currentJob, maxUnitPriceCents: 5000 };
    if (mode === "challenge") document.body.prepend("Additional security check is required");
    const result = commitPokemonCenterAdd(document, URL, currentJob, prepared.authorizationId, NOW + (mode === "expiry" ? 10_001 : 1));
    assert.equal(result.clicked, false, mode);
    assert.equal(commitPokemonCenterAdd(document, URL, currentJob, prepared.authorizationId, NOW + 2).reason, "authorization_missing");
  }
});

test("Pokémon Center verifies an exact +1 cart delta and preserves all previous quantities", () => {
  const offer = rehearsePokemonCenterAdd(dom(), URL, job(), NOW);
  assert.equal(offer.ok, true);
  if (!offer.ok) return;
  for (const before of [[], [["71-10304-101", 2]], [["10-10320-101", 1], ["71-10304-101", 2]]] as Array<Array<[string, number]>>) {
    const baseline = inspectPokemonCenterCartBaseline(cart(before), CART, NOW);
    assert.equal(baseline.ok, true);
    if (!baseline.ok) continue;
    const after: Array<[string, number]> = before.map(([sku, qty]) => [sku, qty + (sku === job().retailerSku ? 1 : 0)]);
    if (!after.some(([sku]) => sku === job().retailerSku)) after.push([job().retailerSku, 1]);
    assert.equal(verifyPokemonCenterAddedCart(cart(after), CART, job(), offer.proof, baseline.proof, NOW + 1).ok, true);
    assert.equal(verifyPokemonCenterAddedCart(cart(before), CART, job(), offer.proof, baseline.proof, NOW + 1).ok, false);
    assert.equal(verifyPokemonCenterAddedCart(cart([...after, ["72-11123-101", 1]]), CART, job(), offer.proof, baseline.proof, NOW + 1).ok, false);
  }
});

test("Pokémon Center rejects partial carts, conflicting counts, missing prices and false empty states", () => {
  const cases: Document[] = [cart([[job().retailerSku, 1]], 2), dom('<main><p>Your cart is empty</p></main>', CART)];
  for (const mode of ["count", "quantity", "price", "sku", "foreign_line", "duplicate", "challenge", "empty_with_link"]) {
    const document = cart([[job().retailerSku, 1]]);
    if (mode === "count") document.querySelector("[data-cart-quantity]")!.remove();
    if (mode === "quantity") document.querySelector("input")!.remove();
    if (mode === "price") document.querySelector("[data-testid='unit-price']")!.remove();
    if (mode === "sku") document.querySelector("article")!.setAttribute("data-sku", "10-10320-102");
    if (mode === "foreign_line") document.querySelector("article")!.insertAdjacentHTML("afterend", '<article class="cart-item">Unknown product</article>');
    if (mode === "duplicate") document.querySelector("article")!.after(document.querySelector("article")!.cloneNode(true));
    if (mode === "challenge") document.body.insertAdjacentHTML("afterbegin", '<iframe src="/_Incapsula_Resource"></iframe>');
    if (mode === "empty_with_link") document.querySelector("main")!.insertAdjacentHTML("beforeend", '<a href="/product/71-10304-101/product">Unparsed item</a>');
    cases.push(document);
  }
  for (const document of cases) assert.equal(inspectPokemonCenterCartBaseline(document, CART, NOW).ok, false);
  assert.equal(inspectPokemonCenterCartBaseline(cart(), "https://www.pokemoncenter.com/checkout", NOW).ok, false);
});
