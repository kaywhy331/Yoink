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
  targetInteractiveBlock,
  targetPageKind,
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
  assert.equal(wrongSku.availability, "out_of_stock");
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
  assert.equal(observation.availability, "out_of_stock");
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
