import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {verifyCartAddDelta,type BrowserActionContract,type CartBaselineProof,type CartInventoryEvidence,type LiveOfferProof} from "../packages/browser-safety/src/index.js";

const NOW=Date.parse("2026-10-02T14:00:00Z");
const source=readFileSync("apps/extension/background.js","utf8");
function functionSource(name:string){
 const start=source.indexOf(`async function ${name}(`);assert.ok(start>=0);
 const next=/\n(?:async )?function /g;next.lastIndex=start+1;
 const end=next.exec(source)?.index??source.length;return source.slice(start,end);
}
function runtime(rejectTestCart=false){
 const notifications:Array<{title:string;message:string}>=[];const events:string[]=[];
 const context=vm.createContext({Date:class extends Date{static override now(){return NOW;}},
  NOTIFICATION_ICON:"yoink-icon-128.png",ADD_LANES:{amazon:{name:"Amazon"}},ORDER_HANDOFF_KEY:"fixture-handoff",CART_READY_NOTIFICATION_PREFIX:"ready:",NEEDS_YOU_NOTIFICATION_PREFIX:"review:",
  PopupState:{cartReadyState:(value:{items:unknown[]})=>({items:value.items.map((x:any)=>({...x,retailerName:"Amazon",identityLabel:"ASIN"}))})},
  chrome:{tabs:{update:async(id:number)=>({id})},storage:{session:{get:async()=>({}),set:async()=>{}}},runtime:{getURL:(s:string)=>s},notifications:{clear:async()=>{},create:async(_id:string,n:{title:string;message:string})=>{events.push("notification");notifications.push(n);}}},
  safeReasonCode:(v:string)=>v,cartReadyLatency:()=>({}),markJobTiming:()=>{},
  mutateCartReadyState:async(fn:(value:{items:unknown[]})=>unknown)=>fn({items:[]}),playCartReadySound:async()=>{},
  clearBestBuyWait:async()=>{},freshCartBaseline:(v:unknown)=>v,reportRetailerReadiness:async()=>{},
  reportJob:async(_a:unknown,state:string)=>{if(rejectTestCart&&state==="cart_verified")throw Error("fixture rejected cart proof");events.push(state);},reportJobBatch:async(_a:unknown,b:Array<{state:string}>)=>{events.push(...b.map(x=>x.state));},
  clearActiveJob:async()=>{events.push("cleared");}});
 vm.runInContext(functionSource("publishActionHandoff")+"\n"+functionSource("completeVerifiedCart")+`
  function publishCartReady(a,t){return publishActionHandoff(a,"cart_ready","",t);}
  function publishNeedsYou(a,r){return publishActionHandoff(a,"needs_you",r);}
  globalThis.complete=completeVerifiedCart;`,context);
 return {notifications,events,complete:context.complete as (active:unknown,result:unknown)=>Promise<{confirmed:boolean}>};
}
function verifiedFixture(){
 const job:BrowserActionContract={contractVersion:1,jobId:"fixture_cart",retailerId:"amazon",retailerSku:"B0WANTIT01",canonicalUrl:"https://www.amazon.com/dp/B0WANTIT01",action:"add_to_cart",quantity:1,maxUnitPriceCents:699,maxOrderTotalCents:1699,currency:"USD",sellerPolicy:"first_party_only",expectedSeller:"Amazon.com",fulfillment:"shipping",expiresAt:new Date(NOW+60000).toISOString()};
 const baseline:CartBaselineProof={contractVersion:1,retailerId:"amazon",observedAt:new Date(NOW-1000).toISOString(),lineCount:1,lines:[{retailerSku:"B0KEEPIT01",quantity:2}]};
 const inventory:CartInventoryEvidence={contractVersion:1,observedAt:new Date(NOW).toISOString(),complete:true,independentlyCounted:true,independentLineCount:2,lines:[{retailerSku:"B0KEEPIT01",quantity:2,unitPriceCents:499,sellerName:"Amazon.com",sellerType:"first_party"},{retailerSku:job.retailerSku,quantity:1,unitPriceCents:699,sellerName:"Amazon.com",sellerType:"first_party"}]};
 const offer={contractVersion:1,jobId:job.jobId,retailerId:"amazon",retailerSku:job.retailerSku,observedAt:new Date(NOW-500).toISOString(),unitPriceCents:699,sellerName:"Amazon.com",sellerType:"first_party",fulfillment:"shipping"} as LiveOfferProof;
 return {job,baseline,inventory,offer,active:{id:job.jobId,retailerId:"amazon",tabId:1,runnerJob:job,cartBaseline:baseline,signedInState:"ready"}};
}
test("verified exact +1 cart delta preserves existing items then reaches the real notification function in a fixture",async()=>{
 const f=verifiedFixture();const result=verifyCartAddDelta(f.job,f.baseline,f.inventory,f.offer,NOW);assert.equal(result.ok,true);
 const r=runtime();assert.equal((await r.complete(f.active,result)).confirmed,true);
 assert.equal(r.notifications.length,1);assert.equal(r.notifications[0]!.title,"Cart ready at Amazon");
 assert.match(r.notifications[0]!.message,/B0WANTIT01 was added\. Checkout remains manual/);
 assert.ok(r.events.includes("cart_verified"));assert.ok(r.events.includes("confirmed"));
});
for(const mismatch of ["failed","missing_proof","wrong_job","wrong_sku","wrong_quantity","third_party","over_max_price","stale"]){
 test(`fixture ${mismatch} cannot announce cart success`,async()=>{
  const f=verifiedFixture();const verified=verifyCartAddDelta(f.job,f.baseline,f.inventory,f.offer,NOW);assert.ok(verified.ok);
  const result:any={...verified,proof:{...verified.proof}};
  if(mismatch==="failed")result.ok=false;
  if(mismatch==="missing_proof")delete result.proof;
  if(mismatch==="wrong_job")result.proof.jobId="another_job";
  if(mismatch==="wrong_sku")result.proof.retailerSku="B0OTHER001";
  if(mismatch==="wrong_quantity")result.proof.quantity=2;
  if(mismatch==="third_party")result.proof.sellerType="third_party";
  if(mismatch==="over_max_price")result.proof.unitPriceCents=700;
  if(mismatch==="stale")result.proof.observedAt=new Date(NOW-30001).toISOString();
  const r=runtime();assert.equal((await r.complete(f.active,result)).confirmed,false);
  assert.ok(r.notifications.every(n=>!n.title.startsWith("Cart ready")));
  assert.ok(!r.events.includes("confirmed"));assert.ok(r.events.includes("manual_review"));
 });
}
test("an unrelated existing cart quantity change fails before the success notification",async()=>{
 const f=verifiedFixture();f.inventory.lines[0]!.quantity=1;
 const result=verifyCartAddDelta(f.job,f.baseline,f.inventory,f.offer,NOW);assert.equal(result.ok,false);
 const r=runtime();assert.equal((await r.complete(f.active,result)).confirmed,false);
 assert.ok(r.notifications.every(n=>!n.title.startsWith("Cart ready")));
});

test("TEST label reaches notification only after cart proof is accepted by the server fixture",async()=>{
 const f=verifiedFixture(),result=verifyCartAddDelta(f.job,f.baseline,f.inventory,f.offer,NOW);assert.ok(result.ok);
 const active={...f.active,runnerJob:{...f.job,approvedTest:{test:true}}};
 const r=runtime();await r.complete(active,result);
 assert.equal(r.notifications[0]?.title,"TEST · Cart ready at Amazon");
 assert.match(r.notifications[0]!.message,/Owner-approved above-MSRP \/ older-alert TEST/);
 assert.ok(r.events.indexOf("cart_verified")<r.events.indexOf("notification"));
 assert.equal(r.events.filter(x=>x==="cart_verified").length,1);
});
test("a rejected TEST cart report cannot create a local success notification",async()=>{
 const f=verifiedFixture(),result=verifyCartAddDelta(f.job,f.baseline,f.inventory,f.offer,NOW);assert.ok(result.ok);
 const r=runtime(true);
 await assert.rejects(()=>r.complete({...f.active,runnerJob:{...f.job,approvedTest:{test:true}}},result));
 assert.equal(r.notifications.length,0);assert.ok(!r.events.includes("confirmed"));
});
