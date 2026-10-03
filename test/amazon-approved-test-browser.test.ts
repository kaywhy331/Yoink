import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import test from "node:test";
import {AMAZON_APPROVED_TEST as S,type AmazonApprovedTestAuthorization} from "../packages/contracts/src/amazon-approved-test.js";
import {prepareAmazonAdd,commitAmazonAdd,type AmazonAddJob} from "../apps/extension/src/amazon-action.js";

const require=createRequire(import.meta.url);
const {JSDOM}=require("jsdom") as {JSDOM:new(html:string,options:{url:string})=>{window:{document:Document;close():void}}};
const NOW=Date.parse("2026-10-02T16:00:00Z");
const auth:AmazonApprovedTestAuthorization={version:1,approvalId:S.approvalId,jobId:S.id,deviceId:S.deviceId,desiredVariant:S.desiredVariant,
 sourceEventId:S.sourceEventId,sourceObservedAt:S.sourceObservedAt,exceptions:["owner_approved_TEST_above_MSRP","owner_approved_TEST_stale_signal"],
 issuedAt:new Date(NOW).toISOString(),expiresAt:new Date(NOW+60000).toISOString(),noOrderAuthorization:true};
function fixture(){
 const html=readFileSync("test/fixtures/retailers/amazon-first-party.html","utf8")
  .replaceAll("B0GYTRYV7P",S.retailerSku).replace("$21.86","$6.99")
  .replace('<main>',`<main><h1 id="productTitle">${S.title}</h1><div id="merchantInfoFeature_feature_div">Shipper / Seller Amazon.com Amazon.com</div>`);
 const dom=new JSDOM(html,{url:S.canonicalUrl});const doc=dom.window.document;
 let clicks=0;doc.querySelector("#add-to-cart-button")!.addEventListener("click",e=>{e.preventDefault();clicks++;});
 const job:AmazonAddJob={adapterVersion:"amazon-add-v11",contractVersion:1,jobId:S.id,retailerId:"amazon",retailerSku:S.retailerSku,canonicalUrl:S.canonicalUrl,
  action:"add_to_cart",quantity:1,maxUnitPriceCents:699,maxOrderTotalCents:699,currency:"USD",sellerPolicy:"first_party_only",expectedSeller:"Amazon.com",fulfillment:"shipping",expiresAt:auth.expiresAt,approvedTest:{...auth}};
 return {dom,doc,job,clicks:()=>clicks};
}
test("old Chrome device authorization is rejected before and after prepare with zero clicks",()=>{
 const OLD="device_7d1ae7d55d5e4ddb84f7a0a2c5607b5e";
 const f=fixture();try{
  f.job.approvedTest={...auth,deviceId:OLD} as never;
  assert.equal(prepareAmazonAdd(f.doc,S.canonicalUrl,f.job,NOW).ok,false);
  f.job.approvedTest={...auth};
  const prepared=prepareAmazonAdd(f.doc,S.canonicalUrl,f.job,NOW);assert.ok(prepared.ok,JSON.stringify(prepared));
  f.job.approvedTest={...auth,deviceId:OLD} as never;
  assert.equal(commitAmazonAdd(f.doc,S.canonicalUrl,f.job,prepared.authorizationId,NOW+100).ok,false);
  assert.equal(f.clicks(),0);
 }finally{f.dom.window.close();}
});
// Real runner code with synthetic DOM only. No retailer request or real click.
for(const change of ["none","higher_price","lower_price","title_variant","child_asin","quantity","shipper","seller","hidden_shipper","offer_id","device","expiry","rehearsal","order","other_retailer","forged_msrp","source_time"]){
 test(`dated Amazon TEST DOM ${change} ${change==="none"?"clicks once":"cannot click"}`,()=>{
  const f=fixture();try{
   const prepared=prepareAmazonAdd(f.doc,S.canonicalUrl,f.job,NOW);assert.ok(prepared.ok,JSON.stringify(prepared));
   if(change==="higher_price"||change==="lower_price")f.doc.querySelector(".a-offscreen")!.textContent=change==="higher_price"?"$7.00":"$6.98";
   if(change==="title_variant")f.doc.querySelector("#productTitle")!.textContent=S.title.replace("Pack of 1","Pack of 3");
   if(change==="child_asin")f.doc.querySelector<HTMLInputElement>('[name="ASIN"]')!.value="B0OTHER001";
   if(change==="quantity")f.doc.querySelector("form")!.insertAdjacentHTML("beforeend",'<input name="quantity" value="2">');
   if(change==="shipper")f.doc.querySelector("#merchantInfoFeature_feature_div")!.textContent="Shipper / Seller Other Amazon.com";
   if(change==="hidden_shipper")f.doc.querySelector("#merchantInfoFeature_feature_div")!.setAttribute("hidden","");
   if(change==="seller")f.doc.querySelector("#merchant-info")!.textContent="Ships from Amazon.com Sold by Other";
   if(change==="offer_id")f.doc.querySelector<HTMLInputElement>('[name="offerListingID"]')!.value="CHANGED_OFFER";
   if(change==="device")f.job.approvedTest={...auth,deviceId:"device_other"} as never;
   if(change==="source_time")f.job.approvedTest={...auth,sourceObservedAt:new Date(NOW).toISOString()} as never;
   if(change==="rehearsal")f.job.validationMode="rehearsal";
   if(change==="order")f.job.action="submit_order";
   if(change==="other_retailer")f.job.retailerId="target";
   if(change==="forged_msrp")f.job.officialMsrp={} as never;
   const result=commitAmazonAdd(f.doc,S.canonicalUrl,f.job,prepared.authorizationId,NOW+(change==="expiry"?60001:100));
   assert.equal(result.ok,change==="none",JSON.stringify(result));assert.equal(f.clicks(),change==="none"?1:0);
   if(change==="none"){assert.equal(commitAmazonAdd(f.doc,S.canonicalUrl,f.job,prepared.authorizationId,NOW+200).ok,false);assert.equal(f.clicks(),1);}
  }finally{f.dom.window.close();}
 });
}
