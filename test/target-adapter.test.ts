import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type BrowserActionContract,
  verifyCheckoutEvidence,
  verifyLiveOffer,
  verifySingleJobCart
} from "../packages/browser-safety/src/index.js";
import {
  extractTargetSku,
  observeTargetCart,
  observeTargetCheckout,
  observeTargetOffer,
  parseUsPrice,
  targetAddBinding,
  targetAddControl,
  targetAdapterLayoutEvidence,
  targetCartLines,
  targetCartQuantityControl,
  targetInteractiveBlock,
  targetPageKind,
  targetPurchaseLimit,
  targetSecurityChallenge
} from "../packages/browser-adapters/src/target.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };
const FIXTURES = join(process.cwd(), "test", "fixtures", "target");
const TARGET_ADAPTER_SOURCE = readFileSync(join(process.cwd(), "packages", "browser-adapters", "src", "target.ts"), "utf8");
const NOW = "2026-08-22T23:00:00.000Z";
const PRODUCT_URL = "https://www.target.com/p/fixture/-/A-1011483414";

function fixture(name: string, url = PRODUCT_URL): Document {
  return new JSDOM(readFileSync(join(FIXTURES, name), "utf8"), { url }).window.document;
}

test("Target observer is structurally read-only", () => {
  assert.doesNotMatch(TARGET_ADAPTER_SOURCE, /\.click\s*\(/);
  assert.doesNotMatch(TARGET_ADAPTER_SOURCE, /dispatchEvent\s*\(/);
  assert.doesNotMatch(TARGET_ADAPTER_SOURCE, /\bfetch\s*\(/);
});

test("Target URL and US-price parsing are exact and locale-safe", () => {
  assert.equal(extractTargetSku(PRODUCT_URL), "1011483414");
  assert.equal(extractTargetSku("https://www.target.com/p/fixture?preselect=1011483414"), "1011483414");
  assert.equal(extractTargetSku("https://attacker.example/p/A-1011483414"), "");
  assert.equal(extractTargetSku("https://user:password@www.target.com/p/fixture/-/A-1011483414"), "");
  assert.equal(parseUsPrice("Now $1,249.95"), 124995);
  assert.equal(parseUsPrice("C$ 59.99"), null);
  assert.equal(targetPageKind("https://www.target.com/co-review"), "checkout");
  assert.equal(targetPageKind("https://www.target.com/account"), "auth");
});

test("Target product observation binds the exact TCIN, offer, seller, and fulfillment without clicking", () => {
  const firstParty = observeTargetOffer(fixture("product-first-party.html"), PRODUCT_URL, "1011483414", "shipping", NOW);
  assert.deepEqual({
    sku: firstParty.retailerSku,
    availability: firstParty.availability,
    price: firstParty.unitPriceCents,
    seller: firstParty.sellerName,
    sellerType: firstParty.sellerType,
    fulfillment: firstParty.fulfillment,
    actionable: firstParty.addControlActionable
  }, {
    sku: "1011483414",
    availability: "in_stock",
    price: 5999,
    seller: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true
  });

  const marketplace = observeTargetOffer(fixture("product-marketplace.html"), PRODUCT_URL, "1011483414", "shipping", NOW);
  assert.equal(marketplace.sellerType, "third_party");
  assert.equal(marketplace.sellerName, "FIXTURE_SELLER_A");
  assert.equal(marketplace.unitPriceCents, 8999);
  const wrongSku = observeTargetOffer(fixture("product-first-party.html"), PRODUCT_URL, "9999999999", "shipping", NOW);
  assert.equal(wrongSku.addControlActionable, false);
  assert.equal(wrongSku.availability, "unknown");
});

test("Target binds a hydrated ProductDetailPrice module without reading recommendation prices", () => {
  const document = new JSDOM(`<body><main>
    <aside data-test="recommendations">
      <div data-module-type="ProductDetailPrice">$4.99</div>
    </aside>
    <div data-module-type="ProductDetailPrice">
      <span>$29.99</span>
      <span data-test="product-regular-price">reg $39.99</span>
    </div>
    <section aria-label="Fulfillment" data-test="@web/AddToCart/FulfillmentSection" role="region">
      <button type="button" data-test="fulfillment-cell-shipping" aria-label="shipping - selected - Arrives tomorrow" aria-selected="true">Shipping</button>
      <button type="button">Add to cart</button>
    </section>
  </main></body>`, { url: PRODUCT_URL }).window.document;
  const observation = observeTargetOffer(document, PRODUCT_URL, "1011483414", "shipping", NOW);
  const layout = targetAdapterLayoutEvidence(document, PRODUCT_URL, "1011483414", "shipping");
  assert.equal(observation.unitPriceCents, 2999);
  assert.equal(observation.availability, "in_stock");
  assert.equal(observation.addControlActionable, true);
  assert.equal(layout.priceCandidateCount, 1);
});

test("Target product observation ignores hidden, recommended, and wrong-SKU controls", () => {
  const document = new JSDOM(`<body><main>
    <div data-test="product-price">$59.99</div>
    <section hidden data-tcin="1011483414"><button id="addToCartButtonOrTextIdFor1011483414" data-fulfillment="shipping">Ship it</button></section>
    <aside data-test="recommendations" data-tcin="1011483414"><button data-test="shipItButton" data-fulfillment="shipping">Ship it</button></aside>
    <section data-tcin="9999999999"><button data-test="shipItButton" data-fulfillment="shipping">Ship it</button></section>
  </main></body>`, { url: PRODUCT_URL }).window.document;
  const observation = observeTargetOffer(document, PRODUCT_URL, "1011483414", "shipping", NOW);
  assert.equal(observation.addControlActionable, false);
  assert.equal(observation.availability, "unknown");
});

test("Target recovers the hydrated fulfillment layout when the exact page has one semantic Add control", () => {
  const document = new JSDOM(`<body><main>
    <div data-test="product-price">$34.99</div>
    <section aria-label="Fulfillment" data-test="@web/AddToCart/FulfillmentSection" role="region">
      <button type="button" data-test="fulfillment-cell-pickup" aria-label="pickup - unselected - Available today">Pickup</button>
      <button type="button" data-test="fulfillment-cell-delivery" aria-label="delivery - unselected - Not available">Delivery</button>
      <button type="button" data-test="fulfillment-cell-shipping" aria-label="shipping - selected - Arrives tomorrow" aria-selected="true">Shipping</button>
      <button type="button">Add to cart</button>
    </section>
  </main></body>`, { url: PRODUCT_URL }).window.document;
  const observation = observeTargetOffer(document, PRODUCT_URL, "1011483414", "shipping", NOW);
  assert.deepEqual({
    availability: observation.availability,
    price: observation.unitPriceCents,
    seller: observation.sellerName,
    sellerType: observation.sellerType,
    fulfillment: observation.fulfillment,
    actionable: observation.addControlActionable
  }, {
    availability: "in_stock",
    price: 3499,
    seller: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    actionable: true
  });
  assert.equal(targetAddControl(document, PRODUCT_URL, "1011483414", "shipping")?.textContent, "Add to cart");

  document.querySelector("[aria-label='Fulfillment']")?.setAttribute("data-tcin", "9999999999");
  const conflicting = observeTargetOffer(document, PRODUCT_URL, "1011483414", "shipping", NOW);
  assert.equal(conflicting.addControlActionable, false);
  assert.equal(conflicting.availability, "unknown");
});

test("a marketplace recommendation cannot poison first-party evidence in the exact Target buy box", () => {
  const document = new JSDOM(`<body><main>
    <section data-test="product-detail">
      <div data-test="product-price">$44.99</div>
      <section data-test="fulfillment-shipping" data-tcin="1011483414">
        <button id="addToCartButtonOrTextIdFor1011483414" data-fulfillment="shipping">Ship it</button>
      </section>
    </section>
    <aside data-test="recommendations"><p data-test="sold-by">Sold by FIXTURE_RECOMMENDATION_SELLER</p></aside>
  </main></body>`, { url: PRODUCT_URL }).window.document;
  const observation = observeTargetOffer(document, PRODUCT_URL, "1011483414", "shipping", NOW);
  assert.equal(observation.sellerName, "Target");
  assert.equal(observation.sellerType, "first_party");
  assert.equal(observation.addControlActionable, true);
});

test("Target modern fulfillment tiles bind an available shipping path without trusting recommendation duplicates", () => {
  const document = fixture("product-modern-pickup-selected.html");
  const candidate = observeTargetOffer(document, PRODUCT_URL, "1011483414", "shipping", NOW);
  assert.deepEqual({
    availability: candidate.availability,
    price: candidate.unitPriceCents,
    seller: candidate.sellerName,
    fulfillment: candidate.fulfillment,
    actionable: candidate.addControlActionable
  }, {
    availability: "in_stock",
    price: 539,
    seller: "Target",
    fulfillment: "shipping",
    actionable: true
  });
  const binding = targetAddBinding(document, PRODUCT_URL, "1011483414", "shipping");
  assert.equal(binding.control?.closest("[aria-label='Fulfillment']") !== null, true);
  assert.equal(binding.fulfillmentControl?.getAttribute("data-test"), "fulfillment-cell-shipping");
  assert.equal(binding.selectionRequired, true);
  assert.equal(targetAddControl(document, PRODUCT_URL, "1011483414", "shipping"), null);

  const selected = observeTargetOffer(document, PRODUCT_URL, "1011483414", "either", NOW);
  assert.equal(selected.fulfillment, "shipping");
  const explicitPickup = observeTargetOffer(document, PRODUCT_URL, "1011483414", "pickup", NOW);
  assert.equal(explicitPickup.fulfillment, "pickup");
});

test("Target uses available Delivery only as a remote fallback and rejects Check availability", () => {
  const document = fixture("product-modern-pickup-selected.html");
  const shipping = document.querySelector("[data-test='fulfillment-cell-shipping']");
  if (shipping) {
    shipping.setAttribute("aria-label", "shipping - unselected - 3 of 3 - Not available");
    shipping.textContent = "Shipping Not available";
  }
  const unavailable = observeTargetOffer(document, PRODUCT_URL, "1011483414", "shipping", NOW);
  assert.equal(unavailable.fulfillment, "unknown");
  assert.equal(unavailable.addControlActionable, false);

  const delivery = document.querySelector("[data-test='fulfillment-cell-delivery']");
  if (delivery) {
    delivery.setAttribute("aria-label", "delivery - unselected - 2 of 3 - Get it today");
    delivery.textContent = "Delivery Get it today";
  }
  const available = observeTargetOffer(document, PRODUCT_URL, "1011483414", "shipping", NOW);
  const binding = targetAddBinding(document, PRODUCT_URL, "1011483414", "shipping");
  assert.equal(available.fulfillment, "shipping");
  assert.equal(available.addControlActionable, true);
  assert.equal(binding.fulfillmentControl, delivery);
  assert.equal(binding.selectionRequired, true);
});

test("Target observation classifies authentication, MFA, location, membership, queue, and challenge as manual", () => {
  const page = (markup: string) => new JSDOM(`<body><main>${markup}</main></body>`, { url: PRODUCT_URL }).window.document;
  assert.equal(targetInteractiveBlock(page(`<form action="/login"><input type="password" autocomplete="current-password"></form>`)), "auth");
  assert.equal(targetInteractiveBlock(page(`<input autocomplete="one-time-code" name="otp">`)), "mfa");
  assert.equal(targetInteractiveBlock(page(`<div role="dialog"><button>Choose your pickup store</button></div>`)), "location");
  assert.equal(targetInteractiveBlock(page(`<div role="dialog"><button>Join Target Circle 360 free trial</button></div>`)), "membership");
  assert.equal(targetInteractiveBlock(page(`<section>You’re in line in our virtual queue</section>`)), "queue");
  const challenge = page(`<iframe src="https://security.example/captcha"></iframe>`);
  assert.equal(targetSecurityChallenge(challenge), true);
  assert.equal(targetInteractiveBlock(challenge), "unknown");
  const hiddenChallengeCopy = page(`<script>window.copy = "additional security challenge";</script><main>Product details</main>`);
  assert.equal(targetSecurityChallenge(hiddenChallengeCopy), false);
  assert.equal(targetInteractiveBlock(page(`<div role="dialog"><h2>Loading screen</h2><p>Something went wrong. Please try again in a bit.</p></div>`)), "unknown");
  assert.equal(targetInteractiveBlock(page(`<button aria-label="sign in to favorite this product">Favorite</button>`)), "");
});

test("Target cart observation independently counts exact lines and fails closed on an unknown SKU", () => {
  const cart = observeTargetCart(fixture("cart.html", "https://www.target.com/cart"), NOW);
  assert.equal(cart.complete, true);
  assert.equal(cart.independentLineCount, 1);
  assert.deepEqual(cart.lines[0], {
    retailerSku: "1011483414",
    quantity: 1,
    unitPriceCents: 5999,
    sellerName: "Target",
    sellerType: "first_party"
  });
  const unknown = new JSDOM(`<body><article data-test="cart-item"><span data-test="unit-price">$59.99</span></article></body>`).window.document;
  assert.equal(observeTargetCart(unknown, NOW).complete, false);
});

test("Target checkout emits only fingerprints and bounded structural evidence", async () => {
  const seenRawValues: string[][] = [];
  const signer = async (values: string[]) => {
    seenRawValues.push(values);
    return createHash("sha256").update(`fixture-key:${values.join("|")}`).digest("hex");
  };
  const evidence = await observeTargetCheckout(
    fixture("checkout.html", "https://www.target.com/co-review"),
    { retailerSku: "1011483414", quantity: 1, fulfillment: "shipping" },
    signer,
    NOW
  );
  assert.equal(evidence.fulfillment, "shipping");
  assert.match(evidence.destinationFingerprint, /^[a-f0-9]{64}$/);
  assert.match(evidence.paymentInstrumentSetFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(evidence.cartComplete, true);
  assert.equal(evidence.cartSku, "1011483414");
  assert.equal(evidence.cartQuantity, 1);
  assert.equal(evidence.orderTotalCents, 6479);
  assert.equal(evidence.substitutions, "not-applicable");
  assert.equal(evidence.submitControlActionable, true);
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes("DESTINATION_PROFILE_A"), false);
  assert.equal(serialized.includes("PAYMENT_PROFILE_A"), false);
  assert.equal(seenRawValues.flat().includes("DESTINATION_PROFILE_A"), true);
  assert.equal(seenRawValues.flat().includes("PAYMENT_PROFILE_A"), true);
});

test("Target observations satisfy the shared verifier only as one exact bounded purchase", async () => {
  const now = new Date(NOW).getTime();
  const job: BrowserActionContract = {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    jobId: "job_target_fixture",
    retailerId: "target",
    retailerSku: "1011483414",
    canonicalUrl: PRODUCT_URL,
    action: "prepare_checkout",
    quantity: 1,
    maxUnitPriceCents: 6000,
    maxOrderTotalCents: 6500,
    currency: "USD",
    sellerPolicy: "first_party_only",
    expectedSeller: "Target",
    fulfillment: "shipping",
    expiresAt: new Date(now + 60_000).toISOString()
  };
  const offer = observeTargetOffer(fixture("product-first-party.html"), PRODUCT_URL, job.retailerSku, job.fulfillment, NOW);
  const liveResult = verifyLiveOffer(job, offer, now);
  assert.equal(liveResult.ok, true);
  if (!liveResult.ok) return;
  const cartDocument = fixture("cart.html", "https://www.target.com/cart");
  const cart = observeTargetCart(cartDocument, NOW);
  const cartResult = verifySingleJobCart(job, cart, liveResult.proof, now);
  assert.equal(cartResult.ok, true);
  if (!cartResult.ok) return;
  const signer = async (values: string[]) => createHash("sha256").update(`fixture-key:${values.join("|")}`).digest("hex");
  const checkout = await observeTargetCheckout(
    fixture("checkout.html", "https://www.target.com/co-review"),
    { retailerSku: job.retailerSku, quantity: job.quantity, fulfillment: job.fulfillment },
    signer,
    NOW
  );
  assert.equal(verifyCheckoutEvidence(job, cartResult.proof, checkout, now).ok, true);

  const foreign = new JSDOM(`<body><main>
    <article data-test="cart-item" data-tcin="1011483414"><span data-test="unit-price">$59.99</span><input name="quantity" value="1"></article>
    <article data-test="cart-item" data-tcin="2020202020"><span data-test="unit-price">$1.00</span><input name="quantity" value="1"></article>
  </main></body>`).window.document;
  const foreignCart = observeTargetCart(foreign, NOW);
  assert.equal(verifySingleJobCart(job, foreignCart, liveResult.proof, now).reason, "foreign_cart_line");

  const unsafeDocument = fixture("checkout.html", "https://www.target.com/co-review");
  unsafeDocument.querySelector("main")?.insertAdjacentHTML("beforeend", `<label><input name="gift-wrap" type="checkbox" checked>Gift wrap</label>`);
  const unsafeCheckout = await observeTargetCheckout(
    unsafeDocument,
    { retailerSku: job.retailerSku, quantity: job.quantity, fulfillment: job.fulfillment },
    signer,
    NOW
  );
  assert.deepEqual(unsafeCheckout.unsafeChoices, ["gift_option"]);
  assert.equal(verifyCheckoutEvidence(job, cartResult.proof, unsafeCheckout, now).reason, "manual_action_required");
});

// ---- Cart reader tolerance (2026-10-10) ----
// Target's real cart page has never been captured: the markup below is
// ASSUMED from plausible variants. Replace these with a promoted capture.
const CART_URL = "https://www.target.com/cart";

function cartPage(html: string): Document {
  return new JSDOM(html, { url: CART_URL }).window.document;
}

function cartLine(inner: string, attributes = `data-test="cartItem"`): Document {
  return cartPage(`<main><div ${attributes}>${inner}</div></main>`);
}

test("Target cart markup is ASSUMED until a real cart page is captured: every cart fixture says so", () => {
  for (const name of ["cart.html", "cart-quantity-select.html", "cart-quantity-dropdown.html", "cart-quantity-stepper.html"]) {
    assert.match(readFileSync(join(FIXTURES, name), "utf8"), /^<!-- SYNTHETIC Target cart: ASSUMED markup/, name);
  }
});

test("Target cart lines bind relative product links and preselected variants, and never a line that names two items", () => {
  const read = (document: Document) => {
    const cart = observeTargetCart(document, NOW);
    return { complete: cart.complete, lines: cart.lines.map((line) => [line.retailerSku, line.quantity, line.unitPriceCents]) };
  };
  const qty = `<div data-test="cartItem-price">$17.99</div><select aria-label="Quantity"><option selected>1</option><option>2</option></select>`;
  assert.deepEqual(read(cartLine(`<a href="/p/fixture/-/A-95290386">Fixture</a>${qty}`)),
    { complete: true, lines: [["95290386", 1, 1799]] });
  assert.deepEqual(read(cartLine(`<a href="/p/fixture/-/A-95290000?preselect=95290386">Fixture</a>${qty}`)),
    { complete: true, lines: [["95290386", 1, 1799]] });
  assert.deepEqual(read(cartLine(`<a href="/p/fixture/-/A-95290386">Fixture</a><input type="hidden" name="tcin" value="95290386">${qty}`,
    `data-test="cartItem" data-tcin="95290386"`)), { complete: true, lines: [["95290386", 1, 1799]] });
  for (const conflict of [
    cartLine(`<a href="/p/fixture/-/A-95290386">Fixture</a><a href="/p/other/-/A-95238329">Other</a>${qty}`),
    cartLine(`<a href="/p/other/-/A-95238329">Other</a>${qty}`, `data-test="cartItem" data-tcin="95290386"`),
    cartLine(`<a href="https://example.com/p/fixture/-/A-95290386">Fixture</a>${qty}`)
  ]) {
    const cart = observeTargetCart(conflict, NOW);
    assert.equal(cart.complete, false);
    assert.equal(cart.lines[0]?.retailerSku, "");
  }
  assert.deepEqual(targetCartLines(cartLine(`<a href="/p/fixture/-/A-95290386">Fixture</a><a href="/p/other/-/A-95238329">Other</a>`))
    .map((line) => [line.sku, [...line.tcins].sort()]), [["", ["95238329", "95290386"]]]);
});

test("Target cart reads a line's quantity from 1 to 99 in each assumed control and refuses contradictions", () => {
  const document = (inner: string) => cartLine(`<a href="/p/x/-/A-95290386">X</a><div data-test="cartItem-price">$1.00</div>${inner}`);
  const read = (inner: string) => observeTargetCart(document(inner), NOW).lines[0]?.quantity;
  assert.equal(read(`<select data-test="cartItem-qty"><option value="12" selected>12</option><option value="13">13</option></select>`), 12);
  assert.equal(read(`<label for="q">Qty</label><select id="q"><option value="qty-1">Qty 1</option><option value="qty-2" selected>Qty 2</option></select>`), 2);
  assert.equal(read(`<select><option>1</option><option selected>2</option><option>3</option></select>`), 2);
  assert.equal(read(`<input type="number" aria-label="Quantity" value="42" max="99">`), 42);
  assert.equal(read(`<div role="spinbutton" aria-label="Quantity" aria-valuenow="7"></div>`), 7);
  assert.equal(read(`<div data-test="cartItem-quantity-stepper"><button aria-label="Decrease quantity">-</button><span>99</span><button aria-label="Increase quantity">+</button></div>`), 99);
  assert.equal(read(`<div><button aria-label="Remove X from cart">x</button><span class="sr-only">Current quantity is 7</span><span aria-hidden="true">7</span><button aria-label="Increase quantity">+</button></div>`), 7);
  assert.equal(read(`<div data-test="quantity-stepper"><button aria-label="Decrease quantity">-</button><input aria-label="Qty" value="3"><button aria-label="Increase quantity">+</button></div>`), 3);
  assert.equal(read(`<button data-test="cartItem-qty" aria-haspopup="listbox" aria-label="Quantity, 5 selected">Qty 5</button>`), 5);
  assert.equal(read(`<span data-test="cartItem-qty">Qty 2</span>`), 2);
  // Unreadable or contradictory readings leave the line, and so the cart, unproven.
  assert.equal(read(`<span data-test="cartItem-qty">Qty 100</span>`), null);
  assert.equal(read(`<select aria-label="Quantity"><option selected>10+</option></select>`), null);
  assert.equal(read(`<div data-test="quantity-stepper"><button aria-label="Decrease quantity">-</button><span>2 of 3</span><button aria-label="Increase quantity">+</button></div>`), null);
  assert.equal(read(`<select aria-label="Quantity"><option selected>2</option></select><button aria-haspopup="listbox" aria-label="Quantity, 3 selected">Qty 3</button>`), null);
  // A native select mirroring a custom dropdown reads when both agree, but neither is raised.
  const mirrored = `<select aria-label="Quantity" tabindex="-1"><option selected>3</option><option>4</option></select><button aria-haspopup="listbox" aria-label="Quantity, 3 selected">Qty 3</button>`;
  assert.equal(read(mirrored), 3);
  assert.equal(targetCartQuantityControl(targetCartLines(document(mirrored))[0]!.element), null);
});

test("Target cart reads each line's own limit: highest option, input max, a disabled plus, or Limit/Max text in the line", () => {
  const control = (inner: string) => {
    const [line] = targetCartLines(cartLine(`<a href="/p/x/-/A-95290386">X</a>${inner}`));
    const found = targetCartQuantityControl(line!.element);
    return found && { kind: found.kind, quantity: found.quantity, storeLimit: found.storeLimit };
  };
  assert.deepEqual(control(`<select aria-label="Quantity"><option selected>1</option><option>2</option></select>`), { kind: "select", quantity: 1, storeLimit: 2 });
  assert.deepEqual(control(`<input type="number" aria-label="Quantity" value="1" max="4">`), { kind: "input", quantity: 1, storeLimit: 4 });
  assert.deepEqual(control(`<div data-test="quantity-stepper"><button aria-label="Decrease quantity">-</button><span>2</span><button aria-label="Increase quantity" disabled>+</button></div>`),
    { kind: "stepper", quantity: 2, storeLimit: 2 });
  assert.deepEqual(control(`<select aria-label="Quantity"><option selected>1</option><option>2</option><option>3</option></select><p>Limit 2 per guest</p>`),
    { kind: "select", quantity: 1, storeLimit: 2 });
  assert.deepEqual(control(`<button aria-haspopup="listbox" aria-label="Quantity, 1 selected">Qty 1</button><p>Max 10</p>`), { kind: "dropdown", quantity: 1, storeLimit: 10 });
  assert.deepEqual(control(`<select aria-label="Quantity"><option selected>1</option><option>2</option></select><p>Limited time deal: save 10%</p>`),
    { kind: "select", quantity: 1, storeLimit: 2 });
  // A product title is not a limit, and a promotion button is not a stepper.
  assert.deepEqual(control(`<div data-test="cartItem-title">Fixture Max 2 Pack</div><select aria-label="Quantity"><option selected>1</option><option>2</option><option>3</option></select>`),
    { kind: "select", quantity: 1, storeLimit: 3 });
  assert.deepEqual(control(`<select aria-label="Quantity"><option selected>1</option><option>2</option></select><button>Join Target Circle 360 plus</button><button>Increase your savings with Circle Card</button>`),
    { kind: "select", quantity: 1, storeLimit: 2 });
});

test("Target cart reads one unit's price on a line of several and never divides an unmarked total", () => {
  const price = (inner: string, quantity: number) => observeTargetCart(cartLine(`<a href="/p/x/-/A-95290386">X</a>`
    + `<select aria-label="Quantity"><option selected>${quantity}</option><option>10</option></select>${inner}`), NOW).lines[0]?.unitPriceCents;
  assert.equal(price(`<div data-test="cartItem-price">$35.98</div><div data-test="cartItem-unitPrice">$17.99</div>`, 2), 1799);
  assert.equal(price(`<div data-test="cartItem-price">$35.98 <span>$17.99 each</span></div>`, 2), 1799);
  assert.equal(price(`<div data-test="cartItem-price">$35.98</div><span data-test="cartItem-price-detail">$17.99</span>`, 2), 1799);
  assert.equal(price(`<div data-test="cartItem-price">$35.98</div>`, 2), 3598, "an unmarked total fails the unit cap closed");
  assert.equal(price(`<div data-test="cartItem-price">$17.99</div>`, 1), 1799);
});

test("Target recognises an empty cart only from its own visible message", () => {
  const empty = (html: string) => {
    const cart = observeTargetCart(cartPage(html), NOW);
    return cart.lines.length === 0 && cart.independentlyCounted && cart.complete;
  };
  for (const html of [
    `<main><h1>Your cart is empty</h1></main>`,
    `<main><h2>Your cart is currently empty</h2><p>Have an account? Sign in to see items you added before.</p></main>`,
    `<div role="main"><p>There are no items in your cart.</p></div>`,
    `<div data-test="emptyCartPage"><p>Your cart’s empty</p></div>`
  ]) assert.equal(empty(html), true, html);
  for (const html of [
    `<main><h1 aria-hidden="true">Your cart is empty</h1></main>`,
    `<main><script>window.copy = "Your cart is empty";</script></main>`,
    `<main><p>Loading your cart…</p></main>`,
    `<header><p>Your cart is empty</p></header><main></main>`
  ]) assert.equal(empty(html), false, html);
});

test("Target purchase limit is read only for the exact product page's TCIN", () => {
  const url = "https://www.target.com/p/-/A-95290386";
  const data = (tcin: string, limit: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { q: [
    { module_type: "ProductDetailWebDatasourceCore", module_data: { data: { product: { tcin, item: { fulfillment: { purchase_limit: limit } } } } } }
  ] } })}</script>`;
  const page = (html: string, pageUrl = url) => new JSDOM(`<main>${html}</main>`, { url: pageUrl }).window.document;
  assert.equal(targetPurchaseLimit(page(data("95290386", 2)), url, "95290386"), 2);
  assert.equal(targetPurchaseLimit(page(data("95290386", "4")), url, "95290386"), 4);
  assert.equal(targetPurchaseLimit(page(data("95238329", 2)), url, "95290386"), null);
  assert.equal(targetPurchaseLimit(page(data("95290386", 2)), "https://www.target.com/p/-/A-95238329", "95290386"), null);
  assert.equal(targetPurchaseLimit(page(`${data("95290386", 2)}${data("95290386", 2)}`.replace(/__NEXT_DATA__/, "other")), url, "95290386"), 2);
  assert.equal(targetPurchaseLimit(page(`<script id="__NEXT_DATA__" type="application/json">{not json</script>`), url, "95290386"), null);
});
