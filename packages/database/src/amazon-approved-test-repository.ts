import {randomBytes} from "node:crypto";
import {AMAZON_APPROVED_TEST as SPEC,amazonApprovedTestReason,type AmazonApprovedTestAuthorization} from "../../contracts/src/amazon-approved-test.js";
import {AMAZON_ADD_ADAPTER_VERSION,type JobState} from "../../contracts/src/index.js";
import {verifyCartAddDelta,type BrowserActionContract,type CartBaselineProof,type CartProof,type LiveOfferProof} from "../../browser-safety/src/index.js";
import {assertJobTransition,jobMayHaveMutated} from "../../domain/src/job-state.js";
import {DomainConflictError} from "../../domain/src/domain-request-error.js";
import {nowIso,stableHash} from "../../domain/src/ids.js";
import {AuditRepository} from "./audit-repository.js";
import {AuthorizationRepository} from "./authorization-repository.js";
import {currentRequestScope,isExactLocalRequestScope} from "./request-scope.js";
import type {YoinkDatabase} from "./database.js";
import type {JobLease,LeaseResult} from "./execution-repository.js";

interface Row {
 id:string;tenant_id:string;user_id:string;listing_id:string;device_id:string;source_event_id:string;
 authority_json:string;state:JobState;capability_hash:string;lease_expires_at:string;pause_settings_at:string;
 listing_identity_hash:string;before_cart_json:string;offer_proof_json:string;final_cart_json:string;
 expires_at:string;created_at:string;updated_at:string;
}
function fail(message:string):never{throw new DomainConflictError("approved_amazon_test_blocked",message);}
const hash=(token:string)=>stableHash("amazon_approved_test_capability_v1",token);
const MAX_LEASE_MS=45_000;

