import type {
  JobState,
  SignalEventInput,
  SignalProcessingResult,
  StrategyEvaluation
} from "../../contracts/src/index.js";
import { CatalogRepository, type ResolutionResult } from "../../database/src/catalog-repository.js";
import { AttributionRepository } from "../../database/src/attribution-repository.js";
import { ControlRepository } from "../../database/src/control-repository.js";
import { YoinkDatabase } from "../../database/src/database.js";
import { SignalRepository } from "../../database/src/signal-repository.js";
import { normalizeSignal } from "../../domain/src/normalize.js";
import { evaluateSignalPolicySnapshot } from "../../domain/src/signal-policy-evaluation.js";

function emptyResult(signalId: string, resolution: ResolutionResult): SignalProcessingResult {
  return {
    accepted: true,
    signalId,
    duplicate: false,
    corroborated: false,
    resolution: resolution.status,
    resolutionMethod: resolution.method,
    missionId: "",
    missionCreated: false,
    incidentId: "",
    strategyId: "",
    decision: "recorded",
    reason: resolution.reason,
    actionJobId: "",
    actionJobState: ""
  };
}

export class SignalEngine {
  readonly catalog: CatalogRepository;
  readonly attribution: AttributionRepository;
  readonly control: ControlRepository;
  readonly signals: SignalRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.catalog = new CatalogRepository(db);
    this.attribution = new AttributionRepository(db);
    this.control = new ControlRepository(db);
    this.signals = new SignalRepository(db);
  }

  process(input: SignalEventInput, now = Date.now()): SignalProcessingResult {
    const signal = normalizeSignal(input, now);
    const duplicate = this.signals.transportDuplicate(signal);
    if (duplicate) return this.signals.duplicateResult(signal, duplicate);

    return this.db.transaction(() => {
      const eventId = this.signals.insertEvent(signal, now);
      const sourceConnection = this.signals.sourceConnection(signal.sourceConnectionId);
      if (!sourceConnection) throw new Error("The source connection is unavailable.");

      let resolution = this.catalog.resolve(signal);
      if (resolution.status === "unresolved" && !signal.test) {
        const created = this.catalog.createListingFromExactSignal(signal);
        if (created) {
          resolution = {
            status: "matched",
            method: "exact_signal_identity",
            reason: "Created and matched a listing from trusted exact source and retailer identifiers.",
            listing: created.listing
          };
        }
      }
      this.signals.recordResolution(eventId, resolution.status, resolution.method, resolution.listing, resolution.reason, now);
      const result = emptyResult(signal.signalId, resolution);

      if (!resolution.listing) {
        this.signals.recordOccurrence(eventId, signal, null, now);
        const outcome = signal.test ? "test_signal" : resolution.status === "ambiguous" ? "ambiguous_identity" : "unresolved_identity";
        const reason = signal.test
          ? `Dry-run signal recorded. ${resolution.reason}`
          : resolution.reason;
        this.signals.recordMissionDecision(eventId, null, null, null, outcome, reason, now);
        this.signals.audit(signal.signalId, "signal_decided", outcome, reason, { resolutionMethod: resolution.method }, now);
        return { ...result, decision: outcome, reason };
      }

      const listing = resolution.listing;
      if (signal.test) {
        this.signals.recordOccurrence(eventId, signal, null, now);
        const reason = "Connectivity test received and resolved; test signals are always dry-run only.";
        this.signals.recordMissionDecision(eventId, null, null, null, "test_signal", reason, now);
        this.signals.audit(signal.signalId, "signal_decided", "test_signal", reason, { listingId: listing.id }, now);
        return { ...result, decision: "test_signal", reason };
      }

      const actionableEvent = ["in_stock", "restock", "preorder"].includes(signal.eventType);
      const actionableAvailability = ["in_stock", "preorder"].includes(signal.offer.availability);
      if (!actionableEvent || !actionableAvailability) {
        this.signals.recordOccurrence(eventId, signal, null, now);
        const reason = "The signal was recorded as source evidence, but its event or availability is not actionable.";
        this.signals.recordMissionDecision(eventId, null, null, null, "non_actionable_event", reason, now);
        this.signals.audit(signal.signalId, "signal_decided", "non_actionable_event", reason, {
          eventType: signal.eventType,
          availability: signal.offer.availability,
          listingId: listing.id
        }, now);
        return { ...result, decision: "non_actionable_event", reason };
      }

      this.signals.recordOfferObservation(signal, listing, now);
      // A user may have linked a cart profile before the first trustworthy
      // price arrived. Reconcile that exact plan after the durable offer write
      // and before evaluation so this same fresh signal can use the reviewed
      // authority instead of getting stranded as notification-only.
      this.control.reconcilePurchaseProfileForListing(listing.id, now);
      const settings = this.control.settings();
      const semanticKey = this.signals.semanticKey(signal, listing);
      const cutoff = new Date(new Date(signal.observedAt).getTime() - settings.dedupeWindowSeconds * 1_000).toISOString();
      const existingIncident = this.signals.findOpenIncident(semanticKey, cutoff);
      const incident = existingIncident
        ? this.signals.corroborateIncident(existingIncident, signal, now)
        : this.signals.createIncident(signal, listing, semanticKey, now);
      this.signals.recordOccurrence(eventId, signal, incident.id, now);
      result.incidentId = incident.id;

      const existingJob = this.signals.jobForIncident(incident.id);
      if (existingIncident && existingJob) {
        const reason = "This signal corroborates an active opportunity; the existing action job remains authoritative.";
        this.signals.recordMissionDecision(eventId, incident.id, existingJob.missionId, null, "corroborated", reason, now);
        this.signals.audit(signal.signalId, "signal_decided", "corroborated", reason, { incidentId: incident.id, actionJobId: existingJob.id }, now);
        return {
          ...result,
          corroborated: true,
          missionId: existingJob.missionId,
          decision: "corroborated",
          reason,
          actionJobId: existingJob.id,
          actionJobState: existingJob.state
        };
      }

      let mission = this.control.findMissionForListing(listing.id);
      let missionCreated = false;
      if (!mission && sourceConnection.autoCreateMissions && sourceConnection.trustLevel === "trusted_exact") {
        const ensured = this.control.ensureMission(listing.variantId, listing.id, `signal:${signal.source}`, now);
        mission = ensured.mission;
        missionCreated = ensured.created;
      }
      if (!mission) {
        const reason = "The exact listing was recorded, but this source is not allowed to create a mission and no mission target exists.";
        this.signals.recordMissionDecision(eventId, incident.id, null, null, "no_mission", reason, now);
        this.signals.audit(signal.signalId, "signal_decided", "no_mission", reason, { incidentId: incident.id, listingId: listing.id }, now);
        return { ...result, incidentId: incident.id, decision: "no_mission", reason };
      }

      const evaluationMission = missionCreated ? { ...mission, targetQuantity: 5 } : mission;
      const intentPolicy = this.control.currentPurchaseIntentPolicy(mission.id, now);
      const evaluated = evaluateSignalPolicySnapshot(
        this.control.listStrategies(),
        intentPolicy,
        signal,
        listing,
        evaluationMission,
        sourceConnection.trustLevel,
        now
      );
      let evaluation = evaluated.evaluation;
      const directSourceRestricted = evaluated.sourceActionRestricted;
      if (missionCreated && evaluation.strategy) {
        this.control.setMissionTargetQuantity(mission.id, evaluation.effectiveQuantity, now);
        mission = { ...mission, targetQuantity: evaluation.effectiveQuantity };
      }

      result.missionId = mission.id;
      result.missionCreated = missionCreated;
      result.strategyId = evaluation.strategy?.id ?? "";

      if (["unmatched", "stale", "quantity_limited"].includes(evaluation.state)) {
        this.signals.recordMissionDecision(eventId, incident.id, mission.id, evaluation, evaluation.state, evaluation.reason, now);
        this.signals.audit(signal.signalId, "signal_decided", evaluation.state, evaluation.reason, { missionId: mission.id, incidentId: incident.id }, now);
        return { ...result, decision: evaluation.state, reason: evaluation.reason };
      }

      const purchaseRequested = evaluation.effectiveAction !== "notify";
      const missionClaim = purchaseRequested ? this.signals.activePurchaseJobForMission(mission.id, now) : null;
      if (missionClaim && missionClaim.incidentId !== incident.id) {
        const reason = "Another retailer listing already owns the active purchase claim for this mission. This signal remains recorded and can be reconsidered after a verified rejection, cancellation, or expiry.";
        this.signals.recordMissionDecision(eventId, incident.id, mission.id, evaluation, "sibling_store_claimed", reason, now);
        this.signals.audit(signal.signalId, "signal_decided", "sibling_store_claimed", reason, {
          missionId: mission.id,
          incidentId: incident.id,
          authoritativeJobId: missionClaim.id
        }, now);
        return {
          ...result,
          corroborated: true,
          decision: "sibling_store_claimed",
          reason,
          actionJobId: missionClaim.id,
          actionJobState: missionClaim.state
        };
      }

      let outcome = directSourceRestricted
        ? "untrusted_source"
        : evaluation.state === "needs_price" ? "needs_price" : "qualified";
      let reason = evaluation.reason;
      if (evaluation.effectiveAction !== "notify" && !listing.executionSupported) {
        evaluation = {
          ...evaluation,
          effectiveAction: "notify",
          reason: "The winning strategy matched, but this retailer is catalog-only until a qualified Chrome adapter exists."
        };
        outcome = "unsupported_retailer";
        reason = evaluation.reason;
      } else if (evaluation.effectiveAction !== "notify" && settings.actionsPaused) {
        outcome = "actions_paused";
        reason = `The winning strategy matched, but Actions is paused. ${settings.pauseReason}`;
        this.signals.recordMissionDecision(eventId, incident.id, mission.id, evaluation, outcome, reason, now);
        this.signals.audit(signal.signalId, "signal_decided", outcome, reason, { missionId: mission.id, incidentId: incident.id }, now);
        return { ...result, decision: outcome, reason };
      }

      const attribution = this.attribution.plan(listing, listing.title, settings.affiliateMode);
      if (attribution.blocked && evaluation.effectiveAction !== "notify") {
        evaluation = {
          ...evaluation,
          effectiveAction: "notify",
          reason: "The strategy matched, but the required affiliate route was unavailable; Chrome mutation was blocked and a notification was prepared instead."
        };
        outcome = "affiliate_route_unavailable";
        reason = evaluation.reason;
      }
      const allowDeferredLiveOfferVerification = sourceConnection.trustLevel === "trusted_exact"
        && evaluation.decisionSource === "purchase_intent"
        && evaluation.effectiveAction === "add_to_cart"
        && (signal.offer.unitPriceCents === null
          || signal.offer.sellerType === "unknown"
          || signal.offer.fulfillment === "unknown");
      const job = this.signals.createActionJob(
        signal,
        listing,
        mission,
        incident,
        evaluation,
        settings,
        attribution,
        now,
        { allowDeferredLiveOfferVerification }
      );
      if (job.policyBlocked) {
        evaluation = {
          ...evaluation,
          effectiveAction: "notify",
          reason: job.decisionReason || "The current purchase-intent or spend policy rejected the mutation."
        };
        outcome = job.decisionReasonCode || "purchase_policy_blocked";
        reason = evaluation.reason;
      }
      this.signals.recordMissionDecision(eventId, incident.id, mission.id, evaluation, outcome, reason, now);
      return {
        ...result,
        decision: outcome,
        reason,
        actionJobId: job.id,
        actionJobState: job.state as JobState
      };
    });
  }
}
