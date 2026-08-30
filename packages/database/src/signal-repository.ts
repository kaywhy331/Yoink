import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  type AttributionPlan,
  type JobState,
  type ListingContext,
  type MissionContext,
  type NormalizedSignal,
  type SignalProcessingResult,
  type StrategyEvaluation
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { assertJobTransition, jobMayHaveMutated } from "../../domain/src/job-state.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import type { AppSettings } from "./control-repository.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { NotificationRepository } from "./notification-repository.js";
import { AttributionRepository } from "./attribution-repository.js";
import { AuditRepository } from "./audit-repository.js";
import { OfferIdentityRepository } from "./offer-identity-repository.js";
import { PurchasePolicyRepository } from "./purchase-policy-repository.js";
import { SpendLedgerRepository } from "./spend-ledger-repository.js";

export interface SourceConnectionContext {
  id: string;
  source: string;
  trustLevel: string;
  autoCreateMissions: boolean;
}

export interface IncidentRecord {
  id: string;
  listingId: string;
  semanticKey: string;
  status: string;
  occurrenceCount: number;
  lastObservedAt: string;
}

export interface JobRecord {
  id: string;
  incidentId: string;
  missionId: string;
  state: JobState;
  action: string;
  idempotencyKey: string;
  created: boolean;
  policyBlocked?: boolean;
  decisionReasonCode?: string;
  decisionReason?: string;
  intentRevision?: number;
  offerSnapshotId?: string;
  spendReservationId?: string;
}

interface SignalEventRow {
  id: string;
  signal_id: string;
}

interface IncidentRow {
  id: string;
  listing_id: string;
  semantic_key: string;
  status: string;
  occurrence_count: number;
  last_observed_at: string;
}

function incidentRecord(row: IncidentRow): IncidentRecord {
  return {
    id: row.id,
    listingId: row.listing_id,
    semanticKey: row.semantic_key,
    status: row.status,
    occurrenceCount: Number(row.occurrence_count),
    lastObservedAt: row.last_observed_at
  };
}

