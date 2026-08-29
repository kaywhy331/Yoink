import { randomBytes } from "node:crypto";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
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
const ACTION_RANK: Record<string, number> = {
  notify: 0,
  add_to_cart: 1,
  prepare_checkout: 2,
  submit_order: 3
};

export type NoLeaseReason = "shadow_mode" | "actions_paused" | "device_unavailable" | "device_busy" | "no_jobs" | "adapter_unqualified";

export interface JobLease {
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
  expires_at: string;
}

interface ExpiredLeaseRow {
  id: string;
  state: JobState;
}

function capabilityHash(token: string): string {
  return stableHash("yoink-job-capability-v1", token);
}

function adapterAllows(action: string, highestAction: string): boolean {
  return Number(ACTION_RANK[highestAction] ?? -1) >= Number(ACTION_RANK[action] ?? 99);
}

function deviceEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (["target", "walmart", "amazon", "bestbuy"].includes(String(value.retailerId))) output.retailerId = value.retailerId;
  if (typeof value.retailerSku === "string"
    && ((value.retailerId === "target" && /^\d{6,20}$/.test(value.retailerSku))
      || (value.retailerId === "walmart" && /^\d{5,20}$/.test(value.retailerSku))
      || (value.retailerId === "amazon" && /^[A-Z0-9]{10}$/.test(value.retailerSku))
      || (value.retailerId === "bestbuy" && /^\d{5,20}$/.test(value.retailerSku)))) {
    output.retailerSku = value.retailerSku;
  }
  if (Number.isSafeInteger(value.unitPriceCents) && Number(value.unitPriceCents) > 0) output.unitPriceCents = Number(value.unitPriceCents);
  if (Number.isSafeInteger(value.allInTotalCents) && Number(value.allInTotalCents) > 0) output.allInTotalCents = Number(value.allInTotalCents);
  if (Number.isSafeInteger(value.orderTotalCents) && Number(value.orderTotalCents) > 0) output.orderTotalCents = Number(value.orderTotalCents);
  if (value.currency === "USD") output.currency = "USD";
  if (["first_party", "third_party", "unknown"].includes(String(value.sellerType))) output.sellerType = value.sellerType;
  if (["shipping", "pickup", "unknown"].includes(String(value.fulfillment))) output.fulfillment = value.fulfillment;
  if (Number.isInteger(value.quantity) && Number(value.quantity) >= 1 && Number(value.quantity) <= 99) output.quantity = Number(value.quantity);
  return output;
}