/** A separate durable TEST receipt; no fabricated MSRP, purchase plan or signal. */
export class AmazonApprovedTestRepository {
 constructor(private readonly db:YoinkDatabase){}
 private row():Row|undefined {
  const s=currentRequestScope();
  return this.db.get<Row>("SELECT * FROM amazon_approved_test WHERE id=? AND tenant_id=? AND user_id=?",SPEC.id,s.tenantId,s.userId);
 }
 private settings(){return this.db.get<{actions_paused:number;execution_mode:string;updated_at:string}>(
  "SELECT actions_paused,execution_mode,updated_at FROM app_settings WHERE user_id=?",currentRequestScope().userId);}
 private listingHash(id:string):string {
  const row=this.db.get<{id:string;retailer_id:string;retailer_sku:string;canonical_url:string;title:string}>(
   "SELECT l.id,l.retailer_id,l.retailer_sku,l.canonical_url,v.title FROM listings l JOIN variants v ON v.id=l.variant_id WHERE l.id=?",id);
  if(!row||row.retailer_id!==SPEC.retailerId||row.retailer_sku!==SPEC.retailerSku||row.canonical_url!==SPEC.canonicalUrl)fail("The trusted exact Amazon listing changed.");
  return stableHash(JSON.stringify(row));
 }
 private requireSession(now:number):void {
  const s=currentRequestScope();
  if(!this.db.get(`SELECT 1 FROM retailer_session_readiness r
   JOIN extension_devices d ON d.id=r.device_id AND d.user_id=r.user_id AND d.status='active'
   JOIN retailer_adapter_qualifications q ON q.tenant_id=r.tenant_id AND q.user_id=r.user_id
    AND q.retailer_id=r.retailer_id AND q.adapter_version=r.adapter_version
   WHERE r.tenant_id=? AND r.user_id=? AND r.device_id=? AND r.retailer_id='amazon'
    AND r.signed_in_state='ready' AND r.cart_baseline_state='ready'
    AND r.baseline_observed_at>=? AND r.baseline_observed_at<=? AND r.expires_at>?
    AND r.adapter_version=? AND q.status='qualified' AND q.highest_action='add_to_cart' AND q.expires_at>?
    AND d.last_seen_at>=? AND d.last_seen_at<=?
    AND json_extract(d.capabilities_json,'$.approvedAmazonTest20261002')=1
    AND json_extract(d.capabilities_json,'$.jobReconciliation')=1
    AND json_extract(d.capabilities_json,'$.amazonAddOnly')=1
    AND json_extract(d.capabilities_json,'$.amazonAddAdapterVersion')='amazon-add-v11'`,
   s.tenantId,s.userId,SPEC.deviceId,nowIso(now-120_000),nowIso(now),nowIso(now),AMAZON_ADD_ADAPTER_VERSION,nowIso(now),nowIso(now-120_000),nowIso(now))) {
   fail("Refresh the actual signed-in Amazon cart baseline and qualified paired companion first.");
  }
 }
 private contract(row:Row):BrowserActionContract {
  return {contractVersion:1,jobId:SPEC.id,retailerId:SPEC.retailerId,retailerSku:SPEC.retailerSku,
   canonicalUrl:SPEC.canonicalUrl,action:"add_to_cart",quantity:1,maxUnitPriceCents:SPEC.unitPriceCents,
   maxOrderTotalCents:SPEC.unitPriceCents,currency:"USD",sellerPolicy:"first_party_only",expectedSeller:SPEC.seller,
   fulfillment:"shipping",expiresAt:row.expires_at,approvedTest:JSON.parse(row.authority_json) as AmazonApprovedTestAuthorization};
 }
 private valid(row:Row,now:number):void {
  const s=this.settings();
  if(s?.actions_paused!==1||s.execution_mode!=="live"||s.updated_at!==row.pause_settings_at)fail("Pause settings changed; this TEST authority is invalid.");
  if(amazonApprovedTestReason(this.contract(row),now)||row.device_id!==SPEC.deviceId||this.listingHash(row.listing_id)!==row.listing_identity_hash)fail("This exact TEST authority expired or changed.");
 }
 private audit(row:Pick<Row,"id">,state:string,data:Record<string,unknown>,now:number):void {
  new AuditRepository(this.db).record({correlationId:row.id,aggregateType:"amazon_approved_test",eventType:"approved_amazon_test_"+state,
   reasonCode:"owner_approved_test_above_msrp_stale_signal",message:"TEST: one owner-approved Amazon cart attempt; no order authorization.",data},now);
 }
 start(input:{confirmation?:unknown},now=Date.now()):{id:string;state:JobState;expiresAt:string;test:true} {
  new AuthorizationRepository(this.db).require("user.intent.manage");
  if(!isExactLocalRequestScope()||input?.confirmation!=="RUN_OWNER_APPROVED_AMAZON_TEST_20261002"
   ||Object.keys(input).some(k=>k!=="confirmation"))fail("Only this exact local owner-approved Amazon TEST is supported.");
  return this.db.transaction(()=>{
   if(this.db.get("SELECT 1 FROM amazon_approved_test WHERE id=?",SPEC.id))fail("The one-use TEST was already authorized. It cannot be replayed or rearmed.");
   const settings=this.settings();
   if(settings?.actions_paused!==1||settings.execution_mode!=="live")fail("Keep ordinary buying paused in live mode.");
   const end=Math.min(now+SPEC.maxDurationMs,Date.parse(SPEC.approvalExpiresAt));
   if(end<=now||now<Date.parse(SPEC.sourceObservedAt))fail("The dated owner approval is unavailable.");
   this.requireSession(now);
   if(this.db.get("SELECT 1 FROM single_cart_attempts WHERE state IN ('armed','assigned')"))fail("Another scoped attempt must finish first.");
   if(this.db.get("SELECT 1 FROM action_jobs WHERE user_id=? AND state IN ('awaiting_executor','leased','navigating','verifying_listing','offer_verified','add_authorized','adding','cart_verified','checkout_review','submit_authorized','submitting')",currentRequestScope().userId))fail("Another action job must finish before this TEST.");
   const scope=currentRequestScope();
   const source=this.db.get<{listing_id:string;observed_at:string;received_at:string;offer_json:string}>(`SELECT r.listing_id,e.observed_at,e.received_at,e.offer_json FROM signal_events e
    JOIN resolution_decisions r ON r.event_id=e.id AND r.status='matched'
    JOIN listings l ON l.id=r.listing_id
    WHERE e.id=? AND e.tenant_id=? AND e.user_id=? AND e.source='trackalacker' AND e.test=0
     AND l.retailer_id='amazon' AND l.retailer_sku=?`,SPEC.sourceEventId,scope.tenantId,scope.userId,SPEC.retailerSku);
   if(!source||source.observed_at!==SPEC.sourceObservedAt||Date.parse(source.received_at)>now)fail("The original resolved natural Trackalacker alert is missing or changed.");
   const offer=JSON.parse(source.offer_json) as {availability?:unknown;unitPriceCents?:unknown;currency?:unknown};
   if(offer.availability!=="in_stock"||offer.unitPriceCents!==699||offer.currency!=="USD")fail("The original signal's item/price evidence changed.");
   const authority:AmazonApprovedTestAuthorization={version:1,approvalId:SPEC.approvalId,jobId:SPEC.id,deviceId:SPEC.deviceId,
    desiredVariant:SPEC.desiredVariant,sourceEventId:SPEC.sourceEventId,sourceObservedAt:SPEC.sourceObservedAt,
    exceptions:["owner_approved_TEST_above_MSRP","owner_approved_TEST_stale_signal"],issuedAt:nowIso(now),expiresAt:nowIso(end),noOrderAuthorization:true};
   this.db.run(`INSERT INTO amazon_approved_test(id,tenant_id,user_id,listing_id,device_id,source_event_id,authority_json,state,
    pause_settings_at,listing_identity_hash,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'awaiting_executor',?,?,?,?,?)`,SPEC.id,scope.tenantId,scope.userId,source.listing_id,SPEC.deviceId,SPEC.sourceEventId,
    JSON.stringify(authority),settings.updated_at,this.listingHash(source.listing_id),nowIso(end),nowIso(now),nowIso(now));
   this.audit({id:SPEC.id},"authorized",{...authority,unitPriceCents:699,quantity:1,sourceReceivedAt:source.received_at,officialMsrpEvidenceCreated:false},now);
   return {id:SPEC.id,state:"awaiting_executor",expiresAt:nowIso(end),test:true};
  });
 }
 lease(deviceId:string,now:number):LeaseResult|null {
  const row=this.row();if(!row||row.state!=="awaiting_executor"||deviceId!==SPEC.deviceId)return null;
  try{this.valid(row,now);this.requireSession(now);}catch(error){
   if(!(error instanceof DomainConflictError))throw error;
   this.db.run("UPDATE amazon_approved_test SET state='cancelled',updated_at=? WHERE id=? AND state='awaiting_executor'",nowIso(now),row.id);
   this.audit(row,"cancelled",{reason:error.message},now);return null;
  }
  const token=randomBytes(32).toString("base64url"),leaseEnd=nowIso(Math.min(Date.parse(row.expires_at),now+MAX_LEASE_MS));
  if(this.db.run("UPDATE amazon_approved_test SET state='leased',capability_hash=?,lease_expires_at=?,updated_at=? WHERE id=? AND state='awaiting_executor'",hash(token),leaseEnd,nowIso(now),row.id).changes!==1)return null;
  this.audit(row,"leased",{deviceId},now);
  const job=this.contract(row);
  return {reason:"leased",job:{...job,id:row.id,adapterVersion:AMAZON_ADD_ADAPTER_VERSION,capabilityToken:token,state:"leased",
   attributionUrl:"",attributionProvider:"",attributionMetadata:{},leaseExpiresAt:leaseEnd} as JobLease};
 }
 private authorized(deviceId:string,token:string,now:number):Row {
  const row=this.row();
  if(!row||deviceId!==SPEC.deviceId||row.device_id!==deviceId||!token||row.capability_hash!==hash(token))fail("Invalid TEST job capability or paired browser.");
  if(Date.parse(row.lease_expires_at)<now&&!jobMayHaveMutated(row.state))fail("TEST lease expired before Add; no retry.");
  return row;
 }
 reconcile(deviceId:string,token:string,next:JobState,evidence:Record<string,unknown>,now:number):Record<string,unknown> {
  const row=this.authorized(deviceId,token,now);
  if(["submit_authorized","submitting","submission_uncertain"].includes(next)||next==="confirmed"&&row.state!=="cart_verified")fail("This TEST never authorizes an order or unverified success.");
  assertJobTransition(row.state,next);
  if(!jobMayHaveMutated(row.state)&&!["cancelled","expired","offer_rejected","manual_review"].includes(next)){this.valid(row,now);this.requireSession(now);}
  if(next==="verifying_listing"){
   const before=evidence.approvedTestBaseline as CartBaselineProof;
   if(!before||before.contractVersion!==1||before.retailerId!=="amazon"||!Array.isArray(before.lines)||before.lineCount!==before.lines.length
    ||now-Date.parse(before.observedAt)<0||now-Date.parse(before.observedAt)>120_000||!Number.isFinite(Date.parse(before.observedAt))
    ||before.lines.some(l=>l.retailerSku===SPEC.retailerSku))fail("Fresh complete baseline without the test item is required before Add.");
   this.db.run("UPDATE amazon_approved_test SET before_cart_json=? WHERE id=?",JSON.stringify(before),row.id);
  }
  if(next==="offer_verified"){
   const p=evidence.approvedTestOfferProof as LiveOfferProof;
   if(!p||p.contractVersion!==1||p.jobId!==SPEC.id||p.retailerId!=="amazon"||p.retailerSku!==SPEC.retailerSku||p.unitPriceCents!==699
    ||p.sellerType!=="first_party"||p.sellerName!==SPEC.seller||p.fulfillment!=="shipping"||p.currency!=="USD"
    ||!Number.isFinite(Date.parse(p.observedAt))||now-Date.parse(p.observedAt)<0||now-Date.parse(p.observedAt)>30_000)fail("The current exact TEST offer changed or is stale.");
   this.db.run("UPDATE amazon_approved_test SET offer_proof_json=? WHERE id=?",JSON.stringify(p),row.id);
  }
  if(next==="cart_verified"){
   const proof=evidence.approvedTestCartProof as CartProof,after=evidence.approvedTestCartBaseline as CartBaselineProof;
   if(!proof||!after||proof.unitPriceCents!==699||proof.quantity!==1||proof.sellerName!==SPEC.seller||proof.sellerType!=="first_party"
    ||proof.jobId!==SPEC.id||proof.retailerSku!==SPEC.retailerSku||proof.retailerId!=="amazon"||proof.contractVersion!==1
    ||!Number.isFinite(Date.parse(proof.observedAt))||now-Date.parse(proof.observedAt)<0||now-Date.parse(proof.observedAt)>30_000
    ||after.retailerId!=="amazon"||after.observedAt!==proof.observedAt||!Array.isArray(after.lines))fail("No TEST success without fresh exact cart proof.");
   const verified=verifyCartAddDelta(this.contract(row),JSON.parse(row.before_cart_json) as CartBaselineProof,
    {contractVersion:1,observedAt:after.observedAt,complete:true,independentlyCounted:true,independentLineCount:after.lineCount,
     lines:after.lines.map(l=>({...l,unitPriceCents:l.retailerSku===SPEC.retailerSku?proof.unitPriceCents:null,sellerName:l.retailerSku===SPEC.retailerSku?proof.sellerName:"",sellerType:l.retailerSku===SPEC.retailerSku?"first_party":"unknown"}))},
    JSON.parse(row.offer_proof_json) as LiveOfferProof,now);
   if(!verified.ok)fail("Actual TEST cart delta not verified: "+verified.reason);
   this.db.run("UPDATE amazon_approved_test SET final_cart_json=? WHERE id=?",JSON.stringify({proof,after}),row.id);
  }
  const terminal=["confirmed","cancelled","expired","offer_rejected","manual_review"].includes(next);
  this.db.run("UPDATE amazon_approved_test SET state=?,capability_hash=?,lease_expires_at=?,updated_at=? WHERE id=? AND state=?",
   next,terminal?"":row.capability_hash,nowIso(Math.min(Date.parse(row.expires_at),now+MAX_LEASE_MS)),nowIso(now),row.id,row.state);
  this.audit(row,next,{state:next,quantity:1,unitPriceCents:699},now);
  return {id:row.id,state:next,test:true};
 }
 heartbeat(deviceId:string,token:string,now:number){
  const row=this.authorized(deviceId,token,now);if(!jobMayHaveMutated(row.state))this.valid(row,now);
  const end=Math.min(Date.parse(row.expires_at),now+MAX_LEASE_MS);
  this.db.run("UPDATE amazon_approved_test SET lease_expires_at=?,updated_at=? WHERE id=?",nowIso(end),nowIso(now),row.id);
  return {jobId:row.id,state:row.state,leaseExpiresAt:nowIso(end),remainingBudgetMs:Math.max(0,Date.parse(row.expires_at)-now)};
 }
}
