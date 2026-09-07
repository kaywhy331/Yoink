#!/usr/bin/env node
// Explicit audit command: guest-cart mutations only, one item at a time, with cleanup.
// No checkout, challenge handling, credentials, stealth settings, or retrying Add.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { ADD_LANES } from "../packages/contracts/src/index.ts";
const output = resolve(process.argv[2] || "docs/evidence/cart-audit-2026-09-06");
const reportPath = join(output, "live-amazon-results.json");
const inventory = JSON.parse(readFileSync(join(output, "inventory.json"), "utf8"));
const lane = ADD_LANES.amazon;
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : {
  schemaVersion: 1, startedAt: new Date().toISOString(), adapterVersion: lane.contractVersion,
  environment: "Fresh Chromium guest context, normal browser settings, DOM inspection, no images or checkout.", results: [], status: "running"
};
if (report.results.some(r=>r.mutationArmed && !r.cleanupVerified)) throw Error("An earlier audit Add has no verified cleanup; review that cart before resuming.");
if (!["running", "completed"].includes(report.status)) throw Error(`The audit stopped at ${report.status}; resolve that recorded stop before resuming.`);
const save = () => {
  writeFileSync(`${reportPath}.tmp`, JSON.stringify(report,null,2)+"\n");
  renameSync(`${reportPath}.tmp`,reportPath);
};
const products = inventory.products.filter(p=>p.retailerId==="amazon" && p.kinds.some(k=>["catalog","observed","candidate","captured"].includes(k)))
  .sort((a,b)=>Number(b.kinds.includes("observed"))-Number(a.kinds.includes("observed")) || a.retailerSku.localeCompare(b.retailerSku));
