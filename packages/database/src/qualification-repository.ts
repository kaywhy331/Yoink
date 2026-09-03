import {
  AMAZON_ADD_ACTIVATION_CONFIRMATION,
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ACTIVATION_CONFIRMATION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  TARGET_ADD_ACTIVATION_CONFIRMATION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  WALMART_ADD_ACTIVATION_CONFIRMATION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  type AmazonAddActivationInput,
  type AmazonAddRehearsalInput,
  type BestBuyAddActivationInput,
  type BestBuyAddRehearsalInput,
  type TargetAddActivationInput,
  type TargetAddRehearsalInput,
  type WalmartAddActivationInput,
  type WalmartAddRehearsalInput
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import {
  ShadowObservationRepository,
  type AmazonQualificationReadiness,
  type BestBuyQualificationReadiness,
  type TargetQualificationReadiness,
  type WalmartQualificationReadiness
} from "./shadow-observation-repository.js";
import { SignalRepository } from "./signal-repository.js";
import { AuditRepository } from "./audit-repository.js";

const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_REHEARSAL_AGE_MS = 10 * 60_000;
const RETENTION_LIMIT = 1_000;
const REASON_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const EVIDENCE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const ACTIVE_DEVICE_WINDOW_MS = 5 * 60_000;
const QUALIFICATION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface StoredTargetAddTrial {
  id: string;
  deviceId: string;
  retailerId: "target";
  adapterVersion: typeof TARGET_ADD_ADAPTER_VERSION;
  observerVersion: typeof TARGET_OBSERVER_VERSION;
  contractVersion: 1;
  trialKind: "pre_click_rehearsal";
  shadowObservationId: string;
  retailerSku: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

export interface StoredWalmartAddTrial {
  id: string;
  deviceId: string;
  retailerId: "walmart";
  adapterVersion: typeof WALMART_ADD_ADAPTER_VERSION;
  observerVersion: typeof WALMART_OBSERVER_VERSION;
  contractVersion: 1;
  trialKind: "pre_click_rehearsal";
  shadowObservationId: string;
  retailerSku: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

export interface StoredAmazonAddTrial {
  id: string;
  deviceId: string;
  retailerId: "amazon";
  adapterVersion: typeof AMAZON_ADD_ADAPTER_VERSION;
  observerVersion: typeof AMAZON_OBSERVER_VERSION;
  contractVersion: 1;
  trialKind: "pre_click_rehearsal";
  shadowObservationId: string;
  retailerSku: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

export interface StoredBestBuyAddTrial {
  id: string;
  deviceId: string;
  retailerId: "bestbuy";
  adapterVersion: typeof BESTBUY_ADD_ADAPTER_VERSION;
  observerVersion: typeof BESTBUY_OBSERVER_VERSION;
  contractVersion: 1;
  trialKind: "pre_click_rehearsal";
  shadowObservationId: string;
  retailerSku: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

interface ShadowRow {
  id: string;
  deviceId: string;
  retailerSku: string;
  adapterVersion: string;
  contractVersion: number;
  observationState: string;
  sellerName: string;
  sellerType: string;
  fulfillment: string;
  purchaseRouteReady: number;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

interface TrialRow {
  id: string;
  deviceId: string;
  retailerId: "target" | "walmart" | "amazon" | "bestbuy";
  adapterVersion: string;
  observerVersion: string;
  contractVersion: 1;
  trialKind: "pre_click_rehearsal";
  shadowObservationId: string;
  retailerSku: string;
  outcome: "passed" | "rejected";
  reasonCode: string;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

type GuardedRetailerId = "target" | "walmart" | "amazon" | "bestbuy";

export interface AutomaticQualificationRenewal {
  retailerId: GuardedRetailerId;
  renewed: boolean;
  reasonCode: string;
  promotedJobs: number;
}

const GUARDED_RETAILER_VERSION: Record<GuardedRetailerId, string> = {
  target: TARGET_ADD_ADAPTER_VERSION,
  walmart: WALMART_ADD_ADAPTER_VERSION,
  amazon: AMAZON_ADD_ADAPTER_VERSION,
  bestbuy: BESTBUY_ADD_ADAPTER_VERSION
};

const GUARDED_RETAILER_CAPABILITY: Record<GuardedRetailerId, { enabled: string; version: string }> = {
  target: { enabled: "targetAddOnly", version: "targetAddAdapterVersion" },
  walmart: { enabled: "walmartAddOnly", version: "walmartAddAdapterVersion" },
  amazon: { enabled: "amazonAddOnly", version: "amazonAddAdapterVersion" },
  bestbuy: { enabled: "bestBuyAddOnly", version: "bestBuyAddAdapterVersion" }
};

export class QualificationRepository {
  private readonly auditEvents: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.auditEvents = new AuditRepository(db);
  }

  private addQualified(
    retailerId: "target" | "walmart" | "amazon" | "bestbuy",
    adapterVersion: string,
    now: number
  ): boolean {
    const row = this.db.get<{
      adapter_version: string;
      highest_action: string;
      status: string;
      expires_at: string;
    }>(
      `SELECT adapter_version, highest_action, status, expires_at
       FROM retailer_adapter_qualifications WHERE user_id = ? AND retailer_id = ?`,
      currentRequestScope().userId,
      retailerId
    );
    const expiresAt = new Date(row?.expires_at ?? "").getTime();
    return row?.status === "qualified"
      && row.adapter_version === adapterVersion
      && row.highest_action === "add_to_cart"
      && Number.isFinite(expiresAt)
      && expiresAt > now;
  }

  renewPreviouslyQualified(
    retailerId: GuardedRetailerId,
    deviceId: string,
    now = Date.now()
  ): AutomaticQualificationRenewal {
    const scope = currentRequestScope();
    const prior = this.db.get<{
      adapterVersion: string;
      highestAction: string;
      status: "qualified" | "suspended" | "retired";
    }>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction, status
       FROM retailer_adapter_qualifications
       WHERE tenant_id = ? AND user_id = ? AND retailer_id = ?`,
      scope.tenantId,
      scope.userId,
      retailerId
    );
    const skipped = (reasonCode: string): AutomaticQualificationRenewal => ({
      retailerId, renewed: false, reasonCode, promotedJobs: 0
    });
    if (!prior || prior.highestAction !== "add_to_cart") return skipped("prior_authorization_missing");
    if (prior.status === "suspended") return skipped("lane_suspended");
    if (prior.status === "retired") {
      const latestDecision = this.db.get<{ eventType: string }>(
        `SELECT event_type AS eventType FROM audit_events
         WHERE tenant_id = ? AND user_id = ? AND correlation_id = ?
           AND event_type IN ('retailer_adapter_qualified', 'retailer_lane_retired')
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        scope.tenantId,
        scope.userId,
        retailerId
      );
      if (latestDecision?.eventType === "retailer_lane_retired") {
        return skipped("lane_manually_retired");
      }
    }
    const cleanDeviceId = cleanText(deviceId, 120);
    const adapterVersion = GUARDED_RETAILER_VERSION[retailerId];
    const capability = GUARDED_RETAILER_CAPABILITY[retailerId];
    const device = this.db.get<{ capabilitiesJson: string; lastSeenAt: string }>(
      `SELECT capabilities_json AS capabilitiesJson, last_seen_at AS lastSeenAt
       FROM extension_devices
       WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'active'`,
      cleanDeviceId,
      scope.tenantId,
      scope.userId
    );
    let capabilities: Record<string, unknown> = {};
    try { capabilities = JSON.parse(device?.capabilitiesJson ?? "{}") as Record<string, unknown>; } catch { capabilities = {}; }
    if (!device
      || new Date(device.lastSeenAt).getTime() < now - ACTIVE_DEVICE_WINDOW_MS
      || capabilities[capability.enabled] !== true
      || capabilities[capability.version] !== adapterVersion) {
      return skipped("current_capable_device_missing");
    }
    const freshTrial = this.db.get<{ id: string }>(
      `SELECT id FROM retailer_adapter_trials
       WHERE tenant_id = ? AND user_id = ? AND device_id = ? AND retailer_id = ?
         AND adapter_version = ? AND outcome = 'passed' AND reason_code = 'verified'
         AND received_at >= ?
       ORDER BY received_at DESC, id DESC LIMIT 1`,
      scope.tenantId,
      scope.userId,
      cleanDeviceId,
      retailerId,
      adapterVersion,
      nowIso(now - MAX_REHEARSAL_AGE_MS)
    );
    if (!freshTrial) return skipped("fresh_rehearsal_missing");
    const shadowRepository = new ShadowObservationRepository(this.db);
    const readiness = retailerId === "target" ? shadowRepository.targetQualificationReadiness(now)
      : retailerId === "walmart" ? shadowRepository.walmartQualificationReadiness(now)
        : retailerId === "amazon" ? shadowRepository.amazonQualificationReadiness(now)
          : shadowRepository.bestBuyQualificationReadiness(now);
    if (!readiness.qualificationEvidenceReady
      || !EVIDENCE_HASH_PATTERN.test(readiness.qualificationEvidenceHash)) {
      return skipped("qualification_evidence_incomplete");
    }

    const promotedJobs = this.db.transaction(() => {
      const timestamp = nowIso(now);
      const expiresAt = nowIso(now + QUALIFICATION_TTL_MS);
      this.db.run(
        `UPDATE retailer_adapter_qualifications
         SET adapter_version = ?, highest_action = 'add_to_cart', status = 'qualified',
             evidence_hash = ?, qualified_at = ?, updated_at = ?, expires_at = ?
         WHERE tenant_id = ? AND user_id = ? AND retailer_id = ?`,
        adapterVersion,
        readiness.qualificationEvidenceHash,
        timestamp,
        timestamp,
        expiresAt,
        scope.tenantId,
        scope.userId,
        retailerId
      );
      this.db.run("UPDATE retailers SET execution_supported = 1, updated_at = ? WHERE id = ?", timestamp, retailerId);
      this.db.run("UPDATE listings SET execution_supported = 1, updated_at = ? WHERE retailer_id = ?", timestamp, retailerId);
      const control = this.db.get<{ executionMode: string; actionsPaused: number }>(
        `SELECT execution_mode AS executionMode, actions_paused AS actionsPaused
         FROM app_settings WHERE user_id = ?`,
        scope.userId
      );
      const promotable = control?.executionMode === "live" && control.actionsPaused === 0
        ? this.db.all<{ id: string }>(
          `SELECT aj.id FROM action_jobs aj JOIN listings l ON l.id = aj.listing_id
           WHERE aj.user_id = ? AND aj.state = 'shadow_ready' AND aj.expires_at > ?
             AND l.retailer_id = ? AND aj.action = 'add_to_cart' AND aj.quantity = 1
             AND aj.seller_policy = 'first_party_only' AND aj.fulfillment IN ('shipping', 'pickup')
           ORDER BY aj.created_at, aj.id`,
          scope.userId,
          timestamp,
          retailerId
        ) : [];
      const signals = new SignalRepository(this.db);
      for (const job of promotable) {
        signals.transitionJob(
          job.id,
          "awaiting_executor",
          "retailer_lane_automatically_requalified",
          "A fresh shadow job entered its previously authorized store lane after current checks passed.",
          { retailerId, adapterVersion },
          now
        );
      }
      this.auditEvents.record({
        correlationId: retailerId,
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_qualified",
        reasonCode: "automatic_requalification_after_verified_rehearsal",
        message: `${adapterVersion} renewed a previously authorized add-to-cart lane after fresh current checks passed.`,
        data: {
          retailerId,
          adapterVersion,
          previousAdapterVersion: prior.adapterVersion,
          previousStatus: prior.status,
          evidenceHash: readiness.qualificationEvidenceHash,
          promotedJobs: promotable.length,
          globalPausePreserved: control?.actionsPaused !== 0
        }
      }, now);
      return promotable.length;
    });
    return {
      retailerId,
      renewed: true,
      reasonCode: "automatic_requalification_after_verified_rehearsal",
      promotedJobs
    };
  }

  recordTargetAddRehearsal(
    deviceId: string,
    input: TargetAddRehearsalInput,
    now = Date.now()
  ): StoredTargetAddTrial {
    if (!input || typeof input !== "object") throw new Error("A Target add rehearsal receipt is required.");
    const cleanDeviceId = cleanText(deviceId, 120);
    const shadowObservationId = cleanText(input.shadowObservationId, 120);
    if (!shadowObservationId) throw new Error("A Target shadow observation is required for rehearsal.");
    if (input.adapterVersion !== TARGET_ADD_ADAPTER_VERSION
      || input.observerVersion !== TARGET_OBSERVER_VERSION
      || input.contractVersion !== 1) {
      throw new Error("The Target add rehearsal contract version is unsupported.");
    }
    if (!(["passed", "rejected"] as const).includes(input.outcome)) {
      throw new Error("The Target add rehearsal outcome is invalid.");
    }
    const reasonCode = cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US");
    if (!REASON_PATTERN.test(reasonCode)) throw new Error("The Target add rehearsal reason is invalid.");
    if (input.outcome === "passed" && reasonCode !== "verified") {
      throw new Error("A passed Target add rehearsal must contain verified evidence.");
    }
    const observedTime = new Date(input.observedAt).getTime();
    if (!Number.isFinite(observedTime)
      || observedTime > now + MAX_CLOCK_SKEW_MS
      || now - observedTime > MAX_REHEARSAL_AGE_MS) {
      throw new Error("The Target add rehearsal is stale or has an invalid timestamp.");
    }
    const shadow = this.db.get<ShadowRow>(
      `SELECT id, device_id AS deviceId, retailer_sku AS retailerSku,
              adapter_version AS adapterVersion, contract_version AS contractVersion,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_shadow_observations
       WHERE id = ? AND user_id = ? AND retailer_id = 'target'`,
      shadowObservationId,
      currentRequestScope().userId
    );
    if (!shadow || shadow.deviceId !== cleanDeviceId) {
      throw new Error("The Target shadow observation is unavailable for this paired device.");
    }
    if (shadow.adapterVersion !== TARGET_OBSERVER_VERSION || shadow.contractVersion !== 1) {
      throw new Error("The Target shadow observation uses an unsupported contract.");
    }
    if (now - new Date(shadow.receivedAt).getTime() > MAX_REHEARSAL_AGE_MS
      || observedTime + 5_000 < new Date(shadow.observedAt).getTime()) {
      throw new Error("The Target shadow observation is too old for this rehearsal.");
    }
    if (input.outcome === "passed" && shadow.observationState !== "actionable_candidate") {
      throw new Error("Only complete actionable Target evidence can pass a rehearsal.");
    }
    if (input.outcome === "passed" && (
      shadow.sellerType !== "first_party"
      || shadow.sellerName !== "Target"
      || shadow.fulfillment !== "shipping"
    )) {
      throw new Error(`${TARGET_ADD_ADAPTER_VERSION} rehearsals require a Target-sold shipping offer.`);
    }
    const existing = this.db.get<TrialRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              adapter_version AS adapterVersion, observer_version AS observerVersion,
              contract_version AS contractVersion, trial_kind AS trialKind,
              shadow_observation_id AS shadowObservationId, retailer_sku AS retailerSku,
              outcome, reason_code AS reasonCode, evidence_hash AS evidenceHash,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_adapter_trials
       WHERE device_id = ? AND adapter_version = ? AND trial_kind = 'pre_click_rehearsal'
         AND shadow_observation_id = ?`,
      cleanDeviceId,
      TARGET_ADD_ADAPTER_VERSION,
      shadowObservationId
    );
    if (existing) {
      if (existing.outcome !== input.outcome || existing.reasonCode !== reasonCode) {
        throw new Error("A different Target add rehearsal result is already recorded for this observation.");
      }
      return existing as StoredTargetAddTrial;
    }

    const observedAt = new Date(observedTime).toISOString();
    const receivedAt = nowIso(now);
    const evidenceHash = stableHash(
      "target-add-rehearsal-v1",
      TARGET_ADD_ADAPTER_VERSION,
      shadow.evidenceHash,
      input.outcome,
      reasonCode,
      observedAt
    );
    const trial: StoredTargetAddTrial = {
      id: newId("adapter_trial"),
      deviceId: cleanDeviceId,
      retailerId: "target",
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      trialKind: "pre_click_rehearsal",
      shadowObservationId,
      retailerSku: shadow.retailerSku,
      outcome: input.outcome,
      reasonCode,
      evidenceHash,
      observedAt,
      receivedAt
    };
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO retailer_adapter_trials(
           id, tenant_id, user_id, device_id, retailer_id, adapter_version,
           observer_version, contract_version, trial_kind, shadow_observation_id,
           retailer_sku, outcome, reason_code, evidence_hash, observed_at, received_at
         ) VALUES (?, ?, ?, ?, 'target', ?, ?, 1, 'pre_click_rehearsal', ?, ?, ?, ?, ?, ?, ?)`,
        trial.id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        trial.deviceId,
        trial.adapterVersion,
        trial.observerVersion,
        trial.shadowObservationId,
        trial.retailerSku,
        trial.outcome,
        trial.reasonCode,
        trial.evidenceHash,
        trial.observedAt,
        trial.receivedAt
      );
      this.auditEvents.record({
        correlationId: trial.id,
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_trial",
        reasonCode: trial.reasonCode,
        message: trial.outcome === "passed"
          ? "The Target add runner reached its final click boundary without clicking."
          : "The Target add rehearsal stopped safely before the click boundary.",
        data: {
          retailerId: trial.retailerId,
          adapterVersion: trial.adapterVersion,
          retailerSku: trial.retailerSku,
          outcome: trial.outcome,
          shadowObservationId: trial.shadowObservationId
        }
      }, now);
      this.db.run(
        `DELETE FROM retailer_adapter_trials
         WHERE user_id = ? AND id NOT IN (
           SELECT id FROM retailer_adapter_trials
           WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?
         )`,
        currentRequestScope().userId,
        currentRequestScope().userId,
        RETENTION_LIMIT
      );
    });
    return trial;
  }

  recordWalmartAddRehearsal(
    deviceId: string,
    input: WalmartAddRehearsalInput,
    now = Date.now()
  ): StoredWalmartAddTrial {
    if (!input || typeof input !== "object") throw new Error("A Walmart add rehearsal receipt is required.");
    const cleanDeviceId = cleanText(deviceId, 120);
    const shadowObservationId = cleanText(input.shadowObservationId, 120);
    if (!shadowObservationId) throw new Error("A Walmart shadow observation is required for rehearsal.");
    if (input.adapterVersion !== WALMART_ADD_ADAPTER_VERSION
      || input.observerVersion !== WALMART_OBSERVER_VERSION
      || input.contractVersion !== 1) {
      throw new Error("The Walmart add rehearsal contract version is unsupported.");
    }
    if (!( ["passed", "rejected"] as const).includes(input.outcome)) {
      throw new Error("The Walmart add rehearsal outcome is invalid.");
    }
    const reasonCode = cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US");
    if (!REASON_PATTERN.test(reasonCode)) throw new Error("The Walmart add rehearsal reason is invalid.");
    if (input.outcome === "passed" && reasonCode !== "verified") {
      throw new Error("A passed Walmart add rehearsal must contain verified evidence.");
    }
    const observedTime = new Date(input.observedAt).getTime();
    if (!Number.isFinite(observedTime)
      || observedTime > now + MAX_CLOCK_SKEW_MS
      || now - observedTime > MAX_REHEARSAL_AGE_MS) {
      throw new Error("The Walmart add rehearsal is stale or has an invalid timestamp.");
    }
    const shadow = this.db.get<ShadowRow>(
      `SELECT id, device_id AS deviceId, retailer_sku AS retailerSku,
              adapter_version AS adapterVersion, contract_version AS contractVersion,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_shadow_observations
       WHERE id = ? AND user_id = ? AND retailer_id = 'walmart'`,
      shadowObservationId,
      currentRequestScope().userId
    );
    if (!shadow || shadow.deviceId !== cleanDeviceId) {
      throw new Error("The Walmart shadow observation is unavailable for this paired device.");
    }
    if (shadow.adapterVersion !== WALMART_OBSERVER_VERSION || shadow.contractVersion !== 1) {
      throw new Error("The Walmart shadow observation uses an unsupported contract.");
    }
    if (now - new Date(shadow.receivedAt).getTime() > MAX_REHEARSAL_AGE_MS
      || observedTime + 5_000 < new Date(shadow.observedAt).getTime()) {
      throw new Error("The Walmart shadow observation is too old for this rehearsal.");
    }
    if (input.outcome === "passed" && shadow.observationState !== "actionable_candidate") {
      throw new Error("Only complete actionable Walmart evidence can pass a rehearsal.");
    }
    if (input.outcome === "passed" && (
      shadow.sellerType !== "first_party"
      || shadow.sellerName !== "Walmart"
      || shadow.fulfillment !== "shipping"
    )) {
      throw new Error(`${WALMART_ADD_ADAPTER_VERSION} rehearsals require a Walmart-sold shipping offer.`);
    }
    const existing = this.db.get<TrialRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              adapter_version AS adapterVersion, observer_version AS observerVersion,
              contract_version AS contractVersion, trial_kind AS trialKind,
              shadow_observation_id AS shadowObservationId, retailer_sku AS retailerSku,
              outcome, reason_code AS reasonCode, evidence_hash AS evidenceHash,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_adapter_trials
       WHERE device_id = ? AND adapter_version = ? AND trial_kind = 'pre_click_rehearsal'
         AND shadow_observation_id = ?`,
      cleanDeviceId,
      WALMART_ADD_ADAPTER_VERSION,
      shadowObservationId
    );
    if (existing) {
      if (existing.outcome !== input.outcome || existing.reasonCode !== reasonCode) {
        throw new Error("A different Walmart add rehearsal result is already recorded for this observation.");
      }
      return existing as StoredWalmartAddTrial;
    }

    const observedAt = new Date(observedTime).toISOString();
    const receivedAt = nowIso(now);
    const evidenceHash = stableHash(
      "walmart-add-rehearsal-v1",
      WALMART_ADD_ADAPTER_VERSION,
      shadow.evidenceHash,
      input.outcome,
      reasonCode,
      observedAt
    );
    const trial: StoredWalmartAddTrial = {
      id: newId("adapter_trial"),
      deviceId: cleanDeviceId,
      retailerId: "walmart",
      adapterVersion: WALMART_ADD_ADAPTER_VERSION,
      observerVersion: WALMART_OBSERVER_VERSION,
      contractVersion: 1,
      trialKind: "pre_click_rehearsal",
      shadowObservationId,
      retailerSku: shadow.retailerSku,
      outcome: input.outcome,
      reasonCode,
      evidenceHash,
      observedAt,
      receivedAt
    };
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO retailer_adapter_trials(
           id, tenant_id, user_id, device_id, retailer_id, adapter_version,
           observer_version, contract_version, trial_kind, shadow_observation_id,
           retailer_sku, outcome, reason_code, evidence_hash, observed_at, received_at
         ) VALUES (?, ?, ?, ?, 'walmart', ?, ?, 1, 'pre_click_rehearsal', ?, ?, ?, ?, ?, ?, ?)`,
        trial.id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        trial.deviceId,
        trial.adapterVersion,
        trial.observerVersion,
        trial.shadowObservationId,
        trial.retailerSku,
        trial.outcome,
        trial.reasonCode,
        trial.evidenceHash,
        trial.observedAt,
        trial.receivedAt
      );
      this.auditEvents.record({
        correlationId: trial.id,
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_trial",
        reasonCode: trial.reasonCode,
        message: trial.outcome === "passed"
          ? "The Walmart add runner reached its final click boundary without clicking."
          : "The Walmart add rehearsal stopped safely before the click boundary.",
        data: {
          retailerId: trial.retailerId,
          adapterVersion: trial.adapterVersion,
          retailerSku: trial.retailerSku,
          outcome: trial.outcome,
          shadowObservationId: trial.shadowObservationId
        }
      }, now);
      this.db.run(
        `DELETE FROM retailer_adapter_trials
         WHERE user_id = ? AND id NOT IN (
           SELECT id FROM retailer_adapter_trials
           WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?
         )`,
        currentRequestScope().userId,
        currentRequestScope().userId,
        RETENTION_LIMIT
      );
    });
    return trial;
  }

  recordAmazonAddRehearsal(
    deviceId: string,
    input: AmazonAddRehearsalInput,
    now = Date.now()
  ): StoredAmazonAddTrial {
    if (!input || typeof input !== "object") throw new Error("An Amazon add rehearsal receipt is required.");
    const cleanDeviceId = cleanText(deviceId, 120);
    const shadowObservationId = cleanText(input.shadowObservationId, 120);
    if (!shadowObservationId) throw new Error("An Amazon shadow observation is required for rehearsal.");
    if (input.adapterVersion !== AMAZON_ADD_ADAPTER_VERSION
      || input.observerVersion !== AMAZON_OBSERVER_VERSION
      || input.contractVersion !== 1) {
      throw new Error("The Amazon add rehearsal contract version is unsupported.");
    }
    if (!( ["passed", "rejected"] as const).includes(input.outcome)) {
      throw new Error("The Amazon add rehearsal outcome is invalid.");
    }
    const reasonCode = cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US");
    if (!REASON_PATTERN.test(reasonCode)) throw new Error("The Amazon add rehearsal reason is invalid.");
    if (input.outcome === "passed" && reasonCode !== "verified") {
      throw new Error("A passed Amazon add rehearsal must contain verified evidence.");
    }
    const observedTime = new Date(input.observedAt).getTime();
    if (!Number.isFinite(observedTime)
      || observedTime > now + MAX_CLOCK_SKEW_MS
      || now - observedTime > MAX_REHEARSAL_AGE_MS) {
      throw new Error("The Amazon add rehearsal is stale or has an invalid timestamp.");
    }
    const shadow = this.db.get<ShadowRow>(
      `SELECT id, device_id AS deviceId, retailer_sku AS retailerSku,
              adapter_version AS adapterVersion, contract_version AS contractVersion,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              purchase_route_ready AS purchaseRouteReady,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_shadow_observations
       WHERE id = ? AND user_id = ? AND retailer_id = 'amazon'`,
      shadowObservationId,
      currentRequestScope().userId
    );
    if (!shadow || shadow.deviceId !== cleanDeviceId) {
      throw new Error("The Amazon shadow observation is unavailable for this paired device.");
    }
    if (shadow.adapterVersion !== AMAZON_OBSERVER_VERSION || shadow.contractVersion !== 1) {
      throw new Error("The Amazon shadow observation uses an unsupported contract.");
    }
    if (now - new Date(shadow.receivedAt).getTime() > MAX_REHEARSAL_AGE_MS
      || observedTime + 5_000 < new Date(shadow.observedAt).getTime()) {
      throw new Error("The Amazon shadow observation is too old for this rehearsal.");
    }
    if (input.outcome === "passed" && shadow.observationState !== "actionable_candidate") {
      throw new Error("Only complete actionable Amazon evidence can pass a rehearsal.");
    }
    if (input.outcome === "passed" && (
      shadow.sellerType !== "first_party"
      || shadow.sellerName !== "Amazon.com"
      || shadow.fulfillment !== "shipping"
      || shadow.purchaseRouteReady !== 1
    )) {
      throw new Error(`${AMAZON_ADD_ADAPTER_VERSION} rehearsals require an Amazon.com-sold shipping offer with an exact ephemeral offer binding.`);
    }
    const existing = this.db.get<TrialRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              adapter_version AS adapterVersion, observer_version AS observerVersion,
              contract_version AS contractVersion, trial_kind AS trialKind,
              shadow_observation_id AS shadowObservationId, retailer_sku AS retailerSku,
              outcome, reason_code AS reasonCode, evidence_hash AS evidenceHash,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_adapter_trials
       WHERE device_id = ? AND adapter_version = ? AND trial_kind = 'pre_click_rehearsal'
         AND shadow_observation_id = ?`,
      cleanDeviceId,
      AMAZON_ADD_ADAPTER_VERSION,
      shadowObservationId
    );
    if (existing) {
      if (existing.outcome !== input.outcome || existing.reasonCode !== reasonCode) {
        throw new Error("A different Amazon add rehearsal result is already recorded for this observation.");
      }
      return existing as StoredAmazonAddTrial;
    }

    const observedAt = new Date(observedTime).toISOString();
    const receivedAt = nowIso(now);
    const evidenceHash = stableHash(
      "amazon-add-rehearsal-v4",
      AMAZON_ADD_ADAPTER_VERSION,
      shadow.evidenceHash,
      input.outcome,
      reasonCode,
      observedAt
    );
    const trial: StoredAmazonAddTrial = {
      id: newId("adapter_trial"),
      deviceId: cleanDeviceId,
      retailerId: "amazon",
      adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
      observerVersion: AMAZON_OBSERVER_VERSION,
      contractVersion: 1,
      trialKind: "pre_click_rehearsal",
      shadowObservationId,
      retailerSku: shadow.retailerSku,
      outcome: input.outcome,
      reasonCode,
      evidenceHash,
      observedAt,
      receivedAt
    };
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO retailer_adapter_trials(
           id, tenant_id, user_id, device_id, retailer_id, adapter_version,
           observer_version, contract_version, trial_kind, shadow_observation_id,
           retailer_sku, outcome, reason_code, evidence_hash, observed_at, received_at
         ) VALUES (?, ?, ?, ?, 'amazon', ?, ?, 1, 'pre_click_rehearsal', ?, ?, ?, ?, ?, ?, ?)`,
        trial.id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        trial.deviceId,
        trial.adapterVersion,
        trial.observerVersion,
        trial.shadowObservationId,
        trial.retailerSku,
        trial.outcome,
        trial.reasonCode,
        trial.evidenceHash,
        trial.observedAt,
        trial.receivedAt
      );
      this.auditEvents.record({
        correlationId: trial.id,
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_trial",
        reasonCode: trial.reasonCode,
        message: trial.outcome === "passed"
          ? "The Amazon add runner reached its final click boundary without clicking."
          : "The Amazon add rehearsal stopped safely before the click boundary.",
        data: {
          retailerId: trial.retailerId,
          adapterVersion: trial.adapterVersion,
          retailerSku: trial.retailerSku,
          outcome: trial.outcome,
          shadowObservationId: trial.shadowObservationId
        }
      }, now);
      this.db.run(
        `DELETE FROM retailer_adapter_trials
         WHERE user_id = ? AND id NOT IN (
           SELECT id FROM retailer_adapter_trials
           WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?
         )`,
        currentRequestScope().userId,
        currentRequestScope().userId,
        RETENTION_LIMIT
      );
    });
    return trial;
  }

  recordBestBuyAddRehearsal(
    deviceId: string,
    input: BestBuyAddRehearsalInput,
    now = Date.now()
  ): StoredBestBuyAddTrial {
    if (!input || typeof input !== "object") throw new Error("A Best Buy add rehearsal receipt is required.");
    const cleanDeviceId = cleanText(deviceId, 120);
    const shadowObservationId = cleanText(input.shadowObservationId, 120);
    if (!shadowObservationId) throw new Error("A Best Buy shadow observation is required for rehearsal.");
    if (input.adapterVersion !== BESTBUY_ADD_ADAPTER_VERSION
      || input.observerVersion !== BESTBUY_OBSERVER_VERSION
      || input.contractVersion !== 1) {
      throw new Error("The Best Buy add rehearsal contract version is unsupported.");
    }
    if (!( ["passed", "rejected"] as const).includes(input.outcome)) {
      throw new Error("The Best Buy add rehearsal outcome is invalid.");
    }
    const reasonCode = cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US");
    if (!REASON_PATTERN.test(reasonCode)) throw new Error("The Best Buy add rehearsal reason is invalid.");
    if (input.outcome === "passed" && reasonCode !== "verified") {
      throw new Error("A passed Best Buy add rehearsal must contain verified evidence.");
    }
    const observedTime = new Date(input.observedAt).getTime();
    if (!Number.isFinite(observedTime)
      || observedTime > now + MAX_CLOCK_SKEW_MS
      || now - observedTime > MAX_REHEARSAL_AGE_MS) {
      throw new Error("The Best Buy add rehearsal is stale or has an invalid timestamp.");
    }
    const shadow = this.db.get<ShadowRow>(
      `SELECT id, device_id AS deviceId, retailer_sku AS retailerSku,
              adapter_version AS adapterVersion, contract_version AS contractVersion,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_shadow_observations
       WHERE id = ? AND user_id = ? AND retailer_id = 'bestbuy'`,
      shadowObservationId,
      currentRequestScope().userId
    );
    if (!shadow || shadow.deviceId !== cleanDeviceId) {
      throw new Error("The Best Buy shadow observation is unavailable for this paired device.");
    }
    if (shadow.adapterVersion !== BESTBUY_OBSERVER_VERSION || shadow.contractVersion !== 1) {
      throw new Error("The Best Buy shadow observation uses an unsupported contract.");
    }
    if (now - new Date(shadow.receivedAt).getTime() > MAX_REHEARSAL_AGE_MS
      || observedTime + 5_000 < new Date(shadow.observedAt).getTime()) {
      throw new Error("The Best Buy shadow observation is too old for this rehearsal.");
    }
    if (input.outcome === "passed" && shadow.observationState !== "actionable_candidate") {
      throw new Error("Only complete actionable Best Buy evidence can pass a rehearsal.");
    }
    if (input.outcome === "passed" && (
      shadow.sellerType !== "first_party"
      || shadow.sellerName !== "Best Buy"
      || shadow.fulfillment !== "shipping"
    )) {
      throw new Error(`${BESTBUY_ADD_ADAPTER_VERSION} rehearsals require an explicitly Best Buy-sold, selected-shipping offer.`);
    }
    const existing = this.db.get<TrialRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              adapter_version AS adapterVersion, observer_version AS observerVersion,
              contract_version AS contractVersion, trial_kind AS trialKind,
              shadow_observation_id AS shadowObservationId, retailer_sku AS retailerSku,
              outcome, reason_code AS reasonCode, evidence_hash AS evidenceHash,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_adapter_trials
       WHERE device_id = ? AND adapter_version = ? AND trial_kind = 'pre_click_rehearsal'
         AND shadow_observation_id = ?`,
      cleanDeviceId,
      BESTBUY_ADD_ADAPTER_VERSION,
      shadowObservationId
    );
    if (existing) {
      if (existing.outcome !== input.outcome || existing.reasonCode !== reasonCode) {
        throw new Error("A different Best Buy add rehearsal result is already recorded for this observation.");
      }
      return existing as StoredBestBuyAddTrial;
    }

    const observedAt = new Date(observedTime).toISOString();
    const receivedAt = nowIso(now);
    const evidenceHash = stableHash(
      "bestbuy-add-rehearsal-v1",
      BESTBUY_ADD_ADAPTER_VERSION,
      shadow.evidenceHash,
      input.outcome,
      reasonCode,
      observedAt
    );
    const trial: StoredBestBuyAddTrial = {
      id: newId("adapter_trial"),
      deviceId: cleanDeviceId,
      retailerId: "bestbuy",
      adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
      observerVersion: BESTBUY_OBSERVER_VERSION,
      contractVersion: 1,
      trialKind: "pre_click_rehearsal",
      shadowObservationId,
      retailerSku: shadow.retailerSku,
      outcome: input.outcome,
      reasonCode,
      evidenceHash,
      observedAt,
      receivedAt
    };
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO retailer_adapter_trials(
           id, tenant_id, user_id, device_id, retailer_id, adapter_version,
           observer_version, contract_version, trial_kind, shadow_observation_id,
           retailer_sku, outcome, reason_code, evidence_hash, observed_at, received_at
         ) VALUES (?, ?, ?, ?, 'bestbuy', ?, ?, 1, 'pre_click_rehearsal', ?, ?, ?, ?, ?, ?, ?)`,
        trial.id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        trial.deviceId,
        trial.adapterVersion,
        trial.observerVersion,
        trial.shadowObservationId,
        trial.retailerSku,
        trial.outcome,
        trial.reasonCode,
        trial.evidenceHash,
        trial.observedAt,
        trial.receivedAt
      );
      this.auditEvents.record({
        correlationId: trial.id,
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_trial",
        reasonCode: trial.reasonCode,
        message: trial.outcome === "passed"
          ? "The Best Buy add runner reached its final click boundary without clicking."
          : "The Best Buy add rehearsal stopped safely before the click boundary.",
        data: {
          retailerId: trial.retailerId,
          adapterVersion: trial.adapterVersion,
          retailerSku: trial.retailerSku,
          outcome: trial.outcome,
          shadowObservationId: trial.shadowObservationId
        }
      }, now);
      this.db.run(
        `DELETE FROM retailer_adapter_trials
         WHERE user_id = ? AND id NOT IN (
           SELECT id FROM retailer_adapter_trials
           WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?
         )`,
        currentRequestScope().userId,
        currentRequestScope().userId,
        RETENTION_LIMIT
      );
    });
    return trial;
  }

  targetAddQualified(now = Date.now()): boolean {
    return this.addQualified("target", TARGET_ADD_ADAPTER_VERSION, now);
  }

  walmartAddQualified(now = Date.now()): boolean {
    return this.addQualified("walmart", WALMART_ADD_ADAPTER_VERSION, now);
  }

  amazonAddQualified(now = Date.now()): boolean {
    return this.addQualified("amazon", AMAZON_ADD_ADAPTER_VERSION, now);
  }

  bestBuyAddQualified(now = Date.now()): boolean {
    return this.addQualified("bestbuy", BESTBUY_ADD_ADAPTER_VERSION, now);
  }

  activateTargetAdd(
    input: TargetAddActivationInput,
    now = Date.now()
  ): { readiness: TargetQualificationReadiness; promotedJobs: number } {
    if (!input || typeof input !== "object"
      || input.adapterVersion !== TARGET_ADD_ADAPTER_VERSION
      || input.confirmation !== TARGET_ADD_ACTIVATION_CONFIRMATION) {
      throw new Error("Explicit Target add-only activation confirmation is required.");
    }
    const evidenceHash = cleanText(input.evidenceHash, 64).toLocaleLowerCase("en-US");
    if (!EVIDENCE_HASH_PATTERN.test(evidenceHash)) throw new Error("The Target qualification evidence hash is invalid.");
    const shadowRepository = new ShadowObservationRepository(this.db);
    const readiness = shadowRepository.targetQualificationReadiness(now);
    if (!readiness.qualificationEvidenceReady || readiness.qualificationEvidenceHash !== evidenceHash) {
      throw new Error("Target qualification evidence changed or is incomplete. Refresh and review it before enabling adds.");
    }
    const device = this.db.get<{ capabilities_json: string; last_seen_at: string }>(
      `SELECT capabilities_json, last_seen_at FROM extension_devices
       WHERE user_id = ? AND status = 'active'
       ORDER BY last_seen_at DESC LIMIT 1`,
      currentRequestScope().userId
    );
    let capabilities: Record<string, unknown> = {};
    try { capabilities = JSON.parse(device?.capabilities_json ?? "{}") as Record<string, unknown>; } catch { capabilities = {}; }
    if (!device
      || new Date(device.last_seen_at).getTime() < now - ACTIVE_DEVICE_WINDOW_MS
      || capabilities.targetAddOnly !== true
      || capabilities.targetAddAdapterVersion !== TARGET_ADD_ADAPTER_VERSION) {
      throw new Error(`A recently connected Chrome companion with ${TARGET_ADD_ADAPTER_VERSION} is required.`);
    }

    const promotedJobs = this.db.transaction(() => {
      const timestamp = nowIso(now);
      const expiresAt = nowIso(now + QUALIFICATION_TTL_MS);
      this.db.run(
        `INSERT INTO retailer_adapter_qualifications(
           tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
           evidence_hash, qualified_at, updated_at, expires_at
         ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)
         ON CONFLICT(user_id, retailer_id) DO UPDATE SET
           adapter_version = excluded.adapter_version,
           highest_action = excluded.highest_action,
           status = excluded.status,
           evidence_hash = excluded.evidence_hash,
           qualified_at = excluded.qualified_at,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        TARGET_ADD_ADAPTER_VERSION,
        evidenceHash,
        timestamp,
        timestamp,
        expiresAt
      );
      // Adapter-version migrations deliberately close the shared catalog lane so
      // stale evidence cannot authorize new cart jobs. A successful, current
      // qualification must reopen both halves of that lane atomically; otherwise
      // Target remains monitoring-only even though the user just qualified it.
      this.db.run("UPDATE retailers SET execution_supported = 1, updated_at = ? WHERE id = 'target'", timestamp);
      this.db.run("UPDATE listings SET execution_supported = 1, updated_at = ? WHERE retailer_id = 'target'", timestamp);
      this.db.run(
        "UPDATE app_settings SET execution_mode = 'live', updated_at = ? WHERE user_id = ?",
        timestamp,
        currentRequestScope().userId
      );
      const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
        "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
        currentRequestScope().userId
      );
      const promotable = control?.execution_mode === "live" && control.actions_paused === 0
        ? this.db.all<{ id: string }>(
          `SELECT aj.id FROM action_jobs aj JOIN listings l ON l.id = aj.listing_id
           WHERE aj.user_id = ? AND aj.state = 'shadow_ready' AND aj.expires_at > ?
             AND l.retailer_id = 'target' AND aj.action = 'add_to_cart' AND aj.quantity = 1
             AND aj.seller_policy = 'first_party_only' AND aj.fulfillment IN ('shipping', 'pickup')
           ORDER BY aj.created_at, aj.id`,
          currentRequestScope().userId,
          timestamp
        ) : [];
      const signals = new SignalRepository(this.db);
      for (const job of promotable) {
        signals.transitionJob(
          job.id,
          "awaiting_executor",
          "target_add_v1_activated",
          "A fresh shadow job entered the guarded Target add-only executor after explicit activation.",
          { adapterVersion: TARGET_ADD_ADAPTER_VERSION },
          now
        );
      }
      this.auditEvents.record({
        correlationId: "target",
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_qualified",
        reasonCode: "explicit_target_add_v1_activation",
        message: `${TARGET_ADD_ADAPTER_VERSION} was explicitly enabled for Target-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.`,
        data: {
          retailerId: "target",
          adapterVersion: TARGET_ADD_ADAPTER_VERSION,
          highestAction: "add_to_cart",
          sellerPolicy: "first_party_only",
          fulfillment: "shipping",
          quantity: 1,
          evidenceHash,
          promotedJobs: promotable.length
        }
      }, now);
      return promotable.length;
    });
    return { readiness: shadowRepository.targetQualificationReadiness(now), promotedJobs };
  }

  activateWalmartAdd(
    input: WalmartAddActivationInput,
    now = Date.now()
  ): { readiness: WalmartQualificationReadiness; promotedJobs: number } {
    if (!input || typeof input !== "object"
      || input.adapterVersion !== WALMART_ADD_ADAPTER_VERSION
      || input.confirmation !== WALMART_ADD_ACTIVATION_CONFIRMATION) {
      throw new Error("Explicit Walmart add-only activation confirmation is required.");
    }
    const evidenceHash = cleanText(input.evidenceHash, 64).toLocaleLowerCase("en-US");
    if (!EVIDENCE_HASH_PATTERN.test(evidenceHash)) throw new Error("The Walmart qualification evidence hash is invalid.");
    const shadowRepository = new ShadowObservationRepository(this.db);
    const readiness = shadowRepository.walmartQualificationReadiness(now);
    if (!readiness.qualificationEvidenceReady || readiness.qualificationEvidenceHash !== evidenceHash) {
      throw new Error("Walmart qualification evidence changed or is incomplete. Refresh and review it before enabling adds.");
    }
    const device = this.db.get<{ capabilities_json: string; last_seen_at: string }>(
      `SELECT capabilities_json, last_seen_at FROM extension_devices
       WHERE user_id = ? AND status = 'active'
       ORDER BY last_seen_at DESC LIMIT 1`,
      currentRequestScope().userId
    );
    let capabilities: Record<string, unknown> = {};
    try { capabilities = JSON.parse(device?.capabilities_json ?? "{}") as Record<string, unknown>; } catch { capabilities = {}; }
    if (!device
      || new Date(device.last_seen_at).getTime() < now - ACTIVE_DEVICE_WINDOW_MS
      || capabilities.walmartAddOnly !== true
      || capabilities.walmartAddAdapterVersion !== WALMART_ADD_ADAPTER_VERSION) {
      throw new Error(`A recently connected Chrome companion with ${WALMART_ADD_ADAPTER_VERSION} is required.`);
    }

    const promotedJobs = this.db.transaction(() => {
      const timestamp = nowIso(now);
      const expiresAt = nowIso(now + QUALIFICATION_TTL_MS);
      this.db.run(
        `INSERT INTO retailer_adapter_qualifications(
           tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
           evidence_hash, qualified_at, updated_at, expires_at
         ) VALUES (?, ?, 'walmart', ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)
         ON CONFLICT(user_id, retailer_id) DO UPDATE SET
           adapter_version = excluded.adapter_version,
           highest_action = excluded.highest_action,
           status = excluded.status,
           evidence_hash = excluded.evidence_hash,
           qualified_at = excluded.qualified_at,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        WALMART_ADD_ADAPTER_VERSION,
        evidenceHash,
        timestamp,
        timestamp,
        expiresAt
      );
      this.db.run("UPDATE retailers SET execution_supported = 1, updated_at = ? WHERE id = 'walmart'", timestamp);
      this.db.run("UPDATE listings SET execution_supported = 1, updated_at = ? WHERE retailer_id = 'walmart'", timestamp);
      const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
        "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
        currentRequestScope().userId
      );
      const promotable = control?.execution_mode === "live" && control.actions_paused === 0
        ? this.db.all<{ id: string }>(
          `SELECT aj.id FROM action_jobs aj JOIN listings l ON l.id = aj.listing_id
           WHERE aj.user_id = ? AND aj.state = 'shadow_ready' AND aj.expires_at > ?
             AND l.retailer_id = 'walmart' AND aj.action = 'add_to_cart' AND aj.quantity = 1
             AND aj.seller_policy = 'first_party_only' AND aj.fulfillment IN ('shipping', 'pickup')
           ORDER BY aj.created_at, aj.id`,
          currentRequestScope().userId,
          timestamp
        ) : [];
      const signals = new SignalRepository(this.db);
      for (const job of promotable) {
        signals.transitionJob(
          job.id,
          "awaiting_executor",
          "walmart_add_v1_activated",
          "A fresh shadow job entered the guarded Walmart add-only executor after explicit activation.",
          { adapterVersion: WALMART_ADD_ADAPTER_VERSION },
          now
        );
      }
      this.auditEvents.record({
        correlationId: "walmart",
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_qualified",
        reasonCode: "explicit_walmart_add_v1_activation",
        message: `${WALMART_ADD_ADAPTER_VERSION} was explicitly enabled for Walmart-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.`,
        data: {
          retailerId: "walmart",
          adapterVersion: WALMART_ADD_ADAPTER_VERSION,
          highestAction: "add_to_cart",
          sellerPolicy: "first_party_only",
          fulfillment: "shipping",
          quantity: 1,
          evidenceHash,
          promotedJobs: promotable.length
        }
      }, now);
      return promotable.length;
    });
    return { readiness: shadowRepository.walmartQualificationReadiness(now), promotedJobs };
  }

  activateAmazonAdd(
    input: AmazonAddActivationInput,
    now = Date.now()
  ): { readiness: AmazonQualificationReadiness; promotedJobs: number } {
    if (!input || typeof input !== "object"
      || input.adapterVersion !== AMAZON_ADD_ADAPTER_VERSION
      || input.confirmation !== AMAZON_ADD_ACTIVATION_CONFIRMATION) {
      throw new Error("Explicit Amazon add-only activation confirmation is required.");
    }
    const evidenceHash = cleanText(input.evidenceHash, 64).toLocaleLowerCase("en-US");
    if (!EVIDENCE_HASH_PATTERN.test(evidenceHash)) throw new Error("The Amazon qualification evidence hash is invalid.");
    const shadowRepository = new ShadowObservationRepository(this.db);
    const readiness = shadowRepository.amazonQualificationReadiness(now);
    if (!readiness.qualificationEvidenceReady || readiness.qualificationEvidenceHash !== evidenceHash) {
      throw new Error("Amazon qualification evidence changed or is incomplete. Refresh and review it before enabling adds.");
    }
    const device = this.db.get<{ capabilities_json: string; last_seen_at: string }>(
      `SELECT capabilities_json, last_seen_at FROM extension_devices
       WHERE user_id = ? AND status = 'active'
       ORDER BY last_seen_at DESC LIMIT 1`,
      currentRequestScope().userId
    );
    let capabilities: Record<string, unknown> = {};
    try { capabilities = JSON.parse(device?.capabilities_json ?? "{}") as Record<string, unknown>; } catch { capabilities = {}; }
    if (!device
      || new Date(device.last_seen_at).getTime() < now - ACTIVE_DEVICE_WINDOW_MS
      || capabilities.amazonAddOnly !== true
      || capabilities.amazonAddAdapterVersion !== AMAZON_ADD_ADAPTER_VERSION) {
      throw new Error(`A recently connected Chrome companion with ${AMAZON_ADD_ADAPTER_VERSION} is required.`);
    }

    const promotedJobs = this.db.transaction(() => {
      const timestamp = nowIso(now);
      const expiresAt = nowIso(now + QUALIFICATION_TTL_MS);
      this.db.run(
        `INSERT INTO retailer_adapter_qualifications(
           tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
           evidence_hash, qualified_at, updated_at, expires_at
         ) VALUES (?, ?, 'amazon', ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)
         ON CONFLICT(user_id, retailer_id) DO UPDATE SET
           adapter_version = excluded.adapter_version,
           highest_action = excluded.highest_action,
           status = excluded.status,
           evidence_hash = excluded.evidence_hash,
           qualified_at = excluded.qualified_at,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        AMAZON_ADD_ADAPTER_VERSION,
        evidenceHash,
        timestamp,
        timestamp,
        expiresAt
      );
      this.db.run("UPDATE retailers SET execution_supported = 1, updated_at = ? WHERE id = 'amazon'", timestamp);
      this.db.run("UPDATE listings SET execution_supported = 1, updated_at = ? WHERE retailer_id = 'amazon'", timestamp);
      const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
        "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
        currentRequestScope().userId
      );
      const promotable = control?.execution_mode === "live" && control.actions_paused === 0
        ? this.db.all<{ id: string }>(
          `SELECT aj.id FROM action_jobs aj JOIN listings l ON l.id = aj.listing_id
           WHERE aj.user_id = ? AND aj.state = 'shadow_ready' AND aj.expires_at > ?
             AND l.retailer_id = 'amazon' AND aj.action = 'add_to_cart' AND aj.quantity = 1
             AND aj.seller_policy = 'first_party_only' AND aj.fulfillment IN ('shipping', 'pickup')
           ORDER BY aj.created_at, aj.id`,
          currentRequestScope().userId,
          timestamp
        ) : [];
      const signals = new SignalRepository(this.db);
      for (const job of promotable) {
        signals.transitionJob(
          job.id,
          "awaiting_executor",
          "amazon_add_v1_activated",
          "A fresh shadow job entered the guarded Amazon add-only executor after explicit activation.",
          { adapterVersion: AMAZON_ADD_ADAPTER_VERSION },
          now
        );
      }
      this.auditEvents.record({
        correlationId: "amazon",
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_qualified",
        reasonCode: "explicit_amazon_add_v1_activation",
        message: `${AMAZON_ADD_ADAPTER_VERSION} was explicitly enabled for Amazon.com-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.`,
        data: {
          retailerId: "amazon",
          adapterVersion: AMAZON_ADD_ADAPTER_VERSION,
          highestAction: "add_to_cart",
          sellerPolicy: "first_party_only",
          fulfillment: "shipping",
          quantity: 1,
          evidenceHash,
          promotedJobs: promotable.length
        }
      }, now);
      return promotable.length;
    });
    return { readiness: shadowRepository.amazonQualificationReadiness(now), promotedJobs };
  }

  activateBestBuyAdd(
    input: BestBuyAddActivationInput,
    now = Date.now()
  ): { readiness: BestBuyQualificationReadiness; promotedJobs: number } {
    if (!input || typeof input !== "object"
      || input.adapterVersion !== BESTBUY_ADD_ADAPTER_VERSION
      || input.confirmation !== BESTBUY_ADD_ACTIVATION_CONFIRMATION) {
      throw new Error("Explicit Best Buy add-only activation confirmation is required.");
    }
    const evidenceHash = cleanText(input.evidenceHash, 64).toLocaleLowerCase("en-US");
    if (!EVIDENCE_HASH_PATTERN.test(evidenceHash)) throw new Error("The Best Buy qualification evidence hash is invalid.");
    const shadowRepository = new ShadowObservationRepository(this.db);
    const readiness = shadowRepository.bestBuyQualificationReadiness(now);
    if (!readiness.qualificationEvidenceReady || readiness.qualificationEvidenceHash !== evidenceHash) {
      throw new Error("Best Buy qualification evidence changed or is incomplete. Refresh and review it before enabling adds.");
    }
    const device = this.db.get<{ capabilities_json: string; last_seen_at: string }>(
      `SELECT capabilities_json, last_seen_at FROM extension_devices
       WHERE user_id = ? AND status = 'active'
       ORDER BY last_seen_at DESC LIMIT 1`,
      currentRequestScope().userId
    );
    let capabilities: Record<string, unknown> = {};
    try { capabilities = JSON.parse(device?.capabilities_json ?? "{}") as Record<string, unknown>; } catch { capabilities = {}; }
    if (!device
      || new Date(device.last_seen_at).getTime() < now - ACTIVE_DEVICE_WINDOW_MS
      || capabilities.bestBuyAddOnly !== true
      || capabilities.bestBuyAddAdapterVersion !== BESTBUY_ADD_ADAPTER_VERSION) {
      throw new Error(`A recently connected Chrome companion with ${BESTBUY_ADD_ADAPTER_VERSION} is required.`);
    }

    const promotedJobs = this.db.transaction(() => {
      const timestamp = nowIso(now);
      const expiresAt = nowIso(now + QUALIFICATION_TTL_MS);
      this.db.run(
        `INSERT INTO retailer_adapter_qualifications(
           tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
           evidence_hash, qualified_at, updated_at, expires_at
         ) VALUES (?, ?, 'bestbuy', ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)
         ON CONFLICT(user_id, retailer_id) DO UPDATE SET
           adapter_version = excluded.adapter_version,
           highest_action = excluded.highest_action,
           status = excluded.status,
           evidence_hash = excluded.evidence_hash,
           qualified_at = excluded.qualified_at,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        BESTBUY_ADD_ADAPTER_VERSION,
        evidenceHash,
        timestamp,
        timestamp,
        expiresAt
      );
      this.db.run("UPDATE retailers SET execution_supported = 1, updated_at = ? WHERE id = 'bestbuy'", timestamp);
      this.db.run("UPDATE listings SET execution_supported = 1, updated_at = ? WHERE retailer_id = 'bestbuy'", timestamp);
      const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
        "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
        currentRequestScope().userId
      );
      const promotable = control?.execution_mode === "live" && control.actions_paused === 0
        ? this.db.all<{ id: string }>(
          `SELECT aj.id FROM action_jobs aj JOIN listings l ON l.id = aj.listing_id
           WHERE aj.user_id = ? AND aj.state = 'shadow_ready' AND aj.expires_at > ?
             AND l.retailer_id = 'bestbuy' AND aj.action = 'add_to_cart' AND aj.quantity = 1
             AND aj.seller_policy = 'first_party_only' AND aj.fulfillment IN ('shipping', 'pickup')
           ORDER BY aj.created_at, aj.id`,
          currentRequestScope().userId,
          timestamp
        ) : [];
      const signals = new SignalRepository(this.db);
      for (const job of promotable) {
        signals.transitionJob(
          job.id,
          "awaiting_executor",
          "bestbuy_add_v1_activated",
          "A fresh shadow job entered the guarded Best Buy add-only executor after explicit activation.",
          { adapterVersion: BESTBUY_ADD_ADAPTER_VERSION },
          now
        );
      }
      this.auditEvents.record({
        correlationId: "bestbuy",
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_qualified",
        reasonCode: "explicit_bestbuy_add_v1_activation",
        message: `${BESTBUY_ADD_ADAPTER_VERSION} was explicitly enabled for Best Buy-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.`,
        data: {
          retailerId: "bestbuy",
          adapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
          highestAction: "add_to_cart",
          sellerPolicy: "first_party_only",
          fulfillment: "shipping",
          quantity: 1,
          evidenceHash,
          promotedJobs: promotable.length
        }
      }, now);
      return promotable.length;
    });
    return { readiness: shadowRepository.bestBuyQualificationReadiness(now), promotedJobs };
  }
}
