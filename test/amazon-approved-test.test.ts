import assert from "node:assert/strict";
import test from "node:test";
import {AMAZON_APPROVED_TEST as S,amazonApprovedTestReason} from "../packages/contracts/src/amazon-approved-test.js";
import {AMAZON_ADD_ADAPTER_VERSION} from "../packages/contracts/src/index.js";
import {YoinkDatabase,LOCAL_TENANT_ID,LOCAL_USER_ID} from "../packages/database/src/database.js";
import {AmazonApprovedTestRepository} from "../packages/database/src/amazon-approved-test-repository.js";
import {ExecutionRepository} from "../packages/database/src/execution-repository.js";
import {CatalogRepository} from "../packages/database/src/catalog-repository.js";
import {DeviceRepository} from "../packages/database/src/device-repository.js";
import {LOCAL_REQUEST_SCOPE,runWithRequestScope} from "../packages/database/src/request-scope.js";
import {createYoinkServer} from "../apps/api/src/app.js";
import type {CartBaselineProof,LiveOfferProof} from "../packages/browser-safety/src/index.js";

const NOW=Date.parse("2026-10-02T16:00:00Z"),iso=(n=0)=>new Date(NOW+n).toISOString();
const confirmation="RUN_OWNER_APPROVED_AMAZON_TEST_20261002";
// Synthetic in-memory data only. No network, real credential, cart or notification.
function fixture(deviceId:string=S.deviceId){
 const db=new YoinkDatabase();
 const listing=new CatalogRepository(db).upsertListing({sourceConnectionId:"source_trackalacker_local",source:"trackalacker",sourceProductId:"fixture-test-cube",sourceListingId:"fixture-amazon-cube",title:S.title,retailerId:"amazon",retailerSku:S.retailerSku,canonicalUrl:S.canonicalUrl,executionSupported:true,listingStatus:"in_stock",observedPriceCents:699,currency:"USD",observedAt:S.sourceObservedAt},NOW).listing;
 const devices=new DeviceRepository(db);
 const pair=devices.pair({pairingCode:devices.createPairingCode(NOW).code,capabilities:{jobReconciliation:true,officialMsrpCartV1:true,approvedAmazonTest20261002:true,amazonAddOnly:true,amazonAddAdapterVersion:AMAZON_ADD_ADAPTER_VERSION}},NOW);
 db.run("UPDATE extension_devices SET id=? WHERE id=?",deviceId,pair.id);
 db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,evidence_hash,qualified_at,updated_at,expires_at)
  VALUES(?,?,'amazon',?,'add_to_cart','qualified','fixture',?,?,?)`,LOCAL_TENANT_ID,LOCAL_USER_ID,AMAZON_ADD_ADAPTER_VERSION,iso(),iso(),iso(600000));
 db.run(`INSERT INTO retailer_session_readiness(tenant_id,user_id,device_id,retailer_id,signed_in_state,cart_baseline_state,baseline_observed_at,expires_at,adapter_version,updated_at)
  VALUES(?,?,?,'amazon','ready','ready',?,?,?,?)`,LOCAL_TENANT_ID,LOCAL_USER_ID,deviceId,iso(),iso(120000),AMAZON_ADD_ADAPTER_VERSION,iso());
 db.run(`INSERT INTO signal_events(id,tenant_id,user_id,source_connection_id,signal_id,external_event_id,transport_hash,schema_version,source,event_type,test,observed_at,received_at,identity_json,offer_json,evidence_json,parser_version,resolution_status,created_at)
  VALUES(?,?,?,'source_trackalacker_local','fixture-original','fixture-original','fixture',1,'trackalacker','restock',0,?,?,?,?,'{}','fixture','matched',?)`,S.sourceEventId,LOCAL_TENANT_ID,LOCAL_USER_ID,S.sourceObservedAt,S.sourceObservedAt,JSON.stringify({sourceProductId:"fixture-test-cube",retailerId:"amazon"}),JSON.stringify({availability:"in_stock",unitPriceCents:699,currency:"USD",sellerType:"unknown"}),S.sourceObservedAt);
 db.run(`INSERT INTO resolution_decisions(id,event_id,status,method,variant_id,listing_id,reason,resolver_version,created_at)
  VALUES('fixture-resolution',?,'matched','fixture',NULL,?,'fixture','fixture',?)`,S.sourceEventId,listing.id,S.sourceObservedAt);
 db.run("UPDATE app_settings SET actions_paused=1,execution_mode='live',updated_at=?",iso());
 return {db,listing,repo:new AmazonApprovedTestRepository(db),execution:new ExecutionRepository(db)};
}
function lease(f:ReturnType<typeof fixture>){
 f.repo.start({confirmation},NOW);
 const result=f.execution.leaseNextJob(S.deviceId,NOW+10,["amazon"]);assert.ok(result.job,JSON.stringify(result));return result.job;
}
function before():CartBaselineProof{return {contractVersion:1,retailerId:"amazon",observedAt:iso(20),lineCount:1,lines:[{retailerSku:"B0KEEPIT01",quantity:2}]};}
function progress(f:ReturnType<typeof fixture>,job:ReturnType<typeof lease>){
 const x=f.execution;const event=(state:any,evidence:Record<string,unknown>,n:number)=>x.reconcileJob(S.deviceId,job.id,job.capabilityToken,state,"test_fixture","",evidence,NOW+n);
 event("navigating",{},20);event("verifying_listing",{approvedTestBaseline:before()},30);
 const offer:LiveOfferProof={contractVersion:1,jobId:S.id,retailerId:"amazon",retailerSku:S.retailerSku,observedAt:iso(40),unitPriceCents:699,currency:"USD",sellerName:"Amazon.com",sellerType:"first_party",fulfillment:"shipping"};
 return {event,offer};
}
test("one TEST uses the ordinary lease/progress interface, retains original alert and creates no MSRP, signal or plan",()=>{
 const f=fixture();try{
  const job=lease(f);assert.equal(job.officialMsrp,undefined);assert.equal(job.approvedTest?.sourceObservedAt,S.sourceObservedAt);
  assert.equal(amazonApprovedTestReason({...job,jobId:job.id},NOW+15),"");
  assert.equal(f.execution.leaseNextJob(S.deviceId,NOW+15).job,null,"lease never replayed");
  const {event,offer}=progress(f,job);event("offer_verified",{approvedTestOfferProof:offer},40);
  event("add_authorized",{},50);event("adding",{},60);
  const after={contractVersion:1,retailerId:"amazon",observedAt:iso(70),lineCount:2,lines:[...before().lines,{retailerSku:S.retailerSku,quantity:1}]};
  event("cart_verified",{approvedTestCartProof:{...offer,observedAt:iso(70),quantity:1},approvedTestCartBaseline:after},70);
  event("confirmed",{},80);
  assert.throws(()=>f.repo.start({confirmation},NOW+90),/cannot be replayed/);
  assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM official_msrp_evidence")?.n,0);
  assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM signal_events")?.n,1);
  assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM missions")?.n,0);
  assert.equal(f.db.get<{actions_paused:number}>("SELECT actions_paused FROM app_settings")?.actions_paused,1);
  assert.throws(()=>event("adding",{},90));
 }finally{f.db.close();}
});
for(const bad of ["no_confirmation","extra_flag","not_local","wrong_owner","signed_out","challenge","stale_baseline","stale_device","old_companion","bad_signal","changed_source_time","changed_listing","approval_expired"]){
 test(`TEST authorization rejects ${bad}`,()=>{const f=fixture();try{
  if(bad==="signed_out"||bad==="challenge")f.db.run("UPDATE retailer_session_readiness SET signed_in_state=?",bad==="challenge"?"challenged":"signed_out");
  if(bad==="stale_baseline")f.db.run("UPDATE retailer_session_readiness SET baseline_observed_at=?",iso(-120001));
  if(bad==="stale_device")f.db.run("UPDATE extension_devices SET last_seen_at=?",iso(-120001));
  if(bad==="old_companion")f.db.run("UPDATE extension_devices SET capabilities_json='{}'");
  if(bad==="bad_signal")f.db.run("UPDATE signal_events SET test=1");
  if(bad==="changed_source_time")f.db.run("UPDATE signal_events SET observed_at=?",iso());
  if(bad==="changed_listing")f.db.run("UPDATE listings SET retailer_sku='B0OTHER001'");
  const action=()=>f.repo.start(bad==="no_confirmation"?{}:bad==="extra_flag"?{confirmation,bypass:true} as never:{confirmation},bad==="approval_expired"?Date.parse(S.approvalExpiresAt):NOW);
  if(bad==="not_local"){const {requestBoundary:_b,...scope}=LOCAL_REQUEST_SCOPE;assert.throws(()=>runWithRequestScope(scope,action));}
  else if(bad==="wrong_owner")assert.throws(()=>runWithRequestScope({...LOCAL_REQUEST_SCOPE,actorKind:"device",actorId:S.deviceId},action));
  else assert.throws(action);
  assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM amazon_approved_test")?.n,0);
 }finally{f.db.close();}});
}
for(const bad of ["wrong_device","wrong_capability","replay","pause_changed","resumed","expired","higher_price","lower_price","wrong_seller","wrong_sku","quantity_existing","missing_cart_proof","unrelated_cart_change","submit_order"]){
 test(`TEST execution rejects ${bad} without a second lease`,()=>{const f=fixture();try{
  const job=lease(f);const {event,offer}=progress(f,job);
  if(bad==="wrong_device")assert.throws(()=>f.execution.reconcileJob("other_device",job.id,job.capabilityToken,"offer_verified","fixture","",{},NOW+40));
  else if(bad==="wrong_capability")assert.throws(()=>f.execution.reconcileJob(S.deviceId,job.id,"x".repeat(43),"offer_verified","fixture","",{},NOW+40));
  else if(["pause_changed","resumed","expired"].includes(bad)){
   if(bad==="pause_changed")f.db.run("UPDATE app_settings SET updated_at=?",iso(35));
   if(bad==="resumed")f.db.run("UPDATE app_settings SET actions_paused=0");
   assert.throws(()=>event("offer_verified",{approvedTestOfferProof:offer},bad==="expired"?300001:40));
  }else if(["higher_price","lower_price","wrong_seller","wrong_sku"].includes(bad)){
   if(bad==="higher_price")offer.unitPriceCents=700;if(bad==="lower_price")offer.unitPriceCents=698;
   if(bad==="wrong_seller")offer.sellerName="Other";if(bad==="wrong_sku")offer.retailerSku="B0OTHER001";
   assert.throws(()=>event("offer_verified",{approvedTestOfferProof:offer},40));
  }else{
   event("offer_verified",{approvedTestOfferProof:offer},40);event("add_authorized",{},50);event("adding",{},60);
   if(bad==="replay")assert.throws(()=>event("adding",{},65));
   if(bad==="submit_order")assert.throws(()=>event("submit_authorized",{},65));
   if(bad==="missing_cart_proof")assert.throws(()=>event("cart_verified",{},70));
   if(bad==="quantity_existing"||bad==="unrelated_cart_change"){
    const after={...before(),observedAt:iso(70),lineCount:2,lines:[{retailerSku:"B0KEEPIT01",quantity:bad==="unrelated_cart_change"?1:2},{retailerSku:S.retailerSku,quantity:bad==="quantity_existing"?2:1}]};
    assert.throws(()=>event("cart_verified",{approvedTestCartProof:{...offer,observedAt:iso(70),quantity:1},approvedTestCartBaseline:after},70));
   }
  }
  assert.equal(f.execution.leaseNextJob(S.deviceId,NOW+90).job,null);
 }finally{f.db.close();}});
}
const OLD_CHROME="device_7d1ae7d55d5e4ddb84f7a0a2c5607b5e";
test("old Chrome readiness alone cannot arm the TEST",()=>{
 const f=fixture(OLD_CHROME);try{
  assert.notEqual(S.deviceId,OLD_CHROME);
  assert.throws(()=>f.repo.start({confirmation},NOW));
  assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM amazon_approved_test")?.n,0);
 }finally{f.db.close();}
});
test("old Chrome cannot lease an armed Brave receipt; Brave leases once with exact device authority",()=>{
 const f=fixture();try{
  f.repo.start({confirmation},NOW);
  assert.ok(!f.execution.leaseNextJob(OLD_CHROME,NOW+10,["amazon"]).job);
  assert.equal(f.db.get<{state:string}>("SELECT state FROM amazon_approved_test")?.state,"awaiting_executor");
  const job=f.execution.leaseNextJob(S.deviceId,NOW+10,["amazon"]).job;
  assert.ok(job);assert.equal(job.approvedTest?.deviceId,S.deviceId);
  assert.equal(f.execution.leaseNextJob(S.deviceId,NOW+15,["amazon"]).job,null);
 }finally{f.db.close();}
});
test("old Chrome cannot progress even with a valid leased token",()=>{
 const f=fixture();try{
  const job=lease(f);
  assert.throws(()=>f.execution.reconcileJob(OLD_CHROME,job.id,job.capabilityToken,"navigating","test_fixture","",{},NOW+20));
  assert.equal(f.db.get<{state:string}>("SELECT state FROM amazon_approved_test")?.state,"leased");
 }finally{f.db.close();}
});
test("unchanged approval expiry rejects at its exact boundary",()=>{
 const end=Date.parse(S.approvalExpiresAt),expiresAt=S.approvalExpiresAt;
 const job={jobId:S.id,retailerId:"amazon",retailerSku:S.retailerSku,canonicalUrl:S.canonicalUrl,action:"add_to_cart",quantity:1,maxUnitPriceCents:699,maxOrderTotalCents:699,currency:"USD",sellerPolicy:"first_party_only",expectedSeller:S.seller,fulfillment:"shipping",expiresAt,
  approvedTest:{version:1,approvalId:S.approvalId,jobId:S.id,deviceId:S.deviceId,desiredVariant:S.desiredVariant,sourceEventId:S.sourceEventId,sourceObservedAt:S.sourceObservedAt,exceptions:["owner_approved_TEST_above_MSRP","owner_approved_TEST_stale_signal"],issuedAt:new Date(end-1000).toISOString(),expiresAt,noOrderAuthorization:true}} as const;
 assert.equal(amazonApprovedTestReason(job as never,end-1),"");
 assert.equal(amazonApprovedTestReason(job as never,end),"approved_amazon_test_invalid");
});
test("atomic failure rolls back TEST authorization and its audit",()=>{
 const f=fixture();try{
  f.db.connection.exec("CREATE TRIGGER fixture_fail_test_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'fixture'); END;");
  assert.throws(()=>f.repo.start({confirmation},NOW));
  assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM amazon_approved_test")?.n,0);
 }finally{f.db.close();}
});
test("fixed local API rejects foreign origins and arbitrary widening fields",async t=>{
 t.mock.method(Date,"now",()=>NOW);const f=fixture();const server=createYoinkServer({db:f.db,webRoot:process.cwd(),version:"fixture"});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();assert.ok(address&&typeof address!=="string");
 const url=`http://127.0.0.1:${address.port}/api/v1/user/amazon-approved-test-20261002`;
 const post=(body:unknown,origin?:string)=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
 try{
  assert.equal((await post({confirmation},"https://untrusted.example")).status,403);
  assert.equal((await post({confirmation,retailerSku:"B0OTHER001"})).status,409);
  const result=await post({confirmation});assert.equal(result.status,201,await result.clone().text());
  assert.equal((await post({confirmation})).status,409);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));f.db.close();}
});