// This guest profile is private local recovery state. It must survive even an
// uncertain Add or process exit; never include its cookies in audit reports.
const profile = resolve("data/audits/amazon-guest");
mkdirSync(profile,{recursive:true,mode:0o700});
const context = await chromium.launchPersistentContext(profile,{headless:true,...(process.env.YOINK_TEST_CHROME ? {executablePath:process.env.YOINK_TEST_CHROME}:{})});
report.environment = "Persistent private Chromium guest profile, normal settings, DOM inspection, no images or checkout.";
report.adapterVersion = lane.contractVersion;
report.status = "running";
const page = await context.newPage();
const cart = await context.newPage();
let consecutiveNetworkFailures = 0;
let consecutiveUnknownOffers = 0;
const inject = async p => p.addScriptTag({path:resolve("apps/extension/amazon-action.js")});
async function cartRead(operation,args) {
  await inject(cart);
  return cart.evaluate(async ({operation,args})=>{
    const deadline=Date.now()+12000;
    let result;
    do {
      result=globalThis.YoinkAmazonAction[operation](document,location.href,...args);
      if(result.ok || !["cart_unverified","quantity_unavailable","cart_delta_unverified"].includes(result.reason)) return result;
      await new Promise(r=>setTimeout(r,500));
    } while(Date.now()<deadline);
    return result;
  },{operation,args});
}
try {
  for (const product of products) {
    if(report.results.some(r=>r.retailerSku===product.retailerSku)) continue;
    const result={retailerId:"amazon",retailerSku:product.retailerSku,url:product.canonicalUrl,startedAt:new Date().toISOString(),status:"inspecting",mutationArmed:false,cleanupVerified:false};
    report.results.push(result); save();
    try {
      const response=await page.goto(product.canonicalUrl,{waitUntil:"domcontentloaded",timeout:20000});
      result.httpStatus=response?.status() ?? null;
      if([404,410].includes(result.httpStatus)) {result.status="product_not_found";save();continue;}
      if(result.httpStatus>=400) {result.status="http_blocked_or_unavailable";report.status="blocked_by_http";save();break;}
      await page.addScriptTag({path:resolve("apps/extension/retailer-shadow.js")});
      const attempt=await page.evaluate(async()=>{
        const deadline=Date.now()+12000;
        let a;
        do {
          a=globalThis.YoinkRetailerShadow.collectRetailerShadowAttempt(document,location.href,"amazon","shipping");
          const o=a.observation;
          if(o.securityChallenge || o.interactiveBlock || o.addControlActionable || ["out_of_stock","unavailable"].includes(o.availability)) break;
          await new Promise(r=>setTimeout(r,500));
        } while(Date.now()<deadline);
        return {observation:a.observation,diagnostic:{outcome:a.diagnostic.outcome,reasonCode:a.diagnostic.reasonCode,failureStage:a.diagnostic.failureStage}};
      });
      result.observation=attempt.observation; result.diagnostic=attempt.diagnostic;
      consecutiveNetworkFailures=0;
      const o=attempt.observation;
      if(o.availability==="unknown" && !o.addControlActionable && !o.securityChallenge && !o.interactiveBlock) {
        result.status="loading_or_unknown";
        if(++consecutiveUnknownOffers>=3) {report.status="blocked_by_unreadable_pages";save();break;}
        save();continue;
      }
      consecutiveUnknownOffers=0;
      if(o.securityChallenge || ["auth","mfa","queue"].includes(o.interactiveBlock)) {
        result.status="store_step_blocked"; report.status="blocked_by_store"; save(); break;
      }
      if(o.retailerSku!==product.retailerSku || !o.addControlActionable || o.sellerType!=="first_party" || o.sellerName!=="Amazon.com"
        || !["in_stock","preorder"].includes(o.availability) || o.fulfillment!=="shipping" || o.interactiveBlock || !Number.isSafeInteger(o.unitPriceCents) || o.unitPriceCents<=0) {
        result.status="offer_not_eligible"; save(); continue;
      }
      await cart.goto(lane.cartUrl,{waitUntil:"domcontentloaded",timeout:20000});
      const baseline=await cartRead(lane.operations.baseline,[]);
      result.baseline=baseline;
      if(!baseline.ok || baseline.proof.lineCount!==0) {result.status="baseline_unverified";report.status="cart_review_required";save();break;}
      const job={contractVersion:1,jobId:`audit_amazon_${product.retailerSku}_${Date.now()}`,retailerId:"amazon",retailerSku:product.retailerSku,
        canonicalUrl:product.canonicalUrl,action:"add_to_cart",quantity:1,maxUnitPriceCents:o.unitPriceCents,maxOrderTotalCents:o.unitPriceCents,
        currency:"USD",sellerPolicy:"first_party_only",expectedSeller:"Amazon.com",fulfillment:"shipping",
        expiresAt:new Date(Date.now()+180000).toISOString(),adapterVersion:lane.contractVersion};
      await inject(page);
      const rehearsal=await page.evaluate(job=>globalThis.YoinkAmazonAction.rehearseAmazonAdd(document,location.href,job),job);
      result.rehearsal=rehearsal;
      if(!rehearsal.ok) {result.status="rehearsal_rejected";save();continue;}
      result.mutationArmed=true;result.status="add_receipt_armed";save();
      result.commit=await page.evaluate(job=>{
        const api=globalThis.YoinkAmazonAction;
        const p=api.prepareAmazonAdd(document,location.href,job);
        if(!p.ok) return {...p,clicked:false};
        return api.commitAmazonAdd(document,location.href,job,p.authorizationId);
      },job).catch(error=>({ok:false,reason:"execution_context_lost",message:error.message.slice(0,160)}));
      save();
      // Preserve the product document while its native request/navigation
      // settles. This is a read-only wait, never a repeated Add.
      await page.waitForLoadState("load",{timeout:12000}).catch(()=>undefined);
      await cart.goto(lane.cartUrl,{waitUntil:"domcontentloaded",timeout:20000});
      result.verification=await cartRead(lane.operations.verifyCart,[job,result.commit.proof||rehearsal.proof,baseline.proof]);
      result.independentRows=await cart.evaluate(()=>[...document.querySelectorAll('#sc-active-cart .sc-list-item:not([data-removed=true])')].map(e=>({asin:e.getAttribute('data-asin'),quantity:e.getAttribute('data-quantity')})));
      if(!result.verification.ok || result.independentRows.length!==1 || result.independentRows[0].asin!==product.retailerSku || result.independentRows[0].quantity!=="1") {
        result.status="cart_unverified";report.status="cart_review_required";save();break;
      }
      result.status="cart_verified";save();
      const removed=await cart.evaluate(sku=>{
        const row=[...document.querySelectorAll('#sc-active-cart .sc-list-item:not([data-removed=true])')].find(e=>e.getAttribute('data-asin')===sku);
        const buttons=[...(row?.querySelectorAll('button[aria-label^="Delete "]')||[])].filter(e=>e.getClientRects().length&&!e.disabled);
        if(buttons.length!==1) return false;
        buttons[0].click();return true;
      },product.retailerSku);
      if(!removed) {report.status="cleanup_required";save();break;}
      await cart.waitForFunction(sku=>!document.querySelector(`#sc-active-cart .sc-list-item[data-asin="${sku}"]:not([data-removed=true])`),product.retailerSku,{timeout:12000});
      await cart.goto(lane.cartUrl,{waitUntil:"domcontentloaded",timeout:20000});
      result.cleanup=await cartRead(lane.operations.baseline,[]);
      result.cleanupVerified=result.cleanup.ok && result.cleanup.proof.lineCount===0;
      if(!result.cleanupVerified) {report.status="cleanup_required";save();break;}
      result.status="cart_verified_and_cleaned";
    } catch(error) {
      result.error=error.message.slice(0,300);
      result.status=result.mutationArmed ? "mutation_result_uncertain" : "network_or_page_error";
      if(result.mutationArmed) {report.status="cart_review_required";save();break;}
      if(++consecutiveNetworkFailures>=3) {report.status="blocked_by_network";save();break;}
    }
    save();console.log(`${report.results.length}/${products.length}: ${product.retailerSku} ${result.status}`);
  }
  if(report.status==="running") report.status="completed";
  report.finishedAt=new Date().toISOString();
  report.unattempted=products.filter(p=>!report.results.some(r=>r.retailerSku===p.retailerSku)).map(p=>({retailerSku:p.retailerSku,reason:report.status}));
  save();console.log(JSON.stringify({status:report.status,tested:report.results.length,unattempted:report.unattempted.length,cartVerified:report.results.filter(r=>r.status==="cart_verified_and_cleaned").length}));
} finally {
  // Retain session cookies as well as the browser profile for manual recovery.
  // This file is private and must never be copied into the public evidence.
  await context.storageState({path:join(profile,"audit-storage-state.json")}).catch(()=>undefined);
  await context.close();
}
