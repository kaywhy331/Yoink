import { OfficialMsrpRepository } from "./official-msrp-repository.js";
import type { OfficialMsrpAuthorization } from "../../contracts/src/official-msrp.js";
import { DomainRequestError } from "../../domain/src/domain-request-error.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { DomainConflictError } from "../../domain/src/domain-request-error.js";
import { randomBytes } from "node:crypto";
import {
  ADD_LANE_IDS,
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  POKEMONCENTER_ADD_ADAPTER_VERSION,
  ASUS_ADD_ADAPTER_VERSION,
  AUDIOADVICE_ADD_ADAPTER_VERSION,
  BANANAREPUBLIC_ADD_ADAPTER_VERSION,
  BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
  ATHLETA_ADD_ADAPTER_VERSION,
  AMERICANEAGLE_ADD_ADAPTER_VERSION,
  ANINEBING_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  type JobState
} from "../../contracts/src/index.js";
import { BROWSER_SAFETY_CONTRACT_VERSION } from "../../browser-safety/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { jobIsTerminal, jobMayHaveMutated } from "../../domain/src/job-state.js";
import { cleanText } from "../../domain/src/normalize.js";
import { ControlRepository } from "./control-repository.js";
import { YoinkDatabase } from "./database.js";
import {
  RETAILER_SESSION_FUTURE_TOLERANCE_MS,
  RETAILER_SESSION_MAX_AGE_MS
} from "./retailer-readiness-repository.js";
import { currentRequestScope } from "./request-scope.js";
import { SignalRepository } from "./signal-repository.js";
import { SpendLedgerRepository } from "./spend-ledger-repository.js";

const LEASE_TTL_MS = 45_000;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
export const EXECUTION_RECOVERY_LEASE_STATES = Object.freeze([
  "leased",
  "navigating",
  "verifying_listing",
  "offer_verified",
  "add_authorized",
  "adding",
  "cart_verified",
  "checkout_review",
  "submit_authorized",
  "submitting"
] as const);
export const EXECUTION_RECOVERY_BEFORE_MUTATION_REASON = "lease_expired_before_mutation";
export const EXECUTION_RECOVERY_AFTER_MUTATION_REASON = "lease_expired_after_mutation_boundary";
export const EXECUTION_RECOVERY_BEFORE_MUTATION_MESSAGE =
  "The Chrome lease expired before retailer mutation and was closed without retrying the stale job.";
export const EXECUTION_RECOVERY_AFTER_MUTATION_MESSAGE =
  "The Chrome lease expired after retailer mutation may have occurred; automatic retry is locked for review.";
export const EXECUTION_RECOVERY_SIGNAL_WINDOW_REASON = "signal_window_expired";
export const EXECUTION_RECOVERY_SIGNAL_WINDOW_MESSAGE =
  "The signal action window expired before Chrome leased the job; no retailer action occurred.";
export type NoLeaseReason = "shadow_mode" | "actions_paused" | "device_unavailable" | "device_busy" | "no_jobs";

export interface JobLease {
  officialMsrp?: OfficialMsrpAuthorization;
  contractVersion: typeof BROWSER_SAFETY_CONTRACT_VERSION;
  adapterVersion: string;
  id: string;
  capabilityToken: string;
  state: "leased";
  action: string;
  quantity: number;
  maxUnitPriceCents: number;
  maxOrderTotalCents: number;
  currency: string;
  sellerPolicy: string;
  expectedSeller: string;
  fulfillment: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  attributionUrl: string;
  attributionProvider: string;
  attributionMetadata: Record<string, string>;
  expiresAt: string;
  leaseExpiresAt: string;
}

export type LeaseResult = { job: JobLease; reason: "leased" } | { job: null; reason: NoLeaseReason };

interface CandidateRow {
  id: string;
  action: string;
  quantity: number;
  max_unit_price_cents: number;
  max_order_total_cents: number;
  currency: string;
  seller_policy: string;
  expected_seller: string;
  fulfillment: string;
  retailer_id: string;
  retailer_sku: string;
  canonical_url: string;
  attribution_url: string;
  attribution_provider: string;
  attribution_metadata_json: string;
  adapter_version: string;
  expires_at: string;
}

export interface JobProgressInput {
  state: JobState;
  reasonCode: string;
  message: string;
  evidence: Record<string, unknown>;
}

export interface ActionHandoffStatus {
  jobId: string;
  status: "cart_ready" | "needs_you" | "closed";
}

interface ExpiredLeaseRow {
  id: string;
  state: JobState;
}

function capabilityHash(token: string): string {
  return stableHash("yoink-job-capability-v1", token);
}

function deviceEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (["target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(String(value.retailerId))) output.retailerId = value.retailerId;
  if (typeof value.retailerSku === "string"
    && ((value.retailerId === "target" && /^\d{6,20}$/.test(value.retailerSku))
      || (value.retailerId === "walmart" && /^\d{5,20}$/.test(value.retailerSku))
      || (value.retailerId === "amazon" && /^[A-Z0-9]{10}$/.test(value.retailerSku))
      || (value.retailerId === "bestbuy" && /^\d{5,20}$/.test(value.retailerSku))
      || (value.retailerId === "pokemoncenter" && /^\d{2,3}-\d{5}(?:-\d{3})?$/.test(value.retailerSku))
      || (value.retailerId === "asus" && /^[A-Z0-9]{8}-[A-Z0-9]{6}$/.test(value.retailerSku))
      || (value.retailerId === "audioadvice" && /^\d{10,20}$/.test(value.retailerSku))
      || (value.retailerId === "bananarepublic" && /^\d{9}0000$/.test(value.retailerSku))
      || (value.retailerId === "bananarepublicfactory" && /^\d{10}0000$/.test(value.retailerSku))
      || (value.retailerId === "athleta" && /^\d{9}0000$/.test(value.retailerSku))
      || (value.retailerId === "americaneagle" && /^\d{10}$/.test(value.retailerSku))
      || (value.retailerId === "aninebing" && /^\d{10,20}$/.test(value.retailerSku)))) {
    output.retailerSku = value.retailerSku;
  }
  if (Number.isSafeInteger(value.unitPriceCents) && Number(value.unitPriceCents) > 0) output.unitPriceCents = Number(value.unitPriceCents);
  if (Number.isSafeInteger(value.allInTotalCents) && Number(value.allInTotalCents) > 0) output.allInTotalCents = Number(value.allInTotalCents);
  if (Number.isSafeInteger(value.orderTotalCents) && Number(value.orderTotalCents) > 0) output.orderTotalCents = Number(value.orderTotalCents);
  if (value.currency === "USD") output.currency = "USD";
  if (["first_party", "third_party", "unknown"].includes(String(value.sellerType))) output.sellerType = value.sellerType;
  if (["shipping", "pickup", "unknown"].includes(String(value.fulfillment))) output.fulfillment = value.fulfillment;
  if (Number.isInteger(value.quantity) && Number(value.quantity) >= 1 && Number(value.quantity) <= 99) output.quantity = Number(value.quantity);
  if (Number.isInteger(value.baselineLineCount)
    && Number(value.baselineLineCount) >= 0 && Number(value.baselineLineCount) <= 25) {
    output.baselineLineCount = Number(value.baselineLineCount);
  }
  if (value.latency && typeof value.latency === "object" && !Array.isArray(value.latency)) {
    const input = value.latency as Record<string, unknown>;
    const latency: Record<string, number> = {};
    for (const key of [
      "leaseToCartReadyMs", "leaseToBaselineMs", "baselineToOfferMs", "offerToClickMs",
      "clickToSettleMs", "clickToCartReadyMs", "settleToCartReadyMs"
    ] as const) {
      const milliseconds = Number(input[key]);
      if (Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 60 * 60_000) {
        latency[key] = milliseconds;
      }
    }
    if (Object.keys(latency).length) output.latency = latency;
  }
  return output;
}

function deviceStateMessage(state: JobState): string {
  const messages: Partial<Record<JobState, string>> = {
    navigating: "Chrome started retailer navigation and bound the pre-add cart baseline.",
    verifying_listing: "Chrome started exact live listing verification.",
    offer_verified: "Chrome verified the live offer against the immutable action contract.",
    add_authorized: "Chrome prepared the exact add control for final revalidation.",
    adding: "Chrome armed the durable add receipt before crossing the click boundary.",
    cart_verified: "Chrome verified an exact +1 cart delta while preserving every baseline quantity.",
    confirmed: "Chrome confirmed the bounded add-to-cart job.",
    offer_rejected: "Chrome rejected the live offer before retailer mutation.",
    cancelled: "Chrome cancelled the job before retailer mutation.",
    manual_review: "Chrome locked the job for review because retailer mutation may have occurred.",
    submission_uncertain: "Chrome could not prove the final order result; automatic retry is locked."
  };
  return messages[state] ?? "Chrome reported a bounded action-job state change.";
}

function attributionMetadata(value: string): Record<string, string> {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(value) as Record<string, unknown>; } catch { parsed = {}; }
  const output: Record<string, string> = {};
  if (typeof parsed.associateTag === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(parsed.associateTag)) {
    output.associateTag = parsed.associateTag;
  }
  if (typeof parsed.publisherSlug === "string" && /^[a-z0-9][a-z0-9_-]{1,79}$/.test(parsed.publisherSlug)) {
    output.publisherSlug = parsed.publisherSlug;
  }
  return output;
}