export class SignalRepository {
  private readonly auditEvents: AuditRepository;
  private readonly offerIdentity: OfferIdentityRepository;
  private readonly purchasePolicies: PurchasePolicyRepository;
  private readonly spendLedger: SpendLedgerRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.auditEvents = new AuditRepository(db);
    this.offerIdentity = new OfferIdentityRepository(db);
    this.purchasePolicies = new PurchasePolicyRepository(db);
    this.spendLedger = new SpendLedgerRepository(db);
  }

  private addLaneQualified(retailerId: string): boolean {
    const adapterVersion = {
      target: TARGET_ADD_ADAPTER_VERSION,
      walmart: WALMART_ADD_ADAPTER_VERSION,
      amazon: AMAZON_ADD_ADAPTER_VERSION,
      bestbuy: BESTBUY_ADD_ADAPTER_VERSION
    }[retailerId];
    if (!adapterVersion) return false;
    const row = this.db.get<{ adapterVersion: string; highestAction: string; status: string }>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction, status
       FROM retailer_adapter_qualifications
       WHERE tenant_id = ? AND user_id = ? AND retailer_id = ?`,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      retailerId
    );
    return row?.status === "qualified"
      && row.adapterVersion === adapterVersion
      && row.highestAction === "add_to_cart";
  }

  sourceConnection(id: string): SourceConnectionContext | null {
    const row = this.db.get<{
      id: string;
      source: string;
      trust_level: string;
      auto_create_missions: number;
    }>(
      `SELECT id, source, trust_level, auto_create_missions
       FROM source_connections WHERE id = ? AND user_id = ?`,
      id,
      currentRequestScope().userId
    );
    return row ? {
      id: row.id,
      source: row.source,
      trustLevel: row.trust_level,
      autoCreateMissions: row.auto_create_missions === 1
    } : null;
  }

  transportDuplicate(signal: NormalizedSignal): SignalEventRow | null {
    return this.db.get<SignalEventRow>(
      `SELECT id, signal_id FROM signal_events
       WHERE source_connection_id = ? AND (external_event_id = ? OR signal_id = ? OR transport_hash = ?)`,
      signal.sourceConnectionId,
      signal.externalEventId,
      signal.signalId,
      signal.transportHash
    ) ?? null;
  }

  insertEvent(signal: NormalizedSignal, now = Date.now()): string {
    const connection = this.sourceConnection(signal.sourceConnectionId);
    if (!connection || connection.source !== signal.source) {
      throw new Error("The signal source does not match a configured source connection.");
    }
    const eventId = newId("signal_event");
    const timestamp = nowIso(now);
    this.db.run(
      `INSERT INTO signal_events(
         id, tenant_id, user_id, source_connection_id, signal_id,
         external_event_id, transport_hash, schema_version, source, event_type,
         test, observed_at, received_at, identity_json, offer_json,
         evidence_json, parser_version, resolution_status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unresolved', ?)`,
      eventId,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      signal.sourceConnectionId,
      signal.signalId,
      signal.externalEventId,
      signal.transportHash,
      signal.schemaVersion,
      signal.source,
      signal.eventType,
      signal.test ? 1 : 0,
      signal.observedAt,
      signal.receivedAt,
      JSON.stringify(signal.identity),
      JSON.stringify(signal.offer),
      JSON.stringify(signal.evidence),
      signal.parserVersion,
      timestamp
    );
    this.db.run(
      `UPDATE source_connections SET status = 'connected', last_event_at = ?, updated_at = ? WHERE id = ?`,
      signal.receivedAt,
      timestamp,
      signal.sourceConnectionId
    );
    return eventId;
  }

  recordResolution(
    eventId: string,
    status: "matched" | "unresolved" | "ambiguous",
    method: string,
    listing: ListingContext | null,
    reason: string,
    now = Date.now()
  ): void {
    this.db.run("UPDATE signal_events SET resolution_status = ? WHERE id = ?", status, eventId);
    this.db.run(
      `INSERT INTO resolution_decisions(
         id, event_id, status, method, variant_id, listing_id,
         reason, resolver_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'resolver-v1', ?)`,
      newId("resolution"),
      eventId,
      status,
      method,
      listing?.variantId ?? null,
      listing?.id ?? null,
      reason,
      nowIso(now)
    );
  }

  recordOccurrence(eventId: string, signal: NormalizedSignal, incidentId: string | null, now = Date.now()): void {
    this.db.run(
      `INSERT INTO signal_occurrences(
         id, event_id, incident_id, source_connection_id,
         observed_at, received_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId("occurrence"),
      eventId,
      incidentId,
      signal.sourceConnectionId,
      signal.observedAt,
      signal.receivedAt,
      nowIso(now)
    );
  }

  semanticKey(signal: NormalizedSignal, listing: ListingContext): string {
    return stableHash(
      listing.id,
      signal.eventType,
      signal.offer.unitPriceCents,
      signal.offer.currency,
      signal.offer.sellerType,
      signal.offer.sellerName.toLocaleLowerCase("en-US"),
      signal.offer.offerFingerprint
    );
  }

  findOpenIncident(semanticKey: string, cutoffIso: string): IncidentRecord | null {
    const scope = currentRequestScope();
    const row = this.db.get<IncidentRow>(
      `SELECT id, listing_id, semantic_key, status, occurrence_count, last_observed_at
       FROM signal_incidents
       WHERE tenant_id = ? AND user_id = ?
         AND semantic_key = ? AND status = 'open' AND last_observed_at >= ?
       ORDER BY last_observed_at DESC LIMIT 1`,
      scope.tenantId,
      scope.userId,
      semanticKey,
      cutoffIso
    );
    return row ? incidentRecord(row) : null;
  }

  createIncident(signal: NormalizedSignal, listing: ListingContext, semanticKey: string, now = Date.now()): IncidentRecord {
    const id = newId("incident");
    const timestamp = nowIso(now);
    const scope = currentRequestScope();
    this.db.run(
      `INSERT INTO signal_incidents(
         id, tenant_id, user_id, listing_id, event_type, semantic_key, status, unit_price_cents,
         currency, seller_name, seller_type, offer_fingerprint,
         first_observed_at, last_observed_at, occurrence_count,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      scope.tenantId,
      scope.userId,
      listing.id,
      signal.eventType,
      semanticKey,
      signal.offer.unitPriceCents,
      signal.offer.currency,
      signal.offer.sellerName,
      signal.offer.sellerType,
      signal.offer.offerFingerprint,
      signal.observedAt,
      signal.observedAt,
      timestamp,
      timestamp
    );
    return {
      id,
      listingId: listing.id,
      semanticKey,
      status: "open",
      occurrenceCount: 1,
      lastObservedAt: signal.observedAt
    };
  }

  corroborateIncident(incident: IncidentRecord, signal: NormalizedSignal, now = Date.now()): IncidentRecord {
    const scope = currentRequestScope();
    this.db.run(
      `UPDATE signal_incidents
       SET occurrence_count = occurrence_count + 1,
           last_observed_at = CASE WHEN last_observed_at < ? THEN ? ELSE last_observed_at END,
           updated_at = ?
       WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'open'`,
      signal.observedAt,
      signal.observedAt,
      nowIso(now),
      incident.id,
      scope.tenantId,
      scope.userId
    );
    const row = this.db.get<IncidentRow>(
      `SELECT id, listing_id, semantic_key, status, occurrence_count, last_observed_at
       FROM signal_incidents WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      incident.id,
      scope.tenantId,
      scope.userId
    );
    if (!row) throw new Error("The signal incident no longer exists.");
    return incidentRecord(row);
  }

  recordOfferObservation(signal: NormalizedSignal, listing: ListingContext, now = Date.now()): void {
    this.db.run(
      `INSERT INTO offer_observations(
         id, listing_id, source_connection_id, availability, unit_price_cents,
         currency, seller_name, seller_type, order_limit, offer_fingerprint,
         observed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("offer_observation"),
      listing.id,
      signal.sourceConnectionId,
      signal.offer.availability,
      signal.offer.unitPriceCents,
      signal.offer.currency,
      signal.offer.sellerName,
      signal.offer.sellerType,
      signal.offer.orderLimit,
      signal.offer.offerFingerprint,
      signal.observedAt,
      nowIso(now)
    );
  }

  recordMissionDecision(
    eventId: string,
    incidentId: string | null,
    missionId: string | null,
    evaluation: StrategyEvaluation | null,
    outcome: string,
    reason: string,
    now = Date.now()
  ): void {
    this.db.run(
      `INSERT INTO mission_decisions(
         id, event_id, incident_id, mission_id, strategy_id, strategy_revision,
         decision_source, outcome, reason, effective_action, effective_quantity,
         effective_unit_cap_cents, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("mission_decision"),
      eventId,
      incidentId,
      missionId,
      evaluation?.strategy?.id ?? null,
      evaluation?.strategy?.revision ?? null,
      evaluation?.decisionSource ?? "strategy",
      outcome,
      reason,
      evaluation?.effectiveAction ?? "notify",
      evaluation?.effectiveQuantity ?? 1,
      evaluation?.effectiveUnitCapCents ?? null,
      nowIso(now)
    );
  }

  jobForIncident(incidentId: string): JobRecord | null {
    const row = this.db.get<{
      id: string;
      incident_id: string;
      mission_id: string;
      state: JobState;
      action: string;
      idempotency_key: string;
    }>(
      `SELECT id, incident_id, mission_id, state, action, idempotency_key
       FROM action_jobs WHERE incident_id = ? AND user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      incidentId,
      currentRequestScope().userId
    );
    return row ? {
      id: row.id,
      incidentId: row.incident_id,
      missionId: row.mission_id,
      state: row.state,
      action: row.action,
      idempotencyKey: row.idempotency_key,
      created: false
    } : null;
  }

  activePurchaseJobForMission(missionId: string, now = Date.now()): JobRecord | null {
    const row = this.db.get<{
      id: string;
      incident_id: string;
      mission_id: string;
      state: JobState;
      action: string;
      idempotency_key: string;
    }>(
      `SELECT id, incident_id, mission_id, state, action, idempotency_key
       FROM action_jobs
       WHERE mission_id = ? AND user_id = ? AND action <> 'notify'
         AND state NOT IN ('confirmed', 'expired', 'cancelled', 'offer_rejected', 'notify_only')
         AND (state IN ('manual_review', 'submission_uncertain') OR expires_at > ?)
       ORDER BY created_at, id LIMIT 1`,
      cleanText(missionId, 120),
      currentRequestScope().userId,
      nowIso(now)
    );
    return row ? {
      id: row.id,
      incidentId: row.incident_id,
      missionId: row.mission_id,
      state: row.state,
      action: row.action,
      idempotencyKey: row.idempotency_key,
      created: false
    } : null;
  }

  createActionJob(
    signal: NormalizedSignal,
    listing: ListingContext,
    mission: MissionContext,
    incident: IncidentRecord,
    evaluation: StrategyEvaluation,
    settings: AppSettings,
    attribution: AttributionPlan,
    now = Date.now()
  ): JobRecord {
    const existing = this.jobForIncident(incident.id);
    if (existing) return existing;
    const unitCap = evaluation.effectiveUnitCapCents;
    const allowance = Number(settings.storeAllowancesCents[listing.retailerId] ?? 0);
    const subtotal = unitCap === null ? null : unitCap * evaluation.effectiveQuantity;
    const maxOrderTotal = subtotal === null
      ? null
      : Math.ceil(subtotal * (10_000 + settings.taxBps) / 10_000) + Math.max(0, allowance);
    const expiresAtMs = Math.min(
      new Date(signal.observedAt).getTime() + evaluation.maxSignalAgeSeconds * 1_000,
      now + evaluation.maxSignalAgeSeconds * 1_000
    );
    const expiresAt = nowIso(expiresAtMs);
    const policy = this.purchasePolicies.ensureCurrent(mission.id, now);
    let effectiveAction = evaluation.effectiveAction;
    let decisionReasonCode = "intent_policy_verified";
    let decisionReason = evaluation.reason;
    let policyBlocked = false;
    if (settings.executionMode === "live" && effectiveAction === "add_to_cart" && !this.addLaneQualified(listing.retailerId)) {
      effectiveAction = "notify";
      policyBlocked = true;
      decisionReasonCode = "guarded_add_lane_not_qualified";
      decisionReason = "This exact offer matched the plan, but the retailer's add-only lane is not independently qualified. The match became a notification before any spend was reserved.";
    } else if (settings.executionMode === "live" && effectiveAction === "add_to_cart" && evaluation.effectiveQuantity !== 1) {
      effectiveAction = "notify";
      policyBlocked = true;
      decisionReasonCode = "guarded_add_quantity_not_supported";
      decisionReason = "Guarded cart runners add exactly one item per verified opportunity. This multi-unit strategy match was converted to a notification before any spend was reserved.";
    }
    if (effectiveAction !== "notify") {
      const policyDecision = this.purchasePolicies.evaluateAction(
        signal,
        listing,
        mission,
        evaluation,
        maxOrderTotal,
        now
      );
      if (!policyDecision.allowed) {
        effectiveAction = "notify";
        policyBlocked = true;
        decisionReasonCode = policyDecision.reasonCode;
        decisionReason = policyDecision.message;
      }
    }
    let packagedMutationLane = effectiveAction === "add_to_cart";
    let state: JobState = effectiveAction === "notify"
      ? "notify_only"
      : !packagedMutationLane || settings.executionMode === "shadow" ? "shadow_ready" : "awaiting_executor";
    if (state === "awaiting_executor" && maxOrderTotal !== null) {
      this.spendLedger.releaseExpired(now);
      const reservationDecision = this.spendLedger.evaluateReservation(
        mission.id,
        policy,
        effectiveAction as "add_to_cart" | "prepare_checkout" | "submit_order",
        evaluation.effectiveQuantity,
        maxOrderTotal,
        now
      );
      if (!reservationDecision.allowed) {
        effectiveAction = "notify";
        packagedMutationLane = false;
        state = "notify_only";
        policyBlocked = true;
        decisionReasonCode = reservationDecision.reasonCode;
        decisionReason = reservationDecision.message;
      }
    }
    const idempotencyKey = stableHash(
      currentRequestScope().userId,
      mission.id,
      policy.id,
      incident.id,
      evaluation.strategy?.id ?? "purchase_intent",
      evaluation.strategy?.revision ?? policy.revision,
      effectiveAction
    );
    const jobId = newId("action_job");
    const captured = this.offerIdentity.capture(
      signal,
      listing,
      mission.id,
      policy,
      incident.id,
      evaluation.effectiveQuantity,
      maxOrderTotal,
      expiresAt,
      now
    );
    const timestamp = nowIso(now);
    this.db.run(
      `INSERT OR IGNORE INTO action_jobs(
         id, tenant_id, user_id, mission_id, mission_target_id, incident_id,
         strategy_id, strategy_revision, decision_source, state, action, quantity,
         max_unit_price_cents, max_order_total_cents, currency, seller_policy,
         fulfillment, expected_seller, listing_id, canonical_url, attribution_url,
         attribution_provider, attribution_metadata_json, affiliate_mode,
         offer_fingerprint, idempotency_key,
         capability_nonce_hash, expires_at, created_at, updated_at,
         intent_revision_id, exact_offer_key_id, offer_snapshot_id
       ) VALUES (
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?,
         ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?
       )`,
      jobId,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      mission.id,
      mission.targetId,
      incident.id,
      evaluation.strategy?.id ?? null,
      evaluation.strategy?.revision ?? null,
      evaluation.decisionSource,
      state,
      effectiveAction,
      evaluation.effectiveQuantity,
      unitCap,
      maxOrderTotal,
      listing.currency,
      evaluation.sellerPolicy,
      evaluation.fulfillment,
      signal.offer.sellerName,
      listing.id,
      listing.canonicalUrl,
      attribution.routeUrl,
      attribution.provider,
      JSON.stringify(attribution.metadata),
      settings.affiliateMode,
      signal.offer.offerFingerprint,
      idempotencyKey,
      stableHash(newId("capability_nonce")),
      expiresAt,
      timestamp,
      timestamp,
      policy.id,
      captured.exactOffer.id,
      captured.snapshot.id
    );
    const saved = this.db.get<{ id: string; state: JobState; action: string; spendReservationId: string | null }>(
      "SELECT id, state, action, spend_reservation_id AS spendReservationId FROM action_jobs WHERE idempotency_key = ?",
      idempotencyKey
    );
    if (!saved) throw new Error("The action job could not be saved.");
    const created = saved.id === jobId;
    if (created) {
      if (state === "awaiting_executor" && effectiveAction !== "notify" && maxOrderTotal !== null) {
        const reservation = this.spendLedger.reserve({
          missionId: mission.id,
          policy,
          exactOfferKeyId: captured.exactOffer.id,
          offerSnapshotId: captured.snapshot.id,
          actionJobId: jobId,
          idempotencyKey: stableHash("spend-reservation-v1", idempotencyKey),
          action: effectiveAction,
          quantity: evaluation.effectiveQuantity,
          amountCents: maxOrderTotal,
          currency: listing.currency,
          expiresAt
        }, now);
        saved.spendReservationId = reservation.id;
      }
      this.db.run(
        `INSERT INTO action_events(id, job_id, state, reason_code, message, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?)`,
        newId("action_event"),
        jobId,
        state,
        policyBlocked
          ? decisionReasonCode
          : evaluation.decisionSource === "purchase_intent" ? "purchase_intent_qualified" : "strategy_qualified",
        state === "shadow_ready"
          ? packagedMutationLane
            ? `${evaluation.decisionSource === "purchase_intent" ? "Purchase plan" : "Strategy"} qualified; Yoink is in shadow mode and no retailer mutation is available.`
            : `${evaluation.decisionSource === "purchase_intent" ? "Purchase plan" : "Strategy"} qualified, but this mutation lane has no packaged, independently qualified runner and remains rehearsal-only.`
          : policyBlocked ? decisionReason : evaluation.reason,
        timestamp
      );
      this.audit(
        signal.signalId,
        "action_job_created",
        state,
        state === "shadow_ready"
          ? packagedMutationLane ? "Qualified shadow action job created." : "A closed-lane rehearsal record was created."
          : "Action job created.",
        { jobId, incidentId: incident.id, listingId: listing.id, action: effectiveAction, intentRevision: policy.revision, policyBlocked },
        now
      );
      if (effectiveAction === "notify") {
        new NotificationRepository(this.db).ensureForJob(jobId, now);
      }
      new AttributionRepository(this.db).recordReceipt(jobId, attribution, listing.canonicalUrl, now);
    }
    return {
      id: saved.id,
      incidentId: incident.id,
      missionId: mission.id,
      state: saved.state,
      action: saved.action,
      idempotencyKey,
      created,
      policyBlocked,
      decisionReasonCode,
      decisionReason,
      intentRevision: policy.revision,
      offerSnapshotId: captured.snapshot.id,
      spendReservationId: saved.spendReservationId ?? ""
    };
  }

  closeIncident(incidentId: string, reason: string, now = Date.now()): void {
    this.updateIncidentForCurrentScope(incidentId, "closed", reason, now);
  }

  private updateIncidentForCurrentScope(
    incidentId: string,
    status: "closed" | "locked",
    reason: string,
    now: number
  ): void {
    const scope = currentRequestScope();
    this.db.run(
      `UPDATE signal_incidents
       SET status = ?, closed_reason = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM action_jobs other_job
           WHERE other_job.incident_id = signal_incidents.id
             AND (other_job.tenant_id <> ? OR other_job.user_id <> ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM signal_occurrences occurrence
           JOIN signal_events event ON event.id = occurrence.event_id
           WHERE occurrence.incident_id = signal_incidents.id
             AND (event.tenant_id <> ? OR event.user_id <> ?)
         )`,
      status,
      reason,
      nowIso(now),
      incidentId,
      scope.tenantId,
      scope.userId,
      scope.tenantId,
      scope.userId,
      scope.tenantId,
      scope.userId
    );
  }

  transitionJob(
    jobId: string,
    nextState: JobState,
    reasonCode: string,
    message: string,
    evidence: Record<string, unknown> = {},
    now = Date.now(),
    manualResolution = false
  ): Record<string, unknown> {
    return this.db.transaction(() => {
      const job = this.db.get<{
        id: string;
        state: JobState;
        incident_id: string;
        mission_id: string;
        action: string;
        quantity: number;
      }>(
        "SELECT id, state, incident_id, mission_id, action, quantity FROM action_jobs WHERE id = ? AND user_id = ?",
        jobId,
        currentRequestScope().userId
      );
      if (!job) throw new Error("The action job does not exist.");
      assertJobTransition(job.state, nextState);
      if (nextState === "cancelled" && jobMayHaveMutated(job.state) && !manualResolution) {
        throw new Error("A job that may have mutated a cart requires manual review instead of ordinary cancellation.");
      }
      const timestamp = nowIso(now);
      this.db.run("UPDATE action_jobs SET state = ?, updated_at = ? WHERE id = ?", nextState, timestamp, job.id);
      this.db.run(
        `INSERT INTO action_events(
           id, job_id, state, reason_code, message, evidence_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId("action_event"),
        job.id,
        nextState,
        String(reasonCode || "state_changed").slice(0, 80),
        String(message || "Action job state changed.").replace(/\s+/g, " ").trim().slice(0, 500),
        JSON.stringify(sanitizeDiagnosticData(evidence)),
        timestamp
      );
      if (["offer_rejected", "expired", "cancelled"].includes(nextState)) {
        this.closeIncident(job.incident_id, nextState, now);
        this.spendLedger.releaseForJob(job.id, nextState, now);
      } else if (nextState === "submission_uncertain" || nextState === "manual_review") {
        this.updateIncidentForCurrentScope(job.incident_id, "locked", nextState, now);
      } else if (nextState === "confirmed") {
        this.closeIncident(job.incident_id, "confirmed", now);
        if (job.action === "submit_order") {
          const verifiedTotal = Number(evidence.allInTotalCents ?? evidence.orderTotalCents);
          this.spendLedger.commitForJob(job.id, verifiedTotal, now);
          this.db.run(
            `UPDATE missions
             SET fulfilled_quantity = MIN(target_quantity, fulfilled_quantity + ?),
                 status = CASE WHEN fulfilled_quantity + ? >= target_quantity THEN 'satisfied' ELSE status END,
                 updated_at = ?
             WHERE id = ?`,
            job.quantity,
            job.quantity,
            timestamp,
            job.mission_id
          );
        } else {
          this.spendLedger.releaseForJob(job.id, `${job.action}_confirmed_without_order`, now);
        }
      }
      this.audit(job.id, "action_job_transition", nextState, message, { previousState: job.state, ...sanitizeDiagnosticData(evidence) as Record<string, unknown> }, now);
      return { id: job.id, previousState: job.state, state: nextState, updatedAt: timestamp };
    });
  }

  resolveReviewJob(
    jobId: string,
    outcome: "confirmed" | "cancelled",
    confirmation: string,
    note = "",
    now = Date.now()
  ): Record<string, unknown> {
    if (confirmation !== "I_REVIEWED_BROWSER_STATE") {
      throw new Error("Manual action resolution requires explicit browser-state confirmation.");
    }
    const job = this.db.get<{ state: JobState }>(
      "SELECT state FROM action_jobs WHERE id = ? AND user_id = ?",
      cleanText(jobId, 120),
      currentRequestScope().userId
    );
    if (!job || !["manual_review", "submission_uncertain"].includes(job.state)) {
      throw new Error("Only an action job locked for manual review can be resolved this way.");
    }
    const message = outcome === "confirmed"
      ? "The user reviewed the retailer session and confirmed the intended result."
      : "The user reviewed the retailer session and confirmed that the intended purchase did not complete.";
    return this.transitionJob(
      cleanText(jobId, 120),
      outcome,
      outcome === "confirmed" ? "user_verified_success" : "user_verified_no_purchase",
      message,
      { manualUserReview: true, note: cleanText(note, 300) },
      now,
      true
    );
  }

  audit(
    correlationId: string,
    eventType: string,
    reasonCode: string,
    message: string,
    data: Record<string, unknown> = {},
    now = Date.now()
  ): void {
    this.auditEvents.record({
      correlationId,
      aggregateType: eventType.startsWith("action_") ? "action_job" : eventType.startsWith("signal_") ? "signal" : "commerce",
      eventType,
      reasonCode,
      message,
      data
    }, now);
  }

  listSignals(limit = 100, offset = 0, search = ""): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return this.db.all(
      `SELECT se.signal_id AS signalId, se.source, se.event_type AS eventType,
              se.test, se.observed_at AS observedAt,
              se.resolution_status AS resolutionStatus,
              rd.method AS resolutionMethod, rd.reason AS resolutionReason,
              md.outcome AS missionDecision, md.reason AS missionReason,
              md.effective_action AS effectiveAction,
              md.decision_source AS decisionSource,
              si.id AS incidentId, si.occurrence_count AS occurrenceCount,
              COALESCE(v.title, NULLIF(json_extract(se.identity_json, '$.title'), ''),
                NULLIF(json_extract(se.evidence_json, '$.headline'), '')) AS title,
              COALESCE(l.retailer_id, NULLIF(json_extract(se.identity_json, '$.retailerId'), '')) AS retailerId,
              COALESCE(l.retailer_sku, NULLIF(json_extract(se.identity_json, '$.retailerSku'), '')) AS retailerSku,
              COALESCE(si.unit_price_cents, json_extract(se.offer_json, '$.unitPriceCents')) AS unitPriceCents,
              COALESCE(si.currency, json_extract(se.offer_json, '$.currency')) AS currency,
              aj.id AS actionJobId, aj.state AS actionJobState
       FROM signal_events se
       LEFT JOIN resolution_decisions rd ON rd.event_id = se.id
       LEFT JOIN mission_decisions md ON md.event_id = se.id
       LEFT JOIN signal_occurrences so ON so.event_id = se.id
       LEFT JOIN signal_incidents si ON si.id = so.incident_id
       LEFT JOIN listings l ON l.id = si.listing_id
       LEFT JOIN variants v ON v.id = l.variant_id
       LEFT JOIN action_jobs aj ON aj.incident_id = si.id AND aj.user_id = se.user_id
       WHERE se.user_id = ? AND (? = ''
         OR se.signal_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR se.source LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR se.event_type LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR se.resolution_status LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(md.outcome, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(v.title, json_extract(se.identity_json, '$.title'), '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(l.retailer_id, json_extract(se.identity_json, '$.retailerId'), '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(l.retailer_sku, json_extract(se.identity_json, '$.retailerSku'), '') LIKE ? ESCAPE '\\' COLLATE NOCASE)
       ORDER BY se.received_at DESC LIMIT ? OFFSET ?`,
      currentRequestScope().userId,
      query,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      safeLimit,
      safeOffset
    );
  }

  signalCount(search = ""): number {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM signal_events se
       LEFT JOIN resolution_decisions rd ON rd.event_id = se.id
       LEFT JOIN mission_decisions md ON md.event_id = se.id
       LEFT JOIN signal_occurrences so ON so.event_id = se.id
       LEFT JOIN signal_incidents si ON si.id = so.incident_id
       LEFT JOIN listings l ON l.id = si.listing_id
       LEFT JOIN variants v ON v.id = l.variant_id
       WHERE se.user_id = ? AND (? = ''
         OR se.signal_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR se.source LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR se.event_type LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR se.resolution_status LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(md.outcome, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(v.title, json_extract(se.identity_json, '$.title'), '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(l.retailer_id, json_extract(se.identity_json, '$.retailerId'), '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR COALESCE(l.retailer_sku, json_extract(se.identity_json, '$.retailerSku'), '') LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      currentRequestScope().userId,
      query,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern
    )?.count ?? 0);
  }

  listJobs(limit = 100, offset = 0, search = ""): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return this.db.all(
      `SELECT aj.id, aj.state, aj.action, aj.quantity,
              aj.decision_source AS decisionSource,
              aj.max_unit_price_cents AS maxUnitPriceCents,
              aj.max_order_total_cents AS maxOrderTotalCents,
              aj.currency, aj.seller_policy AS sellerPolicy,
              aj.expected_seller AS expectedSeller,
              aj.canonical_url AS canonicalUrl, aj.attribution_url AS attributionUrl,
              aj.attribution_provider AS attributionProvider,
              ar.outcome AS attributionOutcome, aj.expires_at AS expiresAt,
              ir.revision AS intentRevision,
              aj.offer_snapshot_id AS offerSnapshotId,
              sr.id AS spendReservationId, sr.status AS spendReservationStatus,
              sr.reserved_amount_cents AS reservedAmountCents,
              aj.created_at AS createdAt, v.title,
              l.retailer_id AS retailerId, l.retailer_sku AS retailerSku,
              (SELECT ae.reason_code FROM action_events ae
               WHERE ae.job_id = aj.id ORDER BY ae.created_at DESC, ae.id DESC LIMIT 1) AS decisionReasonCode,
              (SELECT ae.message FROM action_events ae
               WHERE ae.job_id = aj.id ORDER BY ae.created_at DESC, ae.id DESC LIMIT 1) AS decisionReason
       FROM action_jobs aj
       JOIN listings l ON l.id = aj.listing_id
       JOIN variants v ON v.id = l.variant_id
       LEFT JOIN attribution_receipts ar ON ar.job_id = aj.id
       LEFT JOIN mission_intent_revisions ir ON ir.id = aj.intent_revision_id
       LEFT JOIN spend_reservations sr ON sr.id = aj.spend_reservation_id
       WHERE aj.user_id = ? AND (? = ''
         OR aj.id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR aj.state LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR aj.action LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR EXISTS (SELECT 1 FROM action_events ae WHERE ae.job_id = aj.id
           AND (ae.reason_code LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR ae.message LIKE ? ESCAPE '\\' COLLATE NOCASE)))
       ORDER BY aj.created_at DESC LIMIT ? OFFSET ?`,
      currentRequestScope().userId,
      query,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      safeLimit,
      safeOffset
    );
  }

  jobCount(search = ""): number {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM action_jobs aj
       JOIN listings l ON l.id = aj.listing_id
       JOIN variants v ON v.id = l.variant_id
       WHERE aj.user_id = ? AND (? = ''
         OR aj.id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR aj.state LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR aj.action LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR EXISTS (SELECT 1 FROM action_events ae WHERE ae.job_id = aj.id
           AND (ae.reason_code LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR ae.message LIKE ? ESCAPE '\\' COLLATE NOCASE)))`,
      currentRequestScope().userId,
      query,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern
    )?.count ?? 0);
  }

  counts(): Record<string, number> {
    return this.db.get<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM signal_events) AS signals,
         (SELECT COUNT(*) FROM signal_incidents WHERE status = 'open') AS openIncidents,
         (SELECT COUNT(*) FROM action_jobs) AS actionJobs,
         (SELECT COUNT(*) FROM action_jobs WHERE state = 'shadow_ready') AS shadowReady,
         (SELECT COUNT(*) FROM action_jobs WHERE state = 'manual_review' OR state = 'submission_uncertain') AS needsAttention`
    ) ?? { signals: 0, openIncidents: 0, actionJobs: 0, shadowReady: 0, needsAttention: 0 };
  }

  duplicateResult(signal: NormalizedSignal, existing: SignalEventRow): SignalProcessingResult {
    return {
      accepted: true,
      signalId: signal.signalId,
      duplicate: true,
      corroborated: false,
      resolution: "unresolved",
      resolutionMethod: "transport_duplicate",
      missionId: "",
      missionCreated: false,
      incidentId: "",
      strategyId: "",
      decision: "duplicate_signal",
      reason: `The source event was already accepted as ${existing.signal_id}.`,
      actionJobId: "",
      actionJobState: ""
    };
  }
}
