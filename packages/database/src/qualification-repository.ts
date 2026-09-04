import {
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  ADD_LANES,
  type AmazonAddActivationInput,
  type AmazonAddRehearsalInput,
  type BestBuyAddActivationInput,
  type BestBuyAddRehearsalInput,
  type TargetAddActivationInput,
  type TargetAddRehearsalInput,
  type WalmartAddActivationInput,
  type WalmartAddRehearsalInput,
  type AddLaneId
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
import { laneDegradation } from "./adapter-diagnostic-repository.js";

const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_REHEARSAL_AGE_MS = 10 * 60_000;
const RETENTION_LIMIT = 1_000;
const REASON_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const EVIDENCE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const ACTIVE_DEVICE_WINDOW_MS = 5 * 60_000;
const QUALIFICATION_TTL_MS = 30 * 24 * 60 * 60_000;
const PACK_VERSION_PATTERN = /^[a-z]+-pack-v\d{1,4}$/;

function trialPackVersion(value: unknown, current: string): string {
  const normalized = cleanText(value, 40).toLocaleLowerCase("en-US") || current;
  if (!PACK_VERSION_PATTERN.test(normalized)) throw new Error("The rehearsal selector-pack version is invalid.");
  return normalized;
}

export interface StoredTargetAddTrial {
  id: string;
  deviceId: string;
  retailerId: "target";
  adapterVersion: typeof TARGET_ADD_ADAPTER_VERSION;
  observerVersion: typeof TARGET_OBSERVER_VERSION;
  packVersion: string;
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
  packVersion: string;
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
  packVersion: string;
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
  packVersion: string;
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
  retailerId: AddLaneId;
  adapterVersion: string;
  observerVersion: string;
  packVersion: string;
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

type GuardedRetailerId = AddLaneId;

export interface AutomaticQualificationRenewal {
  retailerId: GuardedRetailerId;
  renewed: boolean;
  reasonCode: string;
  promotedJobs: number;
}

type AddRehearsalInput = TargetAddRehearsalInput | WalmartAddRehearsalInput
  | AmazonAddRehearsalInput | BestBuyAddRehearsalInput;
type AddActivationInput = TargetAddActivationInput | WalmartAddActivationInput
  | AmazonAddActivationInput | BestBuyAddActivationInput;
type StoredAddTrial = StoredTargetAddTrial | StoredWalmartAddTrial
  | StoredAmazonAddTrial | StoredBestBuyAddTrial;
type AddQualificationReadiness = TargetQualificationReadiness | WalmartQualificationReadiness
  | AmazonQualificationReadiness | BestBuyQualificationReadiness;

export class QualificationRepository {
  private readonly auditEvents: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.auditEvents = new AuditRepository(db);
  }

  private recordPackVerification(trial: TrialRow, now: number): void {
    if (trial.outcome !== "passed"
      || trial.packVersion !== ADD_LANES[trial.retailerId].packVersion) return;
    this.auditEvents.record({
      correlationId: trial.retailerId,
      aggregateType: "retailer_qualification",
      eventType: "retailer_adapter_pack_verified",
      reasonCode: "packaged_selector_pack_passed",
      message: `${trial.packVersion} passed a current no-click store check.`,
      data: {
        retailerId: trial.retailerId,
        adapterVersion: trial.adapterVersion,
        packVersion: trial.packVersion,
        trialId: trial.id
      }
    }, now);
  }

  private addQualifiedForVersion(
    retailerId: AddLaneId,
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
    const qualified = row?.status === "qualified"
      && row.adapter_version === adapterVersion
      && row.highest_action === "add_to_cart"
      && Number.isFinite(expiresAt)
      && expiresAt > now;
    if (!qualified) return false;
    const latestPassingPack = this.db.get<{ packVersion: string }>(
      `SELECT COALESCE(pack_version, '') AS packVersion
       FROM retailer_adapter_trials
       WHERE tenant_id = ? AND user_id = ? AND retailer_id = ?
         AND adapter_version = ? AND outcome = 'passed'
       ORDER BY received_at DESC, id DESC LIMIT 1`,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      retailerId,
      adapterVersion
    );
    if (latestPassingPack && latestPassingPack.packVersion !== ADD_LANES[retailerId].packVersion) return false;
    // A qualified row is necessary but not sufficient: current-version
    // evidence that keeps failing (open repair groups on ≥2 products, three
    // rejected rehearsals in a row, or a live add that failed after the last
    // pass) degrades the lane so guarded adds stop leasing until fresh
    // passing evidence arrives. Nothing is written; renewal lifts it.
    return !laneDegradation(this.db, retailerId, {
      add: adapterVersion,
      observer: ADD_LANES[retailerId].observerVersion
    }, now).degraded;
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
    // `suspended` is a legacy status value that no current code path writes.
    // It is treated exactly like an expired or version-changed qualification:
    // a previously authorized lane that fresh passing evidence may renew.
    // Only explicit manual retirement refuses automatic renewal.
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
    const lane = ADD_LANES[retailerId];
    const adapterVersion = lane.contractVersion;
    const capability = lane.capability;
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
         AND adapter_version = ? AND pack_version = ? AND outcome = 'passed' AND reason_code = 'verified'
         AND received_at >= ?
       ORDER BY received_at DESC, id DESC LIMIT 1`,
      scope.tenantId,
      scope.userId,
      cleanDeviceId,
      retailerId,
      adapterVersion,
      lane.packVersion,
      nowIso(now - MAX_REHEARSAL_AGE_MS)
    );
    if (!freshTrial) return skipped("fresh_rehearsal_missing");
    const readiness = this.addReadiness(retailerId, now);
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

  private addReadiness(retailerId: AddLaneId, now: number): AddQualificationReadiness {
    const repository = new ShadowObservationRepository(this.db);
    if (retailerId === "target") return repository.targetQualificationReadiness(now);
    if (retailerId === "walmart") return repository.walmartQualificationReadiness(now);
    if (retailerId === "amazon") return repository.amazonQualificationReadiness(now);
    return repository.bestBuyQualificationReadiness(now);
  }

  recordAddRehearsal(
    retailerId: AddLaneId,
    deviceId: string,
    input: AddRehearsalInput,
    now = Date.now()
  ): StoredAddTrial {
    const lane = ADD_LANES[retailerId];
    const name = lane.name;
    const article = retailerId === "amazon" ? "An" : "A";
    if (!input || typeof input !== "object") {
      throw new Error(`${article} ${name} add rehearsal receipt is required.`);
    }
    const cleanDeviceId = cleanText(deviceId, 120);
    const shadowObservationId = cleanText(input.shadowObservationId, 120);
    if (!shadowObservationId) throw new Error(`${article} ${name} shadow observation is required for rehearsal.`);
    if (input.adapterVersion !== lane.contractVersion
      || input.observerVersion !== lane.observerVersion
      || input.contractVersion !== 1) {
      throw new Error(`The ${name} add rehearsal contract version is unsupported.`);
    }
    const packVersion = trialPackVersion(input.packVersion, lane.packVersion);
    if (!(["passed", "rejected"] as const).includes(input.outcome)) {
      throw new Error(`The ${name} add rehearsal outcome is invalid.`);
    }
    const reasonCode = cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US");
    if (!REASON_PATTERN.test(reasonCode)) throw new Error(`The ${name} add rehearsal reason is invalid.`);
    if (input.outcome === "passed" && reasonCode !== "verified") {
      throw new Error(`A passed ${name} add rehearsal must contain verified evidence.`);
    }
    const observedTime = new Date(input.observedAt).getTime();
    if (!Number.isFinite(observedTime)
      || observedTime > now + MAX_CLOCK_SKEW_MS
      || now - observedTime > MAX_REHEARSAL_AGE_MS) {
      throw new Error(`The ${name} add rehearsal is stale or has an invalid timestamp.`);
    }
    const shadow = this.db.get<ShadowRow>(
      `SELECT id, device_id AS deviceId, retailer_sku AS retailerSku,
              adapter_version AS adapterVersion, contract_version AS contractVersion,
              observation_state AS observationState, evidence_hash AS evidenceHash,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              purchase_route_ready AS purchaseRouteReady,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_shadow_observations
       WHERE id = ? AND tenant_id = ? AND user_id = ? AND retailer_id = ?`,
      shadowObservationId,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      retailerId
    );
    if (!shadow || shadow.deviceId !== cleanDeviceId) {
      throw new Error(`The ${name} shadow observation is unavailable for this paired device.`);
    }
    if (shadow.adapterVersion !== lane.observerVersion || shadow.contractVersion !== 1) {
      throw new Error(`The ${name} shadow observation uses an unsupported contract.`);
    }
    if (now - new Date(shadow.receivedAt).getTime() > MAX_REHEARSAL_AGE_MS
      || observedTime + 5_000 < new Date(shadow.observedAt).getTime()) {
      throw new Error(`The ${name} shadow observation is too old for this rehearsal.`);
    }
    if (input.outcome === "passed" && shadow.observationState !== "actionable_candidate") {
      throw new Error(`Only complete actionable ${name} evidence can pass a rehearsal.`);
    }
    const expectedSeller = lane.firstPartySeller;
    const passPolicyHeld = shadow.sellerType === "first_party"
      && shadow.sellerName === expectedSeller
      && shadow.fulfillment === "shipping"
      && (retailerId !== "amazon" || shadow.purchaseRouteReady === 1);
    if (input.outcome === "passed" && !passPolicyHeld) {
      if (retailerId === "amazon") {
        throw new Error(`${lane.contractVersion} rehearsals require an Amazon.com-sold shipping offer with an exact ephemeral offer binding.`);
      }
      if (retailerId === "bestbuy") {
        throw new Error(`${lane.contractVersion} rehearsals require an explicitly Best Buy-sold, selected-shipping offer.`);
      }
      throw new Error(`${lane.contractVersion} rehearsals require a ${expectedSeller}-sold shipping offer.`);
    }
    const existing = this.db.get<TrialRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              adapter_version AS adapterVersion, observer_version AS observerVersion,
              COALESCE(pack_version, '') AS packVersion,
              contract_version AS contractVersion, trial_kind AS trialKind,
              shadow_observation_id AS shadowObservationId, retailer_sku AS retailerSku,
              outcome, reason_code AS reasonCode, evidence_hash AS evidenceHash,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_adapter_trials
       WHERE tenant_id = ? AND user_id = ? AND device_id = ? AND retailer_id = ?
         AND adapter_version = ? AND trial_kind = 'pre_click_rehearsal'
         AND shadow_observation_id = ?`,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      cleanDeviceId,
      retailerId,
      lane.contractVersion,
      shadowObservationId
    );
    if (existing) {
      if (existing.outcome !== input.outcome || existing.reasonCode !== reasonCode || existing.packVersion !== packVersion) {
        throw new Error(`A different ${name} add rehearsal result is already recorded for this observation.`);
      }
      return existing as StoredAddTrial;
    }

    const observedAt = new Date(observedTime).toISOString();
    const receivedAt = nowIso(now);
    const evidenceHash = stableHash(
      lane.rehearsalEvidenceNamespace,
      lane.contractVersion,
      shadow.evidenceHash,
      packVersion,
      input.outcome,
      reasonCode,
      observedAt
    );
    const trial: TrialRow = {
      id: newId("adapter_trial"),
      deviceId: cleanDeviceId,
      retailerId,
      adapterVersion: lane.contractVersion,
      observerVersion: lane.observerVersion,
      packVersion,
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
           observer_version, pack_version, contract_version, trial_kind, shadow_observation_id,
           retailer_sku, outcome, reason_code, evidence_hash, observed_at, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pre_click_rehearsal', ?, ?, ?, ?, ?, ?, ?)`,
        trial.id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        trial.deviceId,
        trial.retailerId,
        trial.adapterVersion,
        trial.observerVersion,
        trial.packVersion,
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
          ? `The ${name} add runner reached its final click boundary without clicking.`
          : `The ${name} add rehearsal stopped safely before the click boundary.`,
        data: {
          retailerId: trial.retailerId,
          adapterVersion: trial.adapterVersion,
          packVersion: trial.packVersion,
          retailerSku: trial.retailerSku,
          outcome: trial.outcome,
          shadowObservationId: trial.shadowObservationId
        }
      }, now);
      this.recordPackVerification(trial, now);
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
    return trial as StoredAddTrial;
  }

  // One-release compatibility aliases. All validation and persistence runs
  // through the registry-backed path above.
  recordTargetAddRehearsal(deviceId: string, input: TargetAddRehearsalInput, now = Date.now()): StoredTargetAddTrial {
    return this.recordAddRehearsal("target", deviceId, input, now) as StoredTargetAddTrial;
  }

  recordWalmartAddRehearsal(deviceId: string, input: WalmartAddRehearsalInput, now = Date.now()): StoredWalmartAddTrial {
    return this.recordAddRehearsal("walmart", deviceId, input, now) as StoredWalmartAddTrial;
  }

  recordAmazonAddRehearsal(deviceId: string, input: AmazonAddRehearsalInput, now = Date.now()): StoredAmazonAddTrial {
    return this.recordAddRehearsal("amazon", deviceId, input, now) as StoredAmazonAddTrial;
  }

  recordBestBuyAddRehearsal(deviceId: string, input: BestBuyAddRehearsalInput, now = Date.now()): StoredBestBuyAddTrial {
    return this.recordAddRehearsal("bestbuy", deviceId, input, now) as StoredBestBuyAddTrial;
  }

  addQualified(retailerId: AddLaneId, now = Date.now()): boolean {
    return this.addQualifiedForVersion(retailerId, ADD_LANES[retailerId].contractVersion, now);
  }

  targetAddQualified(now = Date.now()): boolean {
    return this.addQualified("target", now);
  }

  walmartAddQualified(now = Date.now()): boolean {
    return this.addQualified("walmart", now);
  }

  amazonAddQualified(now = Date.now()): boolean {
    return this.addQualified("amazon", now);
  }

  bestBuyAddQualified(now = Date.now()): boolean {
    return this.addQualified("bestbuy", now);
  }

  activateAdd(
    retailerId: AddLaneId,
    input: AddActivationInput,
    now = Date.now()
  ): { readiness: AddQualificationReadiness; promotedJobs: number } {
    const lane = ADD_LANES[retailerId];
    const name = lane.name;
    if (!input || typeof input !== "object"
      || input.adapterVersion !== lane.contractVersion
      || input.confirmation !== lane.activationConfirmation) {
      throw new Error(`Explicit ${name} add-only activation confirmation is required.`);
    }
    const evidenceHash = cleanText(input.evidenceHash, 64).toLocaleLowerCase("en-US");
    if (!EVIDENCE_HASH_PATTERN.test(evidenceHash)) {
      throw new Error(`The ${name} qualification evidence hash is invalid.`);
    }
    const readiness = this.addReadiness(retailerId, now);
    if (!readiness.qualificationEvidenceReady || readiness.qualificationEvidenceHash !== evidenceHash) {
      throw new Error(`${name} qualification evidence changed or is incomplete. Refresh and review it before enabling adds.`);
    }
    const device = this.db.get<{ capabilities_json: string; last_seen_at: string }>(
      `SELECT capabilities_json, last_seen_at FROM extension_devices
       WHERE user_id = ? AND status = 'active'
       ORDER BY last_seen_at DESC LIMIT 1`,
      currentRequestScope().userId
    );
    let capabilities: Record<string, unknown> = {};
    try { capabilities = JSON.parse(device?.capabilities_json ?? "{}") as Record<string, unknown>; } catch { capabilities = {}; }
    const capability = lane.capability;
    if (!device
      || new Date(device.last_seen_at).getTime() < now - ACTIVE_DEVICE_WINDOW_MS
      || capabilities[capability.enabled] !== true
      || capabilities[capability.version] !== lane.contractVersion) {
      throw new Error(`A recently connected Chrome companion with ${lane.contractVersion} is required.`);
    }

    const promotedJobs = this.db.transaction(() => {
      const timestamp = nowIso(now);
      const expiresAt = nowIso(now + QUALIFICATION_TTL_MS);
      this.db.run(
        `INSERT INTO retailer_adapter_qualifications(
           tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
           evidence_hash, qualified_at, updated_at, expires_at
         ) VALUES (?, ?, ?, ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)
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
        retailerId,
        lane.contractVersion,
        evidenceHash,
        timestamp,
        timestamp,
        expiresAt
      );
      this.db.run("UPDATE retailers SET execution_supported = 1, updated_at = ? WHERE id = ?", timestamp, retailerId);
      this.db.run("UPDATE listings SET execution_supported = 1, updated_at = ? WHERE retailer_id = ?", timestamp, retailerId);
      if (retailerId === "target") {
        this.db.run(
          "UPDATE app_settings SET execution_mode = 'live', updated_at = ? WHERE user_id = ?",
          timestamp,
          currentRequestScope().userId
        );
      }
      const control = this.db.get<{ execution_mode: string; actions_paused: number }>(
        "SELECT execution_mode, actions_paused FROM app_settings WHERE user_id = ?",
        currentRequestScope().userId
      );
      const promotable = control?.execution_mode === "live" && control.actions_paused === 0
        ? this.db.all<{ id: string }>(
          `SELECT aj.id FROM action_jobs aj JOIN listings l ON l.id = aj.listing_id
           WHERE aj.user_id = ? AND aj.state = 'shadow_ready' AND aj.expires_at > ?
             AND l.retailer_id = ? AND aj.action = 'add_to_cart' AND aj.quantity = 1
             AND aj.seller_policy = 'first_party_only' AND aj.fulfillment IN ('shipping', 'pickup')
           ORDER BY aj.created_at, aj.id`,
          currentRequestScope().userId,
          timestamp,
          retailerId
        ) : [];
      const signals = new SignalRepository(this.db);
      for (const job of promotable) {
        signals.transitionJob(
          job.id,
          "awaiting_executor",
          `${retailerId}_add_v1_activated`,
          `A fresh shadow job entered the guarded ${name} add-only executor after explicit activation.`,
          { adapterVersion: lane.contractVersion },
          now
        );
      }
      const seller = lane.firstPartySeller;
      this.auditEvents.record({
        correlationId: retailerId,
        aggregateType: "retailer_qualification",
        eventType: "retailer_adapter_qualified",
        reasonCode: `explicit_${retailerId}_add_v1_activation`,
        message: `${lane.contractVersion} was explicitly enabled for ${seller}-sold offers matching exact Shipping or Pickup, add-to-cart only, quantity one.`,
        data: {
          retailerId,
          adapterVersion: lane.contractVersion,
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
    return { readiness: this.addReadiness(retailerId, now), promotedJobs };
  }

  // One-release compatibility aliases.
  activateTargetAdd(input: TargetAddActivationInput, now = Date.now()):
  { readiness: TargetQualificationReadiness; promotedJobs: number } {
    return this.activateAdd("target", input, now) as {
      readiness: TargetQualificationReadiness; promotedJobs: number;
    };
  }

  activateWalmartAdd(input: WalmartAddActivationInput, now = Date.now()):
  { readiness: WalmartQualificationReadiness; promotedJobs: number } {
    return this.activateAdd("walmart", input, now) as {
      readiness: WalmartQualificationReadiness; promotedJobs: number;
    };
  }

  activateAmazonAdd(input: AmazonAddActivationInput, now = Date.now()):
  { readiness: AmazonQualificationReadiness; promotedJobs: number } {
    return this.activateAdd("amazon", input, now) as {
      readiness: AmazonQualificationReadiness; promotedJobs: number;
    };
  }

  activateBestBuyAdd(input: BestBuyAddActivationInput, now = Date.now()):
  { readiness: BestBuyQualificationReadiness; promotedJobs: number } {
    return this.activateAdd("bestbuy", input, now) as {
      readiness: BestBuyQualificationReadiness; promotedJobs: number;
    };
  }

}
