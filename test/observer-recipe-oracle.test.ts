import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  evaluateObserverRecipeEvidence,
  type PackagedObserverEvidence
} from "../apps/extension/src/observer-recipe-oracle.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options?: { url?: string }) => { window: { document: Document } } };

const SKU = "B002OB49L4";

function page(overrides = ""): Document {
  const dom = new JSDOM(`<!doctype html><html><body>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      sku: SKU,
      offers: {
        "@type": "Offer",
        availability: "https://schema.org/InStock",
        price: "7.98",
        seller: { "@type": "Organization", name: "Amazon.com" },
        shippingDetails: { "@type": "OfferShippingDetails" }
      }
    })}</script>
    <span data-testid="repair-availability">In stock</span>
    <span data-testid="repair-price">$7.98</span>
    <span data-testid="repair-seller">Sold by Amazon.com</span>
    <span data-testid="repair-fulfillment">Shipping delivery</span>
    <button data-testid="repair-add">Add to Cart</button>
    ${overrides}
  </body></html>`, { url: `https://www.amazon.com/dp/${SKU}` });
  return dom.window.document;
}

function evidence(overrides: Partial<PackagedObserverEvidence> = {}): PackagedObserverEvidence {
  return {
    retailerSku: SKU,
    availability: "in_stock",
    unitPriceCents: 798,
    sellerName: "Amazon.com",
    fulfillment: "shipping",
    addControlActionable: true,
    known: {
      availability: true,
      unitPrice: true,
      seller: true,
      fulfillment: true,
      addControl: true
    },
    ...overrides
  };
}

const fields = {
  availability: { mode: "text" as const, selectors: ["[data-testid='repair-availability']"] },
  unitPrice: { mode: "text" as const, selectors: ["[data-testid='repair-price']"] },
  seller: { mode: "text" as const, selectors: ["[data-testid='repair-seller']"] },
  fulfillment: { mode: "text" as const, selectors: ["[data-testid='repair-fulfillment']"] },
  addControl: { mode: "disabled_state" as const, selectors: ["[data-testid='repair-add']"] }
};

