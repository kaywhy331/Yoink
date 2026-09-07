#!/usr/bin/env node
// DOM-only packaged Chromium audit. All network is intercepted; this is fixture
// evidence, never live retailer cart proof. No fixture identities are rewritten.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { ADD_LANES } from "../packages/contracts/src/index.ts";

const output = resolve(process.argv[2] || "docs/evidence/cart-audit-2026-09-06");
const canonical = (s, id) => s === "target" ? `https://www.target.com/p/-/A-${id}` : s === "bestbuy"
  ? `https://www.bestbuy.com/site/-/${id}.p` : s === "walmart" ? `https://www.walmart.com/ip/${id}` : `https://www.amazon.com/dp/${id}`;
// Identity and expected rehearsal behavior come from the retained product
// fixtures and their existing tests, not from substituted catalog identifiers.
const specs = {
  target: [
    ["product-first-party", "1011483414", true], ["product-marketplace", "1011483414", false],
    ["product-modern-pickup-selected", "1011483414", true], ["product-selector-miss", "95238329", false]
  ],
  walmart: [
    ["first-party", "17354421975", true], ["marketplace", "17354421975", false],
    ["cross-offer", "20009805270", false], ["unavailable-structured", "20895014480", false],
    ["draw-hub", "19624258216", false, "shipping", "https://www.walmart.com/shop/collectibles/drawing-assortment"]
  ],
  amazon: [
    ["first-party", "B0GYTRYV7P", true], ["marketplace", "B0GYTRYV7P", false],
    ["accordion-canonical-offer", "B0FB21526X", true], ["accordion-marketplace", "B07ZPS1KVD", false],
    ["offer-display-first-party", "B0DCGQ6CJD", true], ["offer-display-marketplace", "B0F2BDXW4J", false],
    ["offer-display-separated-marketplace", "B081J5PW5J", false], ["variation-heavy", "B0FH8M48ZC", true]
  ],
  bestbuy: [
    ["first-party", "6588149", true], ["marketplace", "12716513", false],
    ["ambiguous-sku", "6588149", false], ["demand-gate", "6669286", false],
    ["high-velocity-reservation", "6669869", false], ["hoth-pickup-selected", "6669690", false],
    ["in-store-only", "6664887", false], ["lorcana-pickup-buy-now", "6667316", false],
    ["mega-man-high-demand", "6669782", true], ["modern-first-party", "6670797", true],
    ["modern-pickup-only", "6528565", false], ["passive-demand-badge", "6669286", true],
    ["pickup-selected", "6588149", false], ["pikachu-pickup-selected", "6612619", false],
    ["primary-and-sticky-add", "6677244", true], ["reality-fracture-preorder", "6678193", true],
    ["single-split-shell", "6685081", true],
    ["lorcana-pickup-buy-now", "6667316", true, "pickup"], ["pickup-selected", "6588149", true, "pickup"]
  ]
};
const cartFiles = {target:"target/cart.html",walmart:"walmart/cart.html",amazon:"amazon/cart.html",bestbuy:"retailers/bestbuy-cart-single.html"};
const selectors = {target:"[data-test='cart-item']",walmart:"[data-testid='cart-item']",amazon:".sc-list-item",bestbuy:"[data-testid='cart-item']"};
const identities = {target:"data-tcin",walmart:"data-us-item-id",amazon:"data-asin",bestbuy:"data-sku-id"};
const report = {generatedAt:new Date().toISOString(), environment:"Packaged Chromium, intercepted network, DOM only; fixture Add clicks and cart proofs are synthetic, not live verification.", cases:[], cartCases:[], bundles:{}};
const browser = await chromium.launch({headless:true,...(process.env.YOINK_TEST_CHROME ? {executablePath:process.env.YOINK_TEST_CHROME}:{})});
const context = await browser.newContext();
await context.route("**/*", route=>route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><body></body>"}));
const page = await context.newPage();
const cart = await context.newPage();
const save = () => writeFileSync(join(output,"browser-results.json"),JSON.stringify(report,null,2)+"\n");
try {
  for (const [store, fixtures] of Object.entries(specs)) {
    const lane = ADD_LANES[store];
    const bundlePath = resolve(`apps/extension/${store}-action.js`);
    report.bundles[store] = {version:lane.contractVersion,sha256:createHash("sha256").update(readFileSync(bundlePath)).digest("hex")};
    const included = new Set();
    for (const [name, sku, expected, fulfillment="shipping", url=canonical(store,sku)] of fixtures) {
      const file = store === "target" ? `target/${name}.html` : `retailers/${store}-${name}.html`;
      included.add(file);
      const result = {retailerId:store,retailerSku:sku,file,fulfillment,url,expectedRehearsal:expected,liveCartVerified:false};
      report.cases.push(result);
      try {
        await page.goto(url);
        await page.setContent(readFileSync(join("test/fixtures",file),"utf8"));
        await page.addScriptTag({path:bundlePath});
        const job = {contractVersion:1,jobId:`fixture_${store}_${name}_${fulfillment}`,retailerId:store,retailerSku:sku,canonicalUrl:url,
          action:"add_to_cart",quantity:1,maxUnitPriceCents:100000,maxOrderTotalCents:100000,currency:"USD",sellerPolicy:"first_party_only",
          expectedSeller:store==="target"?"Target":store==="walmart"?"Walmart":store==="amazon"?"Amazon.com":"Best Buy",fulfillment,
          adapterVersion:lane.contractVersion,expiresAt:new Date(Date.now()+60000).toISOString()};
        if(store === "target" && name === "product-modern-pickup-selected") {
          // Simulate the store's fulfillment render for this static fixture.
          // The product identity, price and offer markup remain as captured.
          await page.evaluate(()=>document.querySelector('[data-test="fulfillment-cell-shipping"]').addEventListener("click",()=>{
            const tile=document.querySelector('[data-test="fulfillment-cell-shipping"]');
            tile.setAttribute("aria-label","shipping - selected - Arrives by Monday");
            tile.setAttribute("aria-selected","true");
            document.querySelector('[data-test="fulfillment-cell-pickup"]').setAttribute("aria-label","pickup - unselected - Ready within 2 hours");
            const section=document.querySelector('[data-test="orderPickupSection"]');section.setAttribute("data-test","shippingSection");
            section.querySelector("button").setAttribute("data-test","shippingButton");
          }));
        }
        result.rehearsal = await page.evaluate(({lane,job})=>{
          globalThis.auditAddClicks=0;
          document.addEventListener("click",e=>{
            const control=e.target.closest('button,input[type="submit"],[role="button"]');
            if(control && /add to cart|pre.?order|ship it/i.test(`${control.textContent} ${control.value||""} ${control.getAttribute("aria-label")||""}`)) globalThis.auditAddClicks++;
          },true);
          // Fixture forms never navigate; record the real bound click instead.
          document.addEventListener("submit",e=>e.preventDefault());
          return globalThis[lane.runnerGlobal][lane.operations.rehearse](document,location.href,job);
        },{lane,job});
        assert.equal(await page.evaluate(()=>globalThis.auditAddClicks),0,"Rehearsal clicked Add");
        assert.equal(result.rehearsal.ok,expected,`Unexpected rehearsal: ${result.rehearsal.reason}`);
        if(expected) {
          result.commit = await page.evaluate(async({lane,job})=>{
            const api=globalThis[lane.runnerGlobal];
            const p=api[lane.operations.prepare](document,location.href,job);
            if(!p.ok) return p;
            const commit=await api[lane.operations.commit](document,location.href,job,p.authorizationId);
            const duplicate=await api[lane.operations.commit](document,location.href,job,p.authorizationId);
            return {commit,duplicate,clicks:globalThis.auditAddClicks};
          },{lane,job});
          assert.equal(result.commit.commit?.clicked,true);
          assert.equal(result.commit.duplicate?.clicked,false);
          assert.equal(result.commit.clicks,1,"One authorization must cause exactly one Add click");
          if(name==="first-party" || name==="product-first-party") {
            const c={retailerId:store,retailerSku:sku,file:cartFiles[store],liveCartVerified:false}; report.cartCases.push(c);
            await cart.goto(lane.cartUrl);
            await cart.setContent('<main><h1>Your cart is empty</h1></main>');
            await cart.addScriptTag({path:bundlePath});
            c.baseline=await cart.evaluate(lane=>globalThis[lane.runnerGlobal][lane.operations.baseline](document,location.href),lane);
            assert.equal(c.baseline.ok,true);
            await cart.setContent(readFileSync(join("test/fixtures",cartFiles[store]),"utf8"));
            const proof=result.commit.commit.proof;
            const verify=()=>cart.evaluate(({lane,job,proof,baseline})=>globalThis[lane.runnerGlobal][lane.operations.verifyCart](document,location.href,job,proof,baseline),{lane,job,proof,baseline:c.baseline.proof});
            c.exactDelta=await verify(); assert.equal(c.exactDelta.ok,true,`${store}: ${c.exactDelta.reason}`);
            await cart.evaluate(({selector,identity})=>{
              const row=document.querySelector(selector); const extra=row.cloneNode(true); extra.removeAttribute(identity);extra.innerHTML="An item is loading";row.after(extra);
            },{selector:selectors[store],identity:identities[store]});
            c.unreadableRow=await verify(); assert.equal(c.unreadableRow.ok,false);
            await cart.setContent(readFileSync(join("test/fixtures",cartFiles[store]),"utf8"));
            await cart.evaluate(selector=>{const select=document.querySelector(`${selector} select`);select.innerHTML='<option selected value="2">2</option>';},selectors[store]);
            c.excessQuantity=await verify(); assert.equal(c.excessQuantity.ok,false);
            c.passed=true;
          }
        }
        result.passed=true;
      } catch(error) {result.error=error.message;result.passed=false;}
      save();
    }
    const directory=store==="target"?"target":"retailers";
    const expectedFiles=readdirSync(join("test/fixtures",directory)).filter(f=>store==="target"?/^product-.*\.html$/.test(f):f.startsWith(`${store}-`)&&f.endsWith(".html")&&!f.includes("-cart-"));
    assert.deepEqual(expectedFiles.filter(f=>!included.has(`${directory}/${f}`)),[],`Unaudited ${store} product fixtures`);
  }
} finally {await browser.close();save();}
const failures=report.cases.filter(c=>!c.passed);
console.log(JSON.stringify({cases:report.cases.length,cartCases:report.cartCases.length,failures:failures.map(c=>({file:c.file,error:c.error})),cartFailures:report.cartCases.filter(c=>!c.passed)}));
process.exitCode=failures.length||report.cartCases.some(c=>!c.passed)?1:0;
