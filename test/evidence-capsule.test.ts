import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import test from "node:test";
// @ts-expect-error jsdom intentionally ships without bundled TypeScript declarations here.
import { JSDOM } from "jsdom";
import {
  captureEvidenceCapsule,
  sanitizeEvidenceDocument,
  shouldCaptureEvidenceCapsule
} from "../apps/extension/src/evidence-capsule.js";
import type { RetailerAdapterDiagnosticInput } from "../packages/contracts/src/index.js";

function diagnostic(overrides: Partial<RetailerAdapterDiagnosticInput> = {}): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: "2026-09-05T18:54:10.000Z",
    retailerId: "walmart",
    retailerSku: "20895014480",
    adapterVersion: "walmart-observer-v8",
    operation: "observe",
    outcome: "failed",
    failureStage: "price_binding",
    reasonCode: "price_binding_missing",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "none",
      sellerShape: "none",
      fulfillmentShape: "none",
      addControlCount: 1,
      scopedControlCount: 0,
      explicitSkuInputCount: 0,
      exactSkuInputCount: 0,
      variationSkuCount: 0,
      canonicalOfferInputCount: 0,
      canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0,
      alternateOfferDistinctCount: 0,
      priceCandidateCount: 0,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: ""
    },
    ...overrides
  };
}

test("Athleta repair captures serialize current radio and quantity selections and clear input values", () => {
  const dom = new JSDOM(`<div id="buy-box-wrapper-id">
    <input id="shipping" type="radio" value="private-value"><input id="pickup" type="radio" checked>
    <input name="buybox-sizeDimension1" type="radio" value="One Size">
    <div id="AddToBag"><select><option value="1" selected>1</option><option value="2">2</option></select></div>
  </div><input type="email" value="private@example.com">`);
  try {
    const document = dom.window.document;
    document.querySelector("#shipping").checked = true;
    document.querySelector("#pickup").checked = false;
    document.querySelector("[name=buybox-sizeDimension1]").checked = true;
    document.querySelector("select").value = "2";
    const sanitized = sanitizeEvidenceDocument(document).document;
    const replay = new JSDOM(sanitized.documentElement.outerHTML);
    try {
      assert.equal(replay.window.document.querySelector("#shipping").checked, true);
      assert.equal(replay.window.document.querySelector("#pickup").checked, false);
      assert.equal(replay.window.document.querySelector("[name=buybox-sizeDimension1]").checked, true);
      assert.equal(replay.window.document.querySelector("select").value, "2");
      assert.doesNotMatch(sanitized.documentElement.outerHTML, /private-value|private@example/);
      assert.equal(document.querySelector("#shipping").hasAttribute("checked"), false);
      assert.equal(document.querySelector("#pickup").hasAttribute("checked"), true);
    } finally { replay.window.close(); }
  } finally { dom.window.close(); }
});

test("ASUS repair captures retain cart quantity and clear form keys and unrelated inputs", () => {
  const dom = new JSDOM(`<form id="product_addtocart_form" data-product-sku="90MP04D0-BMAA02">
    <input type="number" name="qty" value="2"><input type="hidden" name="form_key" value="private-form-key">
    <input type="number" name="phone" value="1234567890">
  </form><input type="number" name="qty" value="4">`);
  try {
    const result = sanitizeEvidenceDocument(dom.window.document);
    const values = [...result.document.querySelectorAll("input")].map(input => input.getAttribute("value"));
    assert.deepEqual(values, ["2", "", "", ""]);
  } finally { dom.window.close(); }
});

test("repair captures retain bounded product quantity while clearing personal inputs", () => {
  const dom = new JSDOM(`<form data-product-id="7085256605768">
    <input type="number" name="quantity" value="1">
    <input type="email" name="email" value="private@example.com">
    <input type="number" name="quantity" value="1234567890">
  </form><input type="number" name="quantity" value="7">`);
  dom.window.document.querySelector("input").value = "2";
  const sanitized = sanitizeEvidenceDocument(dom.window.document);
  const values = Array.from(sanitized.document.querySelectorAll("input"), element => element.getAttribute("value"));
  assert.deepEqual(values, ["2", "", "", ""]);
});

test("the evidence sanitizer applies the closed redaction rules to a clone and stamps replay visibility", () => {
  const dom = new JSDOM(`<!doctype html><html><head>
    <link rel="stylesheet" href="https://cdn.example/x.css"><style>.buy{display:block}</style>
    <meta itemprop="price" content="19.99"><script>alert("secret")</script>
    <script type="application/json">{"sessionToken":"secret","product":{"price":19.99,"availability":"IN_STOCK"}}</script>
    <script type="application/ld+json">not-json</script></head><body>
    <button id="buy" onclick="steal()" data-testid="add">Add to cart</button>
    <a href="javascript:steal()">bad</a><img src="data:image/png;base64,secret" srcset="https://x 2x" alt="item">
    <input name="email" value="person@example.com"><input type="hidden" name="csrfToken" value="secret">
    <input type="hidden" name="offeringID.1" value="offer-kept"><textarea>secret note</textarea>
    <iframe src="https://challenge.example/captcha?token=secret" srcdoc="secret"><p>child</p></iframe>
    <p>Contact person@example.com or (415) 555-1212.</p></body></html>`, {
    url: "https://www.walmart.com/ip/20895014480?athbdg=secret#offer"
  });
  const liveButton = dom.window.document.querySelector("#buy")!;
  const sanitized = sanitizeEvidenceDocument(dom.window.document, {
    isVisible: (element) => element === liveButton,
    rect: () => ({ x: 1.4, y: 2.6, width: 100.2, height: 40.8 })
  });
  const html = sanitized.document.documentElement.outerHTML;
  assert.equal(dom.window.document.querySelector("#buy")?.hasAttribute("data-yoink-vis"), false);
  assert.match(html, /data-yoink-vis="1"/);
  assert.match(html, /data-yoink-rect="1,3,100,41"/);
  assert.doesNotMatch(html, /onclick|javascript:|data:image|srcset|person@example\.com|415\) 555/);
  assert.doesNotMatch(html, /alert\(|not-json|secret note|csrfToken" value="secret/);
  assert.match(html, /offeringID\.1" value="offer-kept/);
  assert.match(html, /meta itemprop="price"/);
  assert.match(html, /iframe[^>]+src="https:\/\/challenge\.example\/captcha"/);
  assert.match(html, /"sessionToken":"\[redacted\]"/);
  assert.deepEqual(sanitized.redactions, {
    scriptsRemoved: 2,
    jsonBlocksKept: 1,
    keysRedacted: 1,
    inputsCleared: 3,
    iframesReduced: 1,
    mediaStripped: 1,
    textRedactions: 2
  });
});

