import type { NormalizedSignal } from "../../contracts/src/index.js";
import { DomainConflictError } from "../../domain/src/domain-request-error.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { OfficialMsrpRepository } from "./official-msrp-repository.js";
import { PurchasePolicyRepository } from "./purchase-policy-repository.js";
import { currentRequestScope, isExactLocalRequestScope } from "./request-scope.js";

interface Attempt {
  id: string; mission_id: string; listing_id: string; device_id: string;
  intent_revision_id: string; evidence_id: string; evidence_hash: string;
  pause_settings_at: string; created_at: string; expires_at: string; job_id: string;
  state: "armed" | "assigned" | "cancelled" | "expired";
}
export interface SingleCartAttemptInput {
  confirmation: "ARM_ONE_CART_ATTEMPT";
  missionId: string; listingId: string; deviceId: string; expiresAt: string;
}
function fail(message: string): never { throw new DomainConflictError("single_cart_attempt_blocked", message); }

/** Local-only, single-use exception to one particular paused settings revision.
 * Does not change a plan, store switch, pause setting, MSRP, session or signal.
 */
export class SingleCartAttemptRepository {
  constructor(private readonly db: YoinkDatabase) {}

  private currentSettings() {
    return this.db.get<{ actions_paused: number; execution_mode: string; updated_at: string }>(
      "SELECT actions_paused,execution_mode,updated_at FROM app_settings WHERE user_id=?", currentRequestScope().userId);
  }
  private valid(row: Attempt, now: number): boolean {
    const settings = this.currentSettings();
    const policy = new PurchasePolicyRepository(this.db).current(row.mission_id);
    const official = new OfficialMsrpRepository(this.db).current(row.listing_id, now);
    return settings?.actions_paused === 1 && settings.execution_mode === "live"
      && settings.updated_at === row.pause_settings_at && Date.parse(row.expires_at) > now
      && Date.parse(row.created_at) <= now && policy?.id === row.intent_revision_id
      && !!official && official.id === row.evidence_id && official.evidenceHash === row.evidence_hash;
  }
  private sessionReady(row: Pick<Attempt, "device_id" | "listing_id">, now: number): boolean {
    return !!this.db.get(`SELECT 1 FROM retailer_session_readiness r
      JOIN listings l ON l.retailer_id=r.retailer_id AND l.id=?
      JOIN extension_devices d ON d.id=r.device_id AND d.user_id=r.user_id AND d.status='active'
      JOIN retailer_adapter_qualifications q ON q.tenant_id=r.tenant_id AND q.user_id=r.user_id
        AND q.retailer_id=r.retailer_id AND q.adapter_version=r.adapter_version
      WHERE r.tenant_id=? AND r.user_id=? AND r.device_id=?
        AND r.signed_in_state='ready' AND r.cart_baseline_state='ready'
        AND r.baseline_observed_at>=? AND r.baseline_observed_at<=? AND r.expires_at>?
        AND q.status='qualified' AND q.highest_action='add_to_cart' AND q.expires_at>?
        AND d.last_seen_at>=? AND d.last_seen_at<=?
        AND json_extract(d.capabilities_json,'$.officialMsrpCartV1')=1`,
    row.listing_id, currentRequestScope().tenantId, currentRequestScope().userId, row.device_id,
    nowIso(now - 120_000), nowIso(now), nowIso(now), nowIso(now), nowIso(now - 120_000), nowIso(now));
  }
  arm(input: SingleCartAttemptInput, now = Date.now()): Attempt {
    new AuthorizationRepository(this.db).require("user.intent.manage");
    if (!isExactLocalRequestScope()) fail("Single cart attempts are supported only by the local SQLite app.");
    return this.db.transaction(() => {
      const scope = currentRequestScope();
      const settings = this.currentSettings();
      const end = Date.parse(input?.expiresAt);
      if (input?.confirmation !== "ARM_ONE_CART_ATTEMPT"
        || ![input.missionId,input.listingId,input.deviceId].every(id=>typeof id==="string" && /^[A-Za-z0-9_-]{3,120}$/.test(id))
        || settings?.actions_paused !== 1
        || settings.execution_mode !== "live" || !Number.isFinite(end) || end <= now || end > now + 15 * 60_000) {
        fail("Keep buying paused and explicitly authorize one attempt for at most 15 minutes.");
      }
      const policy = new PurchasePolicyRepository(this.db).current(input.missionId);
      const targets = policy?.targets.filter(target => target.enabled) ?? [];
      const target = targets[0];
      if (!policy || targets.length !== 1 || target?.listingId !== input.listingId
        || policy.actionCeiling !== "add_to_cart" || policy.decisionMode !== "purchase_intent"
        || policy.quantity !== 1 || policy.currency !== "USD" || policy.substitutionPolicy !== "exact_only"
        || !policy.maxAllInCents || !Number.isFinite(Date.parse(policy.expiresAt))
        || Date.parse(policy.expiresAt) <= now || Date.parse(policy.expiresAt) > end
        || target.sellerPolicy !== "first_party_only" || target.fulfillment !== "shipping") {
        fail("Review a short-lived exact single-item, first-party Shipping cart plan with separate item and all-in caps.");
      }
      const official = new OfficialMsrpRepository(this.db).require(input.listingId, now);
      if (target.officialMsrpEvidenceId !== official.id || target.officialMsrpEvidenceHash !== official.evidenceHash
        || target.desiredVariant !== official.desiredVariant || !target.maxUnitPriceCents
        || target.maxUnitPriceCents > official.msrpCents) fail("The plan must bind the current exact variant and official MSRP review.");
      if (!this.db.get("SELECT 1 FROM missions WHERE id=? AND user_id=? AND status='active'", input.missionId, scope.userId)
        || !this.sessionReady({ device_id: input.deviceId, listing_id: input.listingId }, now)) {
        fail("Verify this paired browser's sign-in, existing cart baseline and current retailer adapter first.");
      }
      this.db.run("UPDATE single_cart_attempts SET state='expired' WHERE tenant_id=? AND user_id=? AND expires_at<=? AND state IN ('armed','assigned')",
        scope.tenantId, scope.userId, nowIso(now));
      if (this.db.get("SELECT 1 FROM single_cart_attempts WHERE tenant_id=? AND user_id=? AND state IN ('armed','assigned')", scope.tenantId, scope.userId)) {
        fail("A cart attempt already exists. Finish or cancel it before authorizing another.");
      }
      const id = newId("cart_attempt");
      this.db.run(`INSERT INTO single_cart_attempts(id,tenant_id,user_id,mission_id,listing_id,device_id,
        intent_revision_id,evidence_id,evidence_hash,pause_settings_at,created_at,expires_at,state)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'armed')`, id, scope.tenantId, scope.userId, input.missionId, input.listingId,
      input.deviceId, policy.id, official.id, official.evidenceHash, settings.updated_at, nowIso(now), nowIso(end));
      new AuditRepository(this.db).record({correlationId:id,aggregateType:"single_cart_attempt",eventType:"single_cart_attempt_armed",
        reasonCode:"one_item_while_paused",message:"One exact cart attempt was authorized; global buying remains paused.",
        data:{listingId:input.listingId,missionId:input.missionId,deviceId:input.deviceId,expiresAt:nowIso(end)}},now);
      return this.db.get<Attempt>("SELECT * FROM single_cart_attempts WHERE id=?", id)!;
    });
  }
  forSignal(missionId: string, listingId: string, signal: NormalizedSignal, now: number): Attempt | null {
    const scope = currentRequestScope();
    const row = this.db.get<Attempt>(`SELECT * FROM single_cart_attempts WHERE tenant_id=? AND user_id=?
      AND mission_id=? AND listing_id=? AND state='armed'`, scope.tenantId, scope.userId, missionId, listingId);
    if (!row || !this.valid(row,now) || !this.sessionReady(row,now)
      || Date.parse(signal.observedAt) < Date.parse(row.created_at)) return null;
    const target = new PurchasePolicyRepository(this.db).current(missionId)?.targets.find(t=>t.listingId===listingId);
    if (!target) return null;
    try { new OfficialMsrpRepository(this.db).authorizeSignal(listingId,target,signal,now); }
    catch (error) { if (error instanceof DomainConflictError) return null; throw error; }
    return row;
  }
  assign(id: string, jobId: string, now: number): void {
    const scope = currentRequestScope();
    const row = this.db.get<Attempt>("SELECT * FROM single_cart_attempts WHERE id=? AND tenant_id=? AND user_id=?",id,scope.tenantId,scope.userId);
    const job = this.db.get<{listing_id:string;intent_revision_id:string;action:string;state:string}>(
      "SELECT listing_id,intent_revision_id,action,state FROM action_jobs WHERE id=? AND user_id=?",jobId,scope.userId);
    if (!row || !this.valid(row,now) || job?.listing_id!==row.listing_id || job.intent_revision_id!==row.intent_revision_id
      || job.action!=="add_to_cart" || job.state!=="awaiting_executor") fail("The single cart job changed before assignment.");
    const changed=this.db.run("UPDATE single_cart_attempts SET state='assigned',job_id=? WHERE id=? AND state='armed'",jobId,id);
    if (changed.changes!==1) fail("This cart attempt was already consumed.");
  }
  permitsJob(jobId: string, deviceId: string, now: number): boolean {
    const scope=currentRequestScope();
    const row=this.db.get<Attempt>("SELECT * FROM single_cart_attempts WHERE job_id=? AND tenant_id=? AND user_id=? AND device_id=? AND state='assigned'",
      jobId,scope.tenantId,scope.userId,deviceId);
    return !!row && this.valid(row,now) && this.sessionReady(row,now);
  }
  pendingJob(deviceId:string,now:number):string {
    const scope=currentRequestScope();
    const row=this.db.get<Attempt>("SELECT * FROM single_cart_attempts WHERE tenant_id=? AND user_id=? AND device_id=? AND state='assigned'",
      scope.tenantId,scope.userId,deviceId);
    return row && this.valid(row,now) ? row.job_id : "";
  }
  cancel(id:string,now=Date.now()):void {
    new AuthorizationRepository(this.db).require("user.intent.manage");
    const scope=currentRequestScope();
    const result=this.db.run("UPDATE single_cart_attempts SET state='cancelled' WHERE id=? AND tenant_id=? AND user_id=? AND state IN ('armed','assigned')",
      id,scope.tenantId,scope.userId);
    if(result.changes!==1) fail("This attempt is unavailable or already closed.");
    new AuditRepository(this.db).record({correlationId:id,aggregateType:"single_cart_attempt",eventType:"single_cart_attempt_cancelled",
      reasonCode:"user_cancelled",message:"The single cart attempt was cancelled; no new Add authorization can be issued.",data:{}},now);
  }
}
