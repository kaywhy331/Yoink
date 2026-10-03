import assert from "node:assert/strict";
import test from "node:test";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import type { SignalEventInput } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { ExecutionRepository } from "../packages/database/src/execution-repository.js";
import { OfficialMsrpRepository } from "../packages/database/src/official-msrp-repository.js";
import { SingleCartAttemptRepository } from "../packages/database/src/single-cart-attempt-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope } from "../packages/database/src/request-scope.js";
import { resolveApiRoutePolicy } from "../apps/api/src/api-route-policy.js";
import { officialMsrpFixture } from "./helpers/official-msrp.js";
import { createYoinkServer } from "../apps/api/src/app.js";

const NOW=Date.parse("2026-10-02T12:00:00Z");
const iso=(offset=0)=>new Date(NOW+offset).toISOString();
const STORES={amazon:["B0WANTIT01","https://www.amazon.com/dp/B0WANTIT01"],
  target:["95111111","https://www.target.com/p/-/A-95111111"],
  walmart:["6661111","https://www.walmart.com/ip/6661111"],
  bestbuy:["6667316","https://www.bestbuy.com/site/example/6667316.p"]} as const;

/** All catalog, price, session and notification data here are synthetic, in memory. */
function fixture(retailer:keyof typeof STORES="target") {
  const db=new YoinkDatabase(); const lane=ADD_LANES[retailer];const [sku,url]=STORES[retailer];
  db.run("UPDATE retailers SET execution_supported=1 WHERE id=?",retailer);
  db.run("UPDATE source_connections SET status='connected' WHERE id='source_trackalacker_local'");
  const listing=new CatalogRepository(db).upsertListing({sourceConnectionId:"source_trackalacker_local",source:"trackalacker",
    sourceProductId:`one-${retailer}`,sourceListingId:`one-list-${retailer}`,title:"Synthetic ordinary puzzle",
    retailerId:retailer,retailerSku:sku,canonicalUrl:url,executionSupported:true,listingStatus:"in_stock",
    observedPriceCents:2499,currency:"USD",observedAt:iso()},NOW).listing;
  db.run("UPDATE listings SET execution_supported=1 WHERE id=?",listing.id);
  const evidence=officialMsrpFixture(db,listing.id,NOW,2999);
  const control=new ControlRepository(db);
  const mission=control.createConfiguredMission({contractVersion:1,listingId:listing.id,officialMsrpEvidenceId:evidence.id,
    targetQuantity:1,maxUnitPriceCents:2999,maxAllInCents:7999,actionCeiling:"add_to_cart",sellerPolicy:"first_party_only",
    fulfillment:"shipping",substitutionPolicy:"exact_only",expiresAt:iso(60_000),cooldownSeconds:0,
    confirmation:"CREATE_EXACT_PURCHASE_PLAN"},NOW).mission;
  db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id,user_id,retailer_id,adapter_version,highest_action,status,
    evidence_hash,qualified_at,updated_at,expires_at) VALUES(?,?,?,?,'add_to_cart','qualified','synthetic',?,?,?)`,
  LOCAL_TENANT_ID,LOCAL_USER_ID,retailer,lane.contractVersion,iso(),iso(),iso(300_000));
  const devices=new DeviceRepository(db);
  const pair=()=>devices.pair({pairingCode:devices.createPairingCode(NOW).code,capabilities:{jobReconciliation:true,
    officialMsrpCartV1:true,[lane.capability.enabled]:true,[lane.capability.version]:lane.contractVersion}},NOW).id;
  const deviceId=pair();
  db.run(`INSERT INTO retailer_session_readiness(tenant_id,user_id,device_id,retailer_id,signed_in_state,
    cart_baseline_state,baseline_observed_at,expires_at,adapter_version,updated_at) VALUES(?,?,?,?,'ready','ready',?,?,?,?)`,
  LOCAL_TENANT_ID,LOCAL_USER_ID,deviceId,retailer,iso(),iso(90_000),lane.contractVersion,iso());
  db.run("UPDATE app_settings SET execution_mode='live',actions_paused=1");
  const attempts=new SingleCartAttemptRepository(db);
  const input={confirmation:"ARM_ONE_CART_ATTEMPT" as const,missionId:mission.id,listingId:listing.id,deviceId,expiresAt:iso(90_000)};
  const signal:SignalEventInput={sourceConnectionId:"source_trackalacker_local",source:"trackalacker",externalEventId:`one-${retailer}-1`,
    eventType:"restock",observedAt:iso(1000),identity:{retailerId:retailer,retailerSku:sku,canonicalUrl:url,title:listing.title,
      sourceProductId:`one-${retailer}`,sourceListingId:`one-list-${retailer}`},offer:{availability:"in_stock",unitPriceCents:2499,
      currency:"USD",sellerType:"first_party",sellerName:lane.firstPartySeller,fulfillment:"shipping",orderLimit:1}};
  return {db,control,mission,listing,evidence,deviceId,pair,attempts,input,signal};
}

for(const retailer of Object.keys(STORES) as Array<keyof typeof STORES>) {
  test(`${retailer}: one exact fresh fixture job leases while broad buying stays paused`,()=>{
    const f=fixture(retailer);try {
      f.attempts.arm(f.input,NOW);
      const engine=new SignalEngine(f.db);const result=engine.process(f.signal,NOW+1000);
      assert.equal(result.actionJobState,"awaiting_executor",JSON.stringify(result));
      const execute=new ExecutionRepository(f.db);
      assert.equal(execute.leaseNextJob(f.pair(),NOW+1500).job,null,"another device cannot use this grant");
      const lease=execute.leaseNextJob(f.deviceId,NOW+2000);assert.ok(lease.job,JSON.stringify(lease));
      assert.equal(lease.job.quantity,1);assert.equal(lease.job.action,"add_to_cart");
      assert.equal(lease.job.maxUnitPriceCents,2499);assert.equal(lease.job.fulfillment,"shipping");
      execute.reconcileJob(f.deviceId,lease.job.id,lease.job.capabilityToken,"navigating","fixture_navigation","",{},NOW+2100);
      execute.reconcileJob(f.deviceId,lease.job.id,lease.job.capabilityToken,"verifying_listing","fixture_verify","",{},NOW+2200);
      execute.reconcileJob(f.deviceId,lease.job.id,lease.job.capabilityToken,"offer_verified","fixture_offer","",
        {retailerId:retailer,retailerSku:STORES[retailer][0],unitPriceCents:2499},NOW+2300);
      assert.equal(f.control.settings().actionsPaused,true);
      assert.throws(()=>f.attempts.arm(f.input,NOW+2500),{code:"single_cart_attempt_blocked"});
      engine.process({...f.signal,externalEventId:"another-real-fixture",observedAt:iso(3000)},NOW+3000);
      assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM action_jobs WHERE action='add_to_cart'")?.n,1);
    }finally{f.db.close();}
  });
}

for(const stop of ["cancel","pause_again","resume","expired","revoked","wrong_price"] as const) {
  test(`pre-click fixture boundary stops after ${stop}`,()=>{
    const f=fixture();try{
      const a=f.attempts.arm(f.input,NOW);const r=new SignalEngine(f.db).process(f.signal,NOW+1000);
      const x=new ExecutionRepository(f.db);const lease=x.leaseNextJob(f.deviceId,NOW+2000);assert.ok(lease.job);
      x.reconcileJob(f.deviceId,lease.job.id,lease.job.capabilityToken,"navigating","fixture_navigation","",{},NOW+2100);
      x.reconcileJob(f.deviceId,lease.job.id,lease.job.capabilityToken,"verifying_listing","fixture_verify","",{},NOW+2200);
      if(stop==="cancel")f.attempts.cancel(a.id,NOW+2300);
      if(stop==="pause_again")f.control.setActionsPaused(true,"Stop even the single attempt",NOW+2300);
      if(stop==="resume")f.control.setActionsPaused(false,"Changed global mode",NOW+2300);
      if(stop==="revoked")new OfficialMsrpRepository(f.db).revoke(f.listing.id,f.evidence.id,NOW+2300);
      assert.throws(()=>x.reconcileJob(f.deviceId,r.actionJobId!,lease.job!.capabilityToken,"offer_verified","fixture_offer","",
        {retailerId:"target",retailerSku:STORES.target[0],unitPriceCents:stop==="wrong_price"?2498:2499},
        NOW+(stop==="expired"?121_000:2400)));
    }finally{f.db.close();}
  });
}

for(const problem of ["missing_baseline","signed_out","stale_baseline","no_msrp","long_plan","no_confirmation"] as const) {
  test(`cannot arm with ${problem}`,()=>{
    const f=fixture();try{
      if(problem==="missing_baseline")f.db.run("UPDATE retailer_session_readiness SET cart_baseline_state='unavailable'");
      if(problem==="signed_out")f.db.run("UPDATE retailer_session_readiness SET signed_in_state='signed_out'");
      if(problem==="stale_baseline")f.db.run("UPDATE retailer_session_readiness SET baseline_observed_at=?",iso(-121_000));
      if(problem==="no_msrp")new OfficialMsrpRepository(f.db).revoke(f.listing.id,f.evidence.id,NOW);
      const input=problem==="no_confirmation"?{...f.input,confirmation:""}:
        problem==="long_plan"?{...f.input,expiresAt:iso(30_000)}:f.input;
      assert.throws(()=>f.attempts.arm(input as typeof f.input,NOW));
      assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM single_cart_attempts")?.n,0);
    }finally{f.db.close();}
  });
}

for(const badSignal of ["before_arm","stale","test","above_msrp","unknown_price"] as const) {
  test(`does not grant an attempt to ${badSignal} fixture signal`,()=>{
    const f=fixture();try{
      f.attempts.arm(f.input,NOW);
      if(badSignal==="before_arm")f.signal.observedAt=iso(-1000);
      if(badSignal==="stale")f.signal.observedAt=iso(-121_000);
      if(badSignal==="test")f.signal.test=true;
      if(badSignal==="above_msrp")f.signal.offer!.unitPriceCents=3999;
      if(badSignal==="unknown_price")f.signal.offer!.unitPriceCents=null;
      new SignalEngine(f.db).process(f.signal,NOW+1000);
      assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM action_jobs WHERE action='add_to_cart'")?.n,0);
    }finally{f.db.close();}
  });
}

test("only the existing local owner may arm; routes retain intent authorization",()=>{
  const f=fixture();try{
    assert.throws(()=>runWithRequestScope({...LOCAL_REQUEST_SCOPE,actorKind:"device",actorId:f.deviceId},()=>f.attempts.arm(f.input,NOW)));
    const {requestBoundary: _localBoundary,...nonLocalScope}=LOCAL_REQUEST_SCOPE;
    assert.throws(()=>runWithRequestScope(nonLocalScope,()=>f.attempts.arm(f.input,NOW)));
    assert.equal(resolveApiRoutePolicy("POST","/api/v1/user/cart-attempts")?.permission,"user.intent.manage");
    assert.equal(resolveApiRoutePolicy("DELETE","/api/v1/user/cart-attempts/cart_attempt_test")?.permission,"user.intent.manage");
  }finally{f.db.close();}
});

test("job creation and single-use assignment roll back together on a failed assignment",t=>{
 const f=fixture();try{
  f.attempts.arm(f.input,NOW);
  t.mock.method(SingleCartAttemptRepository.prototype,"assign",()=>{throw new Error("Fixture assignment interruption");});
  assert.throws(()=>new SignalEngine(f.db).process(f.signal,NOW+1000),/Fixture assignment interruption/);
  assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM action_jobs")?.n,0);
  assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM spend_reservations")?.n,0);
  assert.equal(f.db.get<{state:string}>("SELECT state FROM single_cart_attempts")?.state,"armed");
  assert.equal(f.control.settings().actionsPaused,true);
 }finally{f.db.close();}
});

test("local API arms and cancels one fixture attempt, rejecting missing review and foreign origins",async t=>{
  t.mock.method(Date,"now",()=>NOW+100);
  const f=fixture();
  const server=createYoinkServer({db:f.db,webRoot:process.cwd(),version:"fixture"});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const url=`http://127.0.0.1:${address.port}/api/v1/user/cart-attempts`;
  const post=(body:unknown,origin?:string)=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  try{
    assert.equal((await post({...f.input,confirmation:""})).status,409);
    assert.equal((await post(f.input,"https://untrusted.example")).status,403);
    const armed=await post(f.input);assert.equal(armed.status,201,await armed.clone().text());
    const {attempt}=await armed.json() as {attempt:{id:string}};
    assert.match(attempt.id,/^cart_attempt_/);
    assert.equal((await post(f.input)).status,409);
    const cancelled=await fetch(`${url}/${attempt.id}`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:"{}"});
    assert.equal(cancelled.status,200,await cancelled.clone().text());
    assert.equal(f.db.get<{state:string}>("SELECT state FROM single_cart_attempts WHERE id=?",attempt.id)?.state,"cancelled");
    assert.equal(f.control.settings().actionsPaused,true);
    assert.equal(f.db.get<{n:number}>("SELECT COUNT(*) AS n FROM action_jobs")?.n,0);
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();
  }
});
