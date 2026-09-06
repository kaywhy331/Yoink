import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { AdapterEnvironment } from "../packages/contracts/src/index.js";
import { audioAdviceOfferBinding, audioAdviceCartInventory } from "../packages/browser-adapters/src/audioadvice.js";
import { rehearseAudioAdviceAdd, prepareAudioAdviceAdd, commitAudioAdviceAdd, inspectAudioAdviceCartBaseline, verifyAudioAdviceAddedCart, type AudioAdviceAddJob } from "../apps/extension/src/audioadvice-action.js";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
const env: AdapterEnvironment = { isVisible: e => !e.closest('[data-assessment-visible="false"], [hidden], [inert], [aria-hidden="true"]') };
const directory = "docs/store-evidence/audioadvice/";
const now = Date.now();
function product(name = "coupler") {
  const meta = JSON.parse(readFileSync(`${directory}${name}-product-2026-09-06.json`, "utf8"));
  const schema = JSON.parse(readFileSync(`${directory}${name}-schema-2026-09-06.json`, "utf8")).product;
  const dom = new JSDOM(`<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(schema)}</script></head><body><product-form>${meta.html}</product-form></body></html>`, { url: meta.url });
  const job: AudioAdviceAddJob = { adapterVersion: "audioadvice-add-v1", contractVersion: 1, jobId: `audio_${meta.variantId}`, retailerId: "audioadvice",
    retailerSku: String(meta.variantId), canonicalUrl: `${meta.url}?variant=${meta.variantId}`, action: "add_to_cart", quantity: 1,
    maxUnitPriceCents: Math.round(schema.offers[0].price * 100), maxOrderTotalCents: 10000, currency: "USD",
    sellerPolicy: "first_party_only", expectedSeller: "Audio Advice", fulfillment: "shipping", expiresAt: new Date(now + 60000).toISOString() };
  return { dom, document: dom.window.document as Document, meta, job };
}

test("Audio Advice binds both captured native forms, rehearses without mutation and commits once", () => {
  for (const name of ["coupler", "caps"]) {
    const p = product(name);
    try {
      assert.ok(audioAdviceOfferBinding(p.document, p.document.URL, p.job.retailerSku, env), name);
      let clicks = 0; p.document.addEventListener("click", event => { event.preventDefault(); clicks++; });
      const trial = rehearseAudioAdviceAdd(p.document, p.document.URL, p.job, now, env);
      assert.equal(trial.ok, true, JSON.stringify(trial)); assert.equal(clicks, 0);
      const prepared = prepareAudioAdviceAdd(p.document, p.document.URL, p.job, now, env);
      assert.equal(prepared.ok, true); if (!prepared.ok) continue;
      assert.equal(commitAudioAdviceAdd(p.document, p.document.URL, p.job, prepared.authorizationId, now + 1, env).clicked, true);
      assert.equal(commitAudioAdviceAdd(p.document, p.document.URL, p.job, prepared.authorizationId, now + 2, env).clicked, false);
      assert.equal(clicks, 1);
    } finally { p.dom.window.close(); }
  }
});

test("Audio Advice rejects changed form identity, quantity, price, stock, variant and merchant metadata", () => {
  const mutations: Record<string, (d: Document) => void> = {
    quantity: d => { (d.querySelector('[name=quantity]') as HTMLInputElement).value = "2"; },
    variant: d => { (d.querySelector('form:has(button#add-to-cart) input[name=id]') as HTMLInputElement).value = "41907725598804"; },
    form: d => d.querySelector('form:has(button#add-to-cart)')!.setAttribute('id', 'other'),
    price: d => { d.querySelector('.price__default .price__current')!.textContent = '$1.00'; },
    stock: d => { d.querySelector('.product-inventory-text')!.textContent = 'Pre-order'; },
    duplicate: d => d.querySelector('form:has(button#add-to-cart)')!.append(d.querySelector('#add-to-cart')!.cloneNode(true)),
    metadata: d => { d.querySelector('script')!.textContent = d.querySelector('script')!.textContent!.replace('Audio Advice', 'Other Seller'); },
    security: d => d.body.prepend('Access denied'),
    subscription: d => d.querySelector('form:has(button#add-to-cart)')!.insertAdjacentHTML('beforeend', '<input name="selling_plan" value="123">')
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const p = product(); try {
      const prepared = prepareAudioAdviceAdd(p.document, p.document.URL, p.job, now, env); assert.equal(prepared.ok, true);
      mutate(p.document); let clicks = 0; p.document.addEventListener('click', () => { clicks++; });
      assert.equal(audioAdviceOfferBinding(p.document, p.document.URL, p.job.retailerSku, env), null, name);
      if (prepared.ok) assert.equal(commitAudioAdviceAdd(p.document, p.document.URL, p.job, prepared.authorizationId, now + 1, env).clicked, false, name);
      assert.equal(clicks, 0);
    } finally { p.dom.window.close(); }
  }
});

test("Audio Advice verifies fresh cart API deltas and refuses totals, variants, properties and count conflicts", async () => {
  const p = product('caps');
  const full = JSON.parse(readFileSync(`${directory}two-item-cart-2026-09-06.json`, 'utf8')).cart;
  try {
    const inventory = audioAdviceCartInventory(full); assert.equal(inventory.complete, true);
    for (const mutate of [(v: any) => v.item_count++, (v: any) => v.total_price++, (v: any) => v.items[0].final_line_price++,
      (v: any) => { v.items[0].product_has_only_default_variant = false; }, (v: any) => { v.items[0].properties = { engraving: 'custom' }; },
      (v: any) => { v.items[0].url = 'https://example.com/products/item?variant=' + v.items[0].variant_id; }]) {
      const invalid = structuredClone(full); mutate(invalid); assert.equal(audioAdviceCartInventory(invalid).complete, false);
    }
    const before = { ...full, items: full.items.filter((i: any) => String(i.variant_id) !== p.job.retailerSku), item_count: 1, total_price: 1995 };
    const cart = new JSDOM('<main>Your cart</main>', { url: 'https://www.audioadvice.com/cart' });
    try {
      let payload = before;
      cart.window.fetch = async (url: string, options: RequestInit) => { assert.equal(url, 'https://www.audioadvice.com/cart.js'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); return new Response(JSON.stringify(payload), { headers: { 'content-type': 'text/javascript' } }); };
      const baseline = await inspectAudioAdviceCartBaseline(cart.window.document, cart.window.location.href, now);
      assert.equal(baseline.ok, true); if (!baseline.ok) return;
      const trial = rehearseAudioAdviceAdd(p.document, p.document.URL, p.job, now, env); assert.equal(trial.ok, true); if (!trial.ok) return;
      payload = full;
      const result = await verifyAudioAdviceAddedCart(cart.window.document, cart.window.location.href, p.job, trial.proof, baseline.proof, now + 1);
      assert.equal(result.ok, true, JSON.stringify(result));
      payload = before;
      assert.equal((await verifyAudioAdviceAddedCart(cart.window.document, cart.window.location.href, p.job, trial.proof, baseline.proof, now + 2)).ok, false);
    } finally { cart.window.close(); }
  } finally { p.dom.window.close(); }
});