export class ExecutionRepository {
  private readonly signals: SignalRepository;
  private readonly control: ControlRepository;
  private readonly spendLedger: SpendLedgerRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.signals = new SignalRepository(db);
    this.control = new ControlRepository(db);
    this.spendLedger = new SpendLedgerRepository(db);
  }

  actionHandoffStatuses(deviceId: string, jobIds: string[]): ActionHandoffStatus[] {
    if (!Array.isArray(jobIds) || jobIds.length < 1 || jobIds.length > 10) {
      throw new InputValidationError("One through ten action handoff job IDs are required.");
    }
    const ids = [...new Set(jobIds.map((value) => cleanText(value, 120)))];
    if (ids.some((value) => !/^[A-Za-z0-9_-]{3,120}$/.test(value))) {
      throw new InputValidationError("Every action handoff job ID must be valid.");
    }
    const scope = currentRequestScope();
    const rows = this.db.all<{
      id: string;
      state: JobState;
      userReported: number;
      confirmationObserved: number;
    }>(
      `SELECT aj.id, aj.state,
              EXISTS(SELECT 1 FROM action_events ae
                WHERE ae.job_id = aj.id
                  AND ae.reason_code IN ('user_reported_order', 'user_reported_missed_it')) AS userReported,
              EXISTS(SELECT 1 FROM order_confirmation_observations observation
                WHERE observation.action_job_id = aj.id
                  AND observation.tenant_id = aj.tenant_id
                  AND observation.user_id = aj.user_id
                  AND observation.device_id = aj.assigned_device_id) AS confirmationObserved
       FROM action_jobs aj
       WHERE aj.tenant_id = ? AND aj.user_id = ? AND aj.assigned_device_id = ?
         AND aj.action = 'add_to_cart'
         AND aj.id IN (${ids.map(() => "?").join(", ")})`,
      scope.tenantId,
      scope.userId,
      cleanText(deviceId, 120),
      ...ids
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((jobId) => {
      const row = byId.get(jobId);
      if (!row) return [];
      const status: ActionHandoffStatus["status"] = Number(row.userReported) === 1
        || Number(row.confirmationObserved) === 1
        ? "closed"
        : ["manual_review", "submission_uncertain"].includes(row.state)
          ? "needs_you"
          : row.state === "confirmed" ? "cart_ready" : "closed";
      return [{ jobId, status }];
    });
  }

  /**
   * Cart actions a companion holds a live lease on right now. The Windows tray
   * waits for zero before restarting Yoink for an automatic update.
   */
  actionsInFlight(now = Date.now()): number {
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM action_jobs
       WHERE user_id = ? AND lease_expires_at <> '' AND lease_expires_at >= ?
         AND state IN (${EXECUTION_RECOVERY_LEASE_STATES.map(() => "?").join(", ")})`,
      currentRequestScope().userId,
      nowIso(now),
      ...EXECUTION_RECOVERY_LEASE_STATES
    )?.count ?? 0);
  }

  recoverExpiredLeases(now = Date.now()): number {
    const expired = this.db.all<ExpiredLeaseRow>(
      `SELECT id, state FROM action_jobs
       WHERE user_id = ? AND lease_expires_at <> '' AND lease_expires_at < ?
         AND state IN (${EXECUTION_RECOVERY_LEASE_STATES.map(() => "?").join(", ")})
       ORDER BY lease_expires_at, id`,
      currentRequestScope().userId,
      nowIso(now),
      ...EXECUTION_RECOVERY_LEASE_STATES
    );
    for (const job of expired) {
      const nextState: JobState = job.state === "submitting"
        ? "submission_uncertain"
        : jobMayHaveMutated(job.state)
          ? "manual_review"
          : job.state === "add_authorized" ? "cancelled" : "expired";
      this.signals.transitionJob(
        job.id,
        nextState,
        jobMayHaveMutated(job.state)
          ? EXECUTION_RECOVERY_AFTER_MUTATION_REASON
          : EXECUTION_RECOVERY_BEFORE_MUTATION_REASON,
        jobMayHaveMutated(job.state)
          ? EXECUTION_RECOVERY_AFTER_MUTATION_MESSAGE
          : EXECUTION_RECOVERY_BEFORE_MUTATION_MESSAGE,
        { previousState: job.state },
        now
      );
      this.db.run(
        `UPDATE action_jobs SET capability_nonce_hash = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ?`,
        stableHash(newId("retired_capability")),
        nowIso(now),
        nowIso(now),
        job.id
      );
    }
    return expired.length;
  }

  expirePendingJobs(now = Date.now()): number {
    const expired = this.db.all<{ id: string; state: JobState }>(
      `SELECT id, state FROM action_jobs
       WHERE user_id = ? AND expires_at < ? AND state IN ('shadow_ready', 'awaiting_executor')
       ORDER BY expires_at, id`,
      currentRequestScope().userId,
      nowIso(now)
    );
    for (const job of expired) {
      this.signals.transitionJob(
        job.id,
        "expired",
        EXECUTION_RECOVERY_SIGNAL_WINDOW_REASON,
        EXECUTION_RECOVERY_SIGNAL_WINDOW_MESSAGE,
        { previousState: job.state },
        now
      );
    }
    return expired.length;
  }

  leaseNextJob(
    deviceId: string,
    now = Date.now(),
    accessibleRetailersHint?: readonly string[]
  ): LeaseResult {
    return this.db.transaction(() => {
      const safeDeviceId = cleanText(deviceId, 120);
      const scope = currentRequestScope();
      // The poll receipt is stamped inside the lease (not by the route) so
      // every caller records it, including polls answered with shadow/paused.
      // Mirrored in the Postgres writer.
      this.db.run(
        "UPDATE extension_devices SET last_job_poll_at = ? WHERE id = ? AND user_id = ? AND status = 'active'",
        nowIso(now),
        safeDeviceId,
        scope.userId
      );
      // Read the mode inside BEGIN IMMEDIATE so a pause committed by another
      // process (standalone worker, shared data dir) is always honoured.
      const settings = this.control.settings();
      if (settings.executionMode !== "live") return { job: null, reason: "shadow_mode" };
      if (settings.actionsPaused) return { job: null, reason: "actions_paused" };
      this.recoverExpiredLeases(now);
      this.expirePendingJobs(now);
      this.spendLedger.releaseExpired(now);
      const device = this.db.get<{ capabilities_json: string }>(
        "SELECT capabilities_json FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
        safeDeviceId,
        scope.userId
      );
      if (!device) return { job: null, reason: "device_unavailable" };
      let capabilities: Record<string, unknown> = {};
      try { capabilities = JSON.parse(device.capabilities_json) as Record<string, unknown>; } catch { capabilities = {}; }
      if (capabilities.jobReconciliation !== true) {
        return { job: null, reason: "device_unavailable" };
      }

      const active = this.db.get<{ id: string }>(
        `SELECT id FROM action_jobs
         WHERE assigned_device_id = ? AND state IN (
           'leased', 'navigating', 'verifying_listing', 'offer_verified',
           'add_authorized', 'adding', 'cart_verified', 'checkout_review',
           'submit_authorized', 'submitting'
         ) LIMIT 1`,
        safeDeviceId
      );
      if (active) return { job: null, reason: "device_busy" };

      const targetAddCapable = capabilities.targetAddOnly === true
        && capabilities.targetAddAdapterVersion === TARGET_ADD_ADAPTER_VERSION;
      const walmartAddCapable = capabilities.walmartAddOnly === true
        && capabilities.walmartAddAdapterVersion === WALMART_ADD_ADAPTER_VERSION;
      const amazonAddCapable = capabilities.amazonAddOnly === true
        && capabilities.amazonAddAdapterVersion === AMAZON_ADD_ADAPTER_VERSION;
      const pokemonCenterAddCapable = capabilities.pokemonCenterAddOnly === true
        && capabilities.pokemonCenterAddAdapterVersion === POKEMONCENTER_ADD_ADAPTER_VERSION;
      const asusAddCapable = capabilities.asusAddOnly === true
        && capabilities.asusAddAdapterVersion === ASUS_ADD_ADAPTER_VERSION;
      const audioadviceAddCapable = capabilities.audioadviceAddOnly === true
        && capabilities.audioadviceAddAdapterVersion === AUDIOADVICE_ADD_ADAPTER_VERSION;
      const bananarepublicAddCapable = capabilities.bananarepublicAddOnly === true
        && capabilities.bananarepublicAddAdapterVersion === BANANAREPUBLIC_ADD_ADAPTER_VERSION;
      const bananarepublicfactoryAddCapable = capabilities.bananarepublicfactoryAddOnly === true
        && capabilities.bananarepublicfactoryAddAdapterVersion === BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION;
      const athletaAddCapable = capabilities.athletaAddOnly === true
        && capabilities.athletaAddAdapterVersion === ATHLETA_ADD_ADAPTER_VERSION;
      const americanEagleAddCapable = capabilities.americanEagleAddOnly === true
        && capabilities.americanEagleAddAdapterVersion === AMERICANEAGLE_ADD_ADAPTER_VERSION;
      const anineBingAddCapable = capabilities.anineBingAddOnly === true
        && capabilities.anineBingAddAdapterVersion === ANINEBING_ADD_ADAPTER_VERSION;
      const bestBuyAddCapable = capabilities.bestBuyAddOnly === true
        && capabilities.bestBuyAddAdapterVersion === BESTBUY_ADD_ADAPTER_VERSION;
      if (!targetAddCapable && !walmartAddCapable && !amazonAddCapable && !bestBuyAddCapable && !pokemonCenterAddCapable && !anineBingAddCapable && !americanEagleAddCapable && !asusAddCapable && !athletaAddCapable && !audioadviceAddCapable && !bananarepublicAddCapable && !bananarepublicfactoryAddCapable) {
        return { job: null, reason: "device_unavailable" };
      }
      // This device-supplied set is only a narrowing hint for optional Chrome
      // host permissions. It can never grant a capability the paired device
      // does not already possess, and omission preserves older clients.
      const accessibleRetailers = accessibleRetailersHint === undefined
        ? null
        : new Set(accessibleRetailersHint.slice(0, ADD_LANE_IDS.length).map((value) => cleanText(value, 40).toLowerCase())
          .filter((value) => ["target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(value)));
      const targetLeaseCapable = capabilities.officialMsrpCartV1 === true && targetAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("target"));
      const walmartLeaseCapable = capabilities.officialMsrpCartV1 === true && walmartAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("walmart"));
      const amazonLeaseCapable = capabilities.officialMsrpCartV1 === true && amazonAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("amazon"));
      const pokemonCenterLeaseCapable = pokemonCenterAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("pokemoncenter"));
      const asusLeaseCapable = asusAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("asus"));
      const audioadviceLeaseCapable = audioadviceAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("audioadvice"));
      const bananarepublicLeaseCapable = bananarepublicAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("bananarepublic"));
      const bananarepublicfactoryLeaseCapable = bananarepublicfactoryAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("bananarepublicfactory"));
      const athletaLeaseCapable = athletaAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("athleta"));
      const americanEagleLeaseCapable = americanEagleAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("americaneagle"));
      const anineBingLeaseCapable = anineBingAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("aninebing"));
      const bestBuyLeaseCapable = capabilities.officialMsrpCartV1 === true && bestBuyAddCapable
        && (accessibleRetailers === null || accessibleRetailers.has("bestbuy"));
      if (!targetLeaseCapable && !walmartLeaseCapable && !amazonLeaseCapable && !bestBuyLeaseCapable && !pokemonCenterLeaseCapable && !anineBingLeaseCapable && !americanEagleLeaseCapable && !asusLeaseCapable && !athletaLeaseCapable && !audioadviceLeaseCapable && !bananarepublicLeaseCapable && !bananarepublicfactoryLeaseCapable) {
        return { job: null, reason: "no_jobs" };
      }

      const candidate = this.db.get<CandidateRow>(
        `SELECT aj.id, aj.action, aj.quantity,
                aj.max_unit_price_cents, aj.max_order_total_cents, aj.currency,
                aj.seller_policy, aj.expected_seller, aj.fulfillment,
                l.retailer_id, l.retailer_sku, aj.canonical_url,
                aj.attribution_url, aj.attribution_provider,
                aj.attribution_metadata_json,
                qualification.adapter_version, aj.expires_at
         FROM action_jobs aj
         JOIN missions m ON m.id = aj.mission_id AND m.status = 'active'
         JOIN mission_targets mt ON mt.id = aj.mission_target_id AND mt.enabled = 1
         JOIN listings l ON l.id = aj.listing_id
         JOIN retailer_adapter_qualifications qualification
           ON qualification.tenant_id = aj.tenant_id
          AND qualification.user_id = aj.user_id
          AND qualification.retailer_id = l.retailer_id
          AND qualification.status = 'qualified'
          AND qualification.expires_at > ?
          AND qualification.highest_action IN ('add_to_cart', 'prepare_checkout', 'submit_order')
          AND qualification.adapter_version = CASE l.retailer_id
            WHEN 'target' THEN ?
            WHEN 'walmart' THEN ?
            WHEN 'amazon' THEN ?
            WHEN 'pokemoncenter' THEN ?
            WHEN 'asus' THEN ?
            WHEN 'audioadvice' THEN ?
            WHEN 'bananarepublic' THEN ?
            WHEN 'bananarepublicfactory' THEN ?
            WHEN 'athleta' THEN ?
            WHEN 'americaneagle' THEN ?
            WHEN 'aninebing' THEN ?
            WHEN 'bestbuy' THEN ?
            ELSE ''
          END
         JOIN spend_reservations sr ON sr.id = aj.spend_reservation_id
         WHERE aj.user_id = ? AND aj.state = 'awaiting_executor'
           AND aj.expires_at > ? AND aj.max_unit_price_cents IS NOT NULL
           AND aj.max_order_total_cents IS NOT NULL
           AND aj.offer_snapshot_id IS NOT NULL
           AND sr.status = 'active' AND sr.expires_at > ?
           AND aj.intent_revision_id = (
             SELECT ir.id FROM mission_intent_revisions ir
             WHERE ir.mission_id = aj.mission_id ORDER BY ir.revision DESC LIMIT 1
           )
           AND NOT EXISTS (
             SELECT 1 FROM retailer_session_readiness readiness
             WHERE readiness.tenant_id = aj.tenant_id
               AND readiness.user_id = aj.user_id
               AND readiness.device_id = ?
               AND readiness.retailer_id = l.retailer_id
               AND readiness.signed_in_state IN ('signed_out', 'challenged')
               AND readiness.updated_at >= ? AND readiness.updated_at <= ?
               AND readiness.adapter_version = CASE l.retailer_id
                 WHEN 'target' THEN ?
                 WHEN 'walmart' THEN ?
                 WHEN 'amazon' THEN ?
                 WHEN 'pokemoncenter' THEN ?
                 WHEN 'asus' THEN ?
                 WHEN 'audioadvice' THEN ?
                 WHEN 'bananarepublic' THEN ?
                 WHEN 'bananarepublicfactory' THEN ?
                 WHEN 'athleta' THEN ?
                 WHEN 'americaneagle' THEN ?
                 WHEN 'aninebing' THEN ?
                 WHEN 'bestbuy' THEN ?
                 ELSE ''
               END
           )
           AND (
             ? = 1 AND l.retailer_id = 'target' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment IN ('shipping', 'pickup')
             OR ? = 1 AND l.retailer_id = 'walmart' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment IN ('shipping', 'pickup')
             OR ? = 1 AND l.retailer_id = 'amazon' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment IN ('shipping', 'pickup')
             OR ? = 1 AND l.retailer_id = 'pokemoncenter' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment = 'shipping'
             OR ? = 1 AND l.retailer_id = 'asus' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment = 'shipping'
             OR ? = 1 AND l.retailer_id = 'audioadvice' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment = 'shipping'
             OR ? = 1 AND l.retailer_id = 'bananarepublic' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment = 'shipping'
             OR ? = 1 AND l.retailer_id = 'bananarepublicfactory' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment = 'shipping'
             OR ? = 1 AND l.retailer_id = 'athleta' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment = 'shipping'
             OR ? = 1 AND l.retailer_id = 'americaneagle' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment = 'shipping'
             OR ? = 1 AND l.retailer_id = 'aninebing' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment = 'shipping'
             OR ? = 1 AND l.retailer_id = 'bestbuy' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment IN ('shipping', 'pickup')
           )
         ORDER BY aj.created_at LIMIT 1`,
        nowIso(now),
        TARGET_ADD_ADAPTER_VERSION,
        WALMART_ADD_ADAPTER_VERSION,
        AMAZON_ADD_ADAPTER_VERSION,
        POKEMONCENTER_ADD_ADAPTER_VERSION,
        ASUS_ADD_ADAPTER_VERSION,
        AUDIOADVICE_ADD_ADAPTER_VERSION,
        BANANAREPUBLIC_ADD_ADAPTER_VERSION,
        BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
        ATHLETA_ADD_ADAPTER_VERSION,
        AMERICANEAGLE_ADD_ADAPTER_VERSION,
        ANINEBING_ADD_ADAPTER_VERSION,
        BESTBUY_ADD_ADAPTER_VERSION,
        scope.userId,
        nowIso(now),
        nowIso(now),
        safeDeviceId,
        nowIso(now - RETAILER_SESSION_MAX_AGE_MS),
        nowIso(now + RETAILER_SESSION_FUTURE_TOLERANCE_MS),
        TARGET_ADD_ADAPTER_VERSION,
        WALMART_ADD_ADAPTER_VERSION,
        AMAZON_ADD_ADAPTER_VERSION,
        POKEMONCENTER_ADD_ADAPTER_VERSION,
        ASUS_ADD_ADAPTER_VERSION,
        AUDIOADVICE_ADD_ADAPTER_VERSION,
        BANANAREPUBLIC_ADD_ADAPTER_VERSION,
        BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
        ATHLETA_ADD_ADAPTER_VERSION,
        AMERICANEAGLE_ADD_ADAPTER_VERSION,
        ANINEBING_ADD_ADAPTER_VERSION,
        BESTBUY_ADD_ADAPTER_VERSION,
        targetLeaseCapable ? 1 : 0,
        walmartLeaseCapable ? 1 : 0,
        amazonLeaseCapable ? 1 : 0,
        pokemonCenterLeaseCapable ? 1 : 0,
        asusLeaseCapable ? 1 : 0,
        audioadviceLeaseCapable ? 1 : 0,
        bananarepublicLeaseCapable ? 1 : 0,
        bananarepublicfactoryLeaseCapable ? 1 : 0,
        athletaLeaseCapable ? 1 : 0,
        americanEagleLeaseCapable ? 1 : 0,
        anineBingLeaseCapable ? 1 : 0,
        bestBuyLeaseCapable ? 1 : 0
      );
      if (!candidate) return { job: null, reason: "no_jobs" };

      const deviceCanAttempt = candidate.retailer_id === "target"
        ? targetAddCapable
          && candidate.action === "add_to_cart"
          && Number(candidate.quantity) === 1
          && candidate.seller_policy === "first_party_only"
          && ["shipping", "pickup"].includes(candidate.fulfillment)
        : candidate.retailer_id === "walmart"
          ? walmartAddCapable
            && candidate.action === "add_to_cart"
            && Number(candidate.quantity) === 1
            && candidate.seller_policy === "first_party_only"
            && ["shipping", "pickup"].includes(candidate.fulfillment)
          : candidate.retailer_id === "amazon"
            ? amazonAddCapable
              && candidate.action === "add_to_cart"
              && Number(candidate.quantity) === 1
              && candidate.seller_policy === "first_party_only"
              && ["shipping", "pickup"].includes(candidate.fulfillment)
            : candidate.retailer_id === "pokemoncenter"
              ? pokemonCenterAddCapable && candidate.action === "add_to_cart"
                && Number(candidate.quantity) === 1 && candidate.seller_policy === "first_party_only"
                && candidate.fulfillment === "shipping"
            : candidate.retailer_id === "asus"
              ? asusAddCapable && candidate.action === "add_to_cart"
            : candidate.retailer_id === "audioadvice"
              ? audioadviceAddCapable && candidate.action === "add_to_cart"
            : candidate.retailer_id === "bananarepublic"
              ? bananarepublicAddCapable && candidate.action === "add_to_cart"
            : candidate.retailer_id === "bananarepublicfactory"
              ? bananarepublicfactoryAddCapable && candidate.action === "add_to_cart"
            : candidate.retailer_id === "athleta"
              ? athletaAddCapable && candidate.action === "add_to_cart"
            : candidate.retailer_id === "americaneagle"
              ? americanEagleAddCapable && candidate.action === "add_to_cart"
            : candidate.retailer_id === "aninebing"
              ? anineBingAddCapable && candidate.action === "add_to_cart"
                && Number(candidate.quantity) === 1 && candidate.seller_policy === "first_party_only"
                && candidate.fulfillment === "shipping"
            : candidate.retailer_id === "bestbuy"
              ? bestBuyAddCapable
                && candidate.action === "add_to_cart"
                && Number(candidate.quantity) === 1
                && candidate.seller_policy === "first_party_only"
                && ["shipping", "pickup"].includes(candidate.fulfillment)
              : false;
      if (!deviceCanAttempt) return { job: null, reason: "device_unavailable" };

      let officialMsrp: OfficialMsrpAuthorization | null = null;
      try { officialMsrp = new OfficialMsrpRepository(this.db).validateJob(candidate.id, now); }
      catch (error) {
        if (!(error instanceof DomainRequestError)) throw error;
        this.signals.transitionJob(candidate.id, "cancelled", error.code, error.message, {}, now);
        return { job: null, reason: "no_jobs" };
      }
      const capabilityToken = randomBytes(32).toString("base64url");
      const leaseExpiresAt = nowIso(Math.min(new Date(candidate.expires_at).getTime(), now + LEASE_TTL_MS));
      this.signals.transitionJob(
        candidate.id,
        "leased",
        "device_lease",
        "A qualified paired Chrome device leased the action job.",
        { deviceId: safeDeviceId },
        now
      );
      this.db.run(
        `UPDATE action_jobs SET assigned_device_id = ?, capability_nonce_hash = ?,
           leased_at = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND state = 'leased'`,
        safeDeviceId,
        capabilityHash(capabilityToken),
        nowIso(now),
        leaseExpiresAt,
        nowIso(now),
        candidate.id
      );
      return {
        reason: "leased",
        job: {
          ...(officialMsrp ? { officialMsrp } : {}),
          contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
          adapterVersion: candidate.adapter_version,
          id: candidate.id,
          capabilityToken,
          state: "leased",
          action: candidate.action,
          quantity: Number(candidate.quantity),
          maxUnitPriceCents: Number(candidate.max_unit_price_cents),
          maxOrderTotalCents: Number(candidate.max_order_total_cents),
          currency: candidate.currency,
          sellerPolicy: candidate.seller_policy,
          expectedSeller: candidate.expected_seller,
          fulfillment: candidate.fulfillment,
          retailerId: candidate.retailer_id,
          retailerSku: candidate.retailer_sku,
          canonicalUrl: candidate.canonical_url,
          attributionUrl: candidate.attribution_url,
          attributionProvider: candidate.attribution_provider,
          attributionMetadata: attributionMetadata(candidate.attribution_metadata_json),
          expiresAt: candidate.expires_at,
          leaseExpiresAt
        }
      };
    });
  }

  reconcileJob(
    deviceId: string,
    jobId: string,
    capabilityToken: string,
    nextState: JobState,
    reasonCode: string,
    _message: string,
    evidence: Record<string, unknown>,
    now = Date.now()
  ): Record<string, unknown> {
    if (!CAPABILITY_PATTERN.test(capabilityToken)) throw new DomainConflictError("action_job_capability_invalid", "The action-job capability is invalid.");
    return this.db.transaction(() => {
      const job = this.db.get<{
        id: string;
        state: JobState;
        assigned_device_id: string;
        capability_nonce_hash: string;
        lease_expires_at: string;
        expires_at: string;
      }>(
        `SELECT id, state, assigned_device_id, capability_nonce_hash, lease_expires_at, expires_at
         FROM action_jobs WHERE id = ? AND user_id = ?`,
        cleanText(jobId, 120),
        currentRequestScope().userId
      );
      if (!job || job.assigned_device_id !== deviceId || job.capability_nonce_hash !== capabilityHash(capabilityToken)) {
        throw new DomainConflictError("action_job_capability_invalid", "The action-job capability is invalid.");
      }
      const leaseExpired = new Date(job.lease_expires_at).getTime() < now;
      if (leaseExpired && !jobMayHaveMutated(job.state)) throw new Error("The action-job lease expired before mutation.");
      if (!jobMayHaveMutated(job.state) && ["offer_verified", "add_authorized", "adding"].includes(nextState)) {
        const official = new OfficialMsrpRepository(this.db).validateJob(job.id, now);
        if (official && this.control.settings().actionsPaused) {
          throw new DomainConflictError("actions_paused", "Cart actions are paused; no new Add authorization is issued.");
        }
        if (official && this.control.settings().executionMode !== "live") {
          throw new DomainConflictError("shadow_mode", "Live cart actions are disabled; no new Add authorization is issued.");
        }
        if (official && nextState === "offer_verified" && (evidence.unitPriceCents !== official.unitPriceCents
          || evidence.retailerSku !== official.retailerSku || evidence.retailerId !== official.retailerId)) {
          throw new DomainConflictError("official_msrp_offer_changed", "The current retailer price or variant differs from the approved job.");
        }
      }
      const result = this.signals.transitionJob(
        job.id,
        nextState,
        REASON_PATTERN.test(String(reasonCode || "").toLocaleLowerCase("en-US"))
          ? String(reasonCode).toLocaleLowerCase("en-US")
          : "device_report",
        deviceStateMessage(nextState),
        deviceEvidence(evidence),
        now
      );
      const deviceFinished = jobIsTerminal(nextState)
        || nextState === "manual_review"
        || nextState === "submission_uncertain";
      if (deviceFinished) {
        this.db.run(
          "UPDATE action_jobs SET capability_nonce_hash = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?",
          stableHash(newId("retired_capability")),
          nowIso(now),
          nowIso(now),
          job.id
        );
      } else {
        this.db.run(
          "UPDATE action_jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ?",
          nowIso(Math.min(new Date(job.expires_at).getTime(), now + LEASE_TTL_MS)),
          nowIso(now),
          job.id
        );
      }
      return result;
    });
  }

  reconcileJobBatch(
    deviceId: string,
    jobId: string,
    capabilityToken: string,
    events: JobProgressInput[],
    now = Date.now()
  ): { job: Record<string, unknown>; applied: number } {
    if (!Array.isArray(events) || events.length < 1 || events.length > 20) {
      throw new InputValidationError("A progress batch must contain 1 through 20 ordered events.");
    }
    return this.db.transaction(() => {
      let job: Record<string, unknown> = {};
      let applied = 0;
      for (const event of events) {
        if (!event || !JOB_STATES_FOR_REPORT.has(event.state)) {
          throw new InputValidationError("The action-job progress batch contains an invalid state.");
        }
        job = this.reconcileJob(
          deviceId,
          jobId,
          capabilityToken,
          event.state,
          event.reasonCode,
          event.message,
          event.evidence,
          now + applied
        );
        applied += 1;
      }
      return { job, applied };
    });
  }

  heartbeatJob(
    deviceId: string,
    jobId: string,
    capabilityToken: string,
    now = Date.now()
  ): { jobId: string; state: JobState; leaseExpiresAt: string; remainingBudgetMs: number } {
    if (!CAPABILITY_PATTERN.test(capabilityToken)) throw new DomainConflictError("action_job_capability_invalid", "The action-job capability is invalid.");
    const job = this.db.get<{
      id: string;
      state: JobState;
      assigned_device_id: string;
      capability_nonce_hash: string;
      expires_at: string;
    }>(
      `SELECT id, state, assigned_device_id, capability_nonce_hash, expires_at
       FROM action_jobs WHERE id = ? AND user_id = ?`,
      cleanText(jobId, 120), currentRequestScope().userId
    );
    if (!job || job.assigned_device_id !== cleanText(deviceId, 120)
      || job.capability_nonce_hash !== capabilityHash(capabilityToken)
      || jobIsTerminal(job.state)) {
      throw new DomainConflictError("action_job_capability_invalid", "The action-job capability is invalid.");
    }
    const budgetEnd = new Date(job.expires_at).getTime();
    if (!Number.isFinite(budgetEnd) || budgetEnd <= now) {
      throw new Error("The action-job execution budget has expired.");
    }
    const leaseExpiresAt = nowIso(Math.min(budgetEnd, now + LEASE_TTL_MS));
    this.db.run(
      `UPDATE action_jobs SET lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND assigned_device_id = ?`,
      leaseExpiresAt, nowIso(now), job.id, currentRequestScope().userId, deviceId
    );
    return {
      jobId: job.id,
      state: job.state,
      leaseExpiresAt,
      remainingBudgetMs: Math.max(0, Math.round(budgetEnd - now))
    };
  }
}

const JOB_STATES_FOR_REPORT = new Set<JobState>([
  "navigating", "verifying_listing", "offer_verified", "add_authorized", "adding",
  "cart_verified", "confirmed", "offer_rejected", "cancelled", "manual_review",
  "submission_uncertain"
]);