test("the packaged structured oracle independently agrees across all five fixed read-only fields", () => {
  const result = evaluateObserverRecipeEvidence(page(), fields, evidence());
  assert.equal(result.validationProfile, "packaged_structured_oracle_v1");
  assert.equal(result.evaluatedFieldCount, 5);
  assert.equal(result.agreedFieldCount, 5);
  assert.equal(result.oracleAgreedFieldCount, 5);
  assert.equal(result.packagedConflictFieldCount, 0);
  assert.equal(result.insufficientFieldCount, 0);
  assert.deepEqual(result.fieldOutcomes.map((item) => [item.field, item.packagedState, item.oracleState, item.disposition]), [
    ["availability", "agreed", "agreed", "verified"],
    ["unitPrice", "agreed", "agreed", "verified"],
    ["seller", "agreed", "agreed", "verified"],
    ["fulfillment", "agreed", "agreed", "verified"],
    ["addControl", "agreed", "agreed", "verified"]
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Amazon\.com|B002OB49L4|798|\$7\.98/);
});

test("a structured oracle can validate a recipe when the packaged reader is missing a field", () => {
  const packaged = evidence({
    unitPriceCents: null,
    known: { ...evidence().known, unitPrice: false }
  });
  const result = evaluateObserverRecipeEvidence(page(), { unitPrice: fields.unitPrice }, packaged);
  assert.equal(result.agreedFieldCount, 1);
  assert.equal(result.oracleAgreedFieldCount, 1);
  assert.equal(result.packagedMissingFieldCount, 1);
  assert.deepEqual(result.fieldOutcomes[0], {
    field: "unitPrice",
    recipeState: "value",
    packagedState: "missing",
    oracleState: "agreed",
    disposition: "verified"
  });
});

test("whole-dollar structured prices are normalized as dollars rather than cents", () => {
  const document = page();
  const script = document.querySelector("script[type='application/ld+json']");
  const price = document.querySelector("[data-testid='repair-price']");
  assert.ok(script);
  assert.ok(price);
  script.textContent = JSON.stringify({
    "@type": "Product",
    sku: SKU,
    offers: { "@type": "Offer", price: 7 }
  });
  price.textContent = "$7.00";
  const result = evaluateObserverRecipeEvidence(document, { unitPrice: fields.unitPrice }, evidence({ unitPriceCents: 700 }));
  assert.equal(result.oracleAgreedFieldCount, 1);
  assert.equal(result.fieldOutcomes[0]?.disposition, "verified");
});

test("packaged evidence is authoritative and conflicts never reach the oracle as a pass", () => {
  const result = evaluateObserverRecipeEvidence(page(), { unitPrice: fields.unitPrice }, evidence({ unitPriceCents: 999 }));
  assert.equal(result.agreedFieldCount, 0);
  assert.equal(result.packagedConflictFieldCount, 1);
  assert.equal(result.oracleAgreedFieldCount, 0);
  assert.deepEqual(result.fieldOutcomes[0], {
    field: "unitPrice",
    recipeState: "value",
    packagedState: "conflict",
    oracleState: "not_evaluated",
    disposition: "conflict"
  });
});

test("seller agreement is label-normalized but never accepted by substring", () => {
  const document = page();
  const seller = document.querySelector("[data-testid='repair-seller']");
  assert.ok(seller);
  seller.textContent = "Not Amazon.com";
  const result = evaluateObserverRecipeEvidence(document, { seller: fields.seller }, evidence());
  assert.equal(result.packagedConflictFieldCount, 1);
  assert.equal(result.fieldOutcomes[0]?.disposition, "conflict");
});

test("structured oracle conflicts and ambiguous semantic controls fail closed", () => {
  const conflicting = page();
  const script = conflicting.querySelector("script[type='application/ld+json']");
  assert.ok(script);
  script.textContent = JSON.stringify({
    "@type": "Product",
    sku: SKU,
    offers: { "@type": "Offer", price: "8.99" }
  });
  const conflict = evaluateObserverRecipeEvidence(conflicting, { unitPrice: fields.unitPrice }, evidence());
  assert.equal(conflict.oracleConflictFieldCount, 1);
  assert.equal(conflict.fieldOutcomes[0]?.disposition, "conflict");

  const ambiguous = evaluateObserverRecipeEvidence(
    page('<button aria-label="Add to Cart">Add to Cart</button>'),
    { addControl: fields.addControl },
    evidence()
  );
  assert.equal(ambiguous.ambiguousFieldCount, 1);
  assert.equal(ambiguous.insufficientFieldCount, 1);
  assert.equal(ambiguous.fieldOutcomes[0]?.oracleState, "ambiguous");
});

test("uncurried numeric text is not misread as a currency price", () => {
  const document = page();
  const price = document.querySelector("[data-testid='repair-price']");
  assert.ok(price);
  price.textContent = "11995 reviews";
  const result = evaluateObserverRecipeEvidence(document, { unitPrice: fields.unitPrice }, evidence());
  assert.equal(result.agreedFieldCount, 0);
  assert.equal(result.insufficientFieldCount, 1);
  assert.equal(result.fieldOutcomes[0]?.recipeState, "unrecognized");
});

test("multiple unbound structured Product scopes cannot corroborate a missing packaged value", () => {
  const document = page(`
    <section itemscope itemtype="https://schema.org/Product"><meta itemprop="price" content="7.98"></section>
    <section itemscope itemtype="https://schema.org/Product"><meta itemprop="price" content="7.98"></section>
  `);
  document.querySelector("script[type='application/ld+json']")?.remove();
  const packaged = evidence({
    unitPriceCents: null,
    known: { ...evidence().known, unitPrice: false }
  });
  const result = evaluateObserverRecipeEvidence(document, { unitPrice: fields.unitPrice }, packaged);
  assert.equal(result.oracleAgreedFieldCount, 0);
  assert.equal(result.insufficientFieldCount, 1);
  assert.equal(result.fieldOutcomes[0]?.oracleState, "missing");
});