function deviceStateMessage(state: JobState): string {
  const messages: Partial<Record<JobState, string>> = {
    navigating: "Chrome started the retailer navigation and empty-cart preflight.",
    verifying_listing: "Chrome started exact live listing verification.",
    offer_verified: "Chrome verified the live offer against the immutable action contract.",
    add_authorized: "Chrome prepared the exact add control for final revalidation.",
    adding: "Chrome armed the durable add receipt before crossing the click boundary.",
    cart_verified: "Chrome verified one exact cart line after the add boundary.",
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

  leaseNextJob(deviceId: string, now = Date.now()): LeaseResult {
    const settings = this.control.settings();
    if (settings.executionMode !== "live") return { job: null, reason: "shadow_mode" };
    if (settings.actionsPaused) return { job: null, reason: "actions_paused" };

    return this.db.transaction(() => {
      this.recoverExpiredLeases(now);
      this.expirePendingJobs(now);
      this.spendLedger.releaseExpired(now);
      const device = this.db.get<{ capabilities_json: string }>(
        "SELECT capabilities_json FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
        cleanText(deviceId, 120),
        currentRequestScope().userId
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
        deviceId
      );
      if (active) return { job: null, reason: "device_busy" };

      const targetAddCapable = capabilities.targetAddOnly === true
        && capabilities.targetAddAdapterVersion === TARGET_ADD_ADAPTER_VERSION;
      const walmartAddCapable = capabilities.walmartAddOnly === true
        && capabilities.walmartAddAdapterVersion === WALMART_ADD_ADAPTER_VERSION;
      const amazonAddCapable = capabilities.amazonAddOnly === true
        && capabilities.amazonAddAdapterVersion === AMAZON_ADD_ADAPTER_VERSION;
      const bestBuyAddCapable = capabilities.bestBuyAddOnly === true
        && capabilities.bestBuyAddAdapterVersion === BESTBUY_ADD_ADAPTER_VERSION;
      if (!targetAddCapable && !walmartAddCapable && !amazonAddCapable && !bestBuyAddCapable) {
        return { job: null, reason: "device_unavailable" };
      }

      const candidate = this.db.get<CandidateRow>(
        `SELECT aj.id, aj.action, aj.quantity,
                aj.max_unit_price_cents, aj.max_order_total_cents, aj.currency,
                aj.seller_policy, aj.expected_seller, aj.fulfillment,
                l.retailer_id, l.retailer_sku, aj.canonical_url,
                aj.attribution_url, aj.attribution_provider,
                aj.attribution_metadata_json, aj.expires_at
         FROM action_jobs aj
         JOIN listings l ON l.id = aj.listing_id
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
             OR ? = 1 AND l.retailer_id = 'bestbuy' AND aj.action = 'add_to_cart'
               AND aj.quantity = 1 AND aj.seller_policy = 'first_party_only'
               AND aj.fulfillment IN ('shipping', 'pickup')
           )
         ORDER BY aj.created_at LIMIT 1`,
        currentRequestScope().userId,
        nowIso(now),
        nowIso(now),
        targetAddCapable ? 1 : 0,
        walmartAddCapable ? 1 : 0,
        amazonAddCapable ? 1 : 0,
        bestBuyAddCapable ? 1 : 0
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
            : candidate.retailer_id === "bestbuy"
              ? bestBuyAddCapable
                && candidate.action === "add_to_cart"
                && Number(candidate.quantity) === 1
                && candidate.seller_policy === "first_party_only"
                && ["shipping", "pickup"].includes(candidate.fulfillment)
              : false;
      if (!deviceCanAttempt) return { job: null, reason: "device_unavailable" };

      const qualification = this.db.get<{ adapter_version: string; highest_action: string }>(
        `SELECT adapter_version, highest_action FROM retailer_adapter_qualifications
         WHERE user_id = ? AND retailer_id = ? AND status = 'qualified'`,
        currentRequestScope().userId,
        candidate.retailer_id
      );
      if (!qualification || !adapterAllows(candidate.action, qualification.highest_action)) {
        return { job: null, reason: "adapter_unqualified" };
      }
      if (candidate.retailer_id === "target" && qualification.adapter_version !== TARGET_ADD_ADAPTER_VERSION) {
        return { job: null, reason: "adapter_unqualified" };
      }
      if (candidate.retailer_id === "walmart" && qualification.adapter_version !== WALMART_ADD_ADAPTER_VERSION) {
        return { job: null, reason: "adapter_unqualified" };
      }
      if (candidate.retailer_id === "amazon" && qualification.adapter_version !== AMAZON_ADD_ADAPTER_VERSION) {
        return { job: null, reason: "adapter_unqualified" };
      }
      if (candidate.retailer_id === "bestbuy" && qualification.adapter_version !== BESTBUY_ADD_ADAPTER_VERSION) {
        return { job: null, reason: "adapter_unqualified" };
      }

      const capabilityToken = randomBytes(32).toString("base64url");
      const leaseExpiresAt = nowIso(now + LEASE_TTL_MS);
      this.signals.transitionJob(
        candidate.id,
        "leased",
        "device_lease",
        "A qualified paired Chrome device leased the action job.",
        { deviceId },
        now
      );
      this.db.run(
        `UPDATE action_jobs SET assigned_device_id = ?, capability_nonce_hash = ?,
           leased_at = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND state = 'leased'`,
        deviceId,
        capabilityHash(capabilityToken),
        nowIso(now),
        leaseExpiresAt,
        nowIso(now),
        candidate.id
      );
      return {
        reason: "leased",
        job: {
          contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
          adapterVersion: qualification.adapter_version,
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
    if (!CAPABILITY_PATTERN.test(capabilityToken)) throw new Error("The action-job capability is invalid.");
    return this.db.transaction(() => {
      const job = this.db.get<{
        id: string;
        state: JobState;
        assigned_device_id: string;
        capability_nonce_hash: string;
        lease_expires_at: string;
      }>(
        `SELECT id, state, assigned_device_id, capability_nonce_hash, lease_expires_at
         FROM action_jobs WHERE id = ? AND user_id = ?`,
        cleanText(jobId, 120),
        currentRequestScope().userId
      );
      if (!job || job.assigned_device_id !== deviceId || job.capability_nonce_hash !== capabilityHash(capabilityToken)) {
        throw new Error("The action-job capability is invalid.");
      }
      const leaseExpired = new Date(job.lease_expires_at).getTime() < now;
      if (leaseExpired && !jobMayHaveMutated(job.state)) throw new Error("The action-job lease expired before mutation.");
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
      if (jobIsTerminal(nextState)) {
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
          nowIso(now + LEASE_TTL_MS),
          nowIso(now),
          job.id
        );
      }
      return result;
    });
  }
}