test("capture emits a bounded gzip envelope and the ordered reduction ladder", async () => {
  const noisy = () => randomBytes(900_000).toString("base64");
  const dom = new JSDOM(`<!doctype html><html><head><style>${noisy()}</style></head><body>
    <svg><text>${noisy()}</text></svg><div id="hidden">${noisy()}</div><button id="kept">${noisy()}${noisy()}${noisy()}${noisy()}</button>
  </body></html>`, { url: "https://www.walmart.com/ip/20895014480?secret=1" });
  const capsule = await captureEvidenceCapsule({
    document: dom.window.document,
    url: dom.window.location.href,
    retailerId: "walmart",
    retailerSku: "20895014480",
    diagnostic: diagnostic(),
    trigger: "diagnostic_failed",
    observerVersion: "walmart-observer-v8",
    addAdapterVersion: "walmart-add-v10",
    extensionVersion: "1.20.0",
    environment: { isVisible: (element) => element.id !== "hidden" }
  });
  assert.ok(capsule.snapshot.bytes <= 3 * 1024 * 1024);
  assert.deepEqual(capsule.reductionApplied, ["svg_children", "styles", "hidden_elements", "cut_at_cap"]);
  assert.equal(capsule.truncated, true);
  assert.equal(capsule.url, "https://www.walmart.com/ip/20895014480");
  assert.match(gunzipSync(Buffer.from(capsule.snapshot.html, "base64")).toString("utf8"), /^<!DOCTYPE html>/);
});

test("automatic capsule triggers exclude policy and interactive rejections", () => {
  assert.equal(shouldCaptureEvidenceCapsule(diagnostic()), true);
  assert.equal(shouldCaptureEvidenceCapsule(diagnostic({ operation: "rehearse_add", outcome: "rejected", failureStage: "add_control" })), true);
  assert.equal(shouldCaptureEvidenceCapsule(diagnostic({ operation: "live_add", outcome: "rejected", failureStage: "interactive_block" })), false);
  assert.equal(shouldCaptureEvidenceCapsule(diagnostic({ operation: "live_add", outcome: "rejected", failureStage: "policy" })), false);
  assert.equal(shouldCaptureEvidenceCapsule(diagnostic({ outcome: "passed", failureStage: "complete" })), false);
  assert.equal(shouldCaptureEvidenceCapsule(diagnostic({ outcome: "passed", failureStage: "complete" }), true), true);
});

test("a capture deadline emits a privacy-safe truncated capsule", async () => {
  const dom = new JSDOM("<!doctype html><html><body><p>person@example.com</p><button>Add to cart</button></body></html>", {
    url: "https://www.walmart.com/ip/20895014480"
  });
  let tick = 0;
  const capsule = await captureEvidenceCapsule({
    document: dom.window.document,
    url: dom.window.location.href,
    retailerId: "walmart",
    retailerSku: "20895014480",
    diagnostic: diagnostic(),
    trigger: "diagnostic_failed",
    observerVersion: "walmart-observer-v8",
    addAdapterVersion: "walmart-add-v10",
    extensionVersion: "1.20.0",
    budgetMs: 1,
    environment: { now: () => tick++ * 2 }
  });
  const html = gunzipSync(Buffer.from(capsule.snapshot.html, "base64")).toString("utf8");
  assert.equal(capsule.truncated, true);
  assert.match(html, /reached its local time limit/);
  assert.doesNotMatch(html, /person@example\.com/);
});

test("Audio Advice repair captures keep the live numeric product quantity and clear unrelated inputs", () => {
  const dom = new JSDOM(`<product-form><div class="product-column-right"><form action="/cart/add" id="product-form-template--123__main-456">
    <input type="number" name="quantity" value="1"><input name="email" value="private@example.test">
    </form></div></product-form><input type="number" name="quantity" value="7">`);
  try {
    dom.window.document.querySelector('product-form input[name=quantity]').value = "2";
    const capture = sanitizeEvidenceDocument(dom.window.document, { isVisible: () => true });
    assert.equal(capture.document.querySelector('product-form input[name=quantity]')?.getAttribute("value"), "2");
    assert.equal(capture.document.querySelector('input[name=email]')?.getAttribute("value"), "");
    assert.equal(capture.document.querySelector('body > input[name=quantity]')?.getAttribute("value"), "");
  } finally { dom.window.close(); }
});
