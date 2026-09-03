import type { RetailerSessionReadinessInput } from "../../contracts/src/action-platform.js";
import { WATCH_QUEUE_CONTRACT_VERSION } from "../../contracts/src/action-platform.js";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { ShadowObservationRepository } from "./shadow-observation-repository.js";

const ACTION_RETAILERS = ["target", "walmart", "amazon", "bestbuy"] as const;
type ActionRetailer = typeof ACTION_RETAILERS[number];
const QUALIFICATION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const QUALIFICATION_WARNING_MS = 7 * 24 * 60 * 60_000;
const BASELINE_MAX_AGE_MS = 5 * 60_000;
export const RETAILER_SESSION_MAX_AGE_MS = 5 * 60_000;
export const RETAILER_SESSION_FUTURE_TOLERANCE_MS = 5 * 60_000;

const LANE_VERSIONS: Record<ActionRetailer, { add: string; observer: string }> = {
  target: { add: TARGET_ADD_ADAPTER_VERSION, observer: TARGET_OBSERVER_VERSION },
  walmart: { add: WALMART_ADD_ADAPTER_VERSION, observer: WALMART_OBSERVER_VERSION },
  amazon: { add: AMAZON_ADD_ADAPTER_VERSION, observer: AMAZON_OBSERVER_VERSION },
  bestbuy: { add: BESTBUY_ADD_ADAPTER_VERSION, observer: BESTBUY_OBSERVER_VERSION }
};

export interface ReadinessRow {
  deviceId: string;
  retailerId: ActionRetailer;
  signedInState: "unknown" | "ready" | "signed_out" | "challenged";
  cartBaselineState: "unknown" | "ready" | "stale" | "unavailable";
  baselineObservedAt: string;
  expiresAt: string;
  adapterVersion: string;
  lastErrorCode: string;
  updatedAt: string;
}

export function retailerSessionBlocksGuardedAdd(
  session: Pick<ReadinessRow, "signedInState" | "adapterVersion" | "updatedAt"> | null,
  expectedAdapterVersion: string,
  deviceActive: boolean,
  now = Date.now()
): boolean {
  if (!session || !deviceActive || session.adapterVersion !== expectedAdapterVersion) return false;
  if (session.signedInState !== "signed_out" && session.signedInState !== "challenged") return false;
  const updatedAt = new Date(session.updatedAt).getTime();
  return Number.isFinite(updatedAt)
    && updatedAt >= now - RETAILER_SESSION_MAX_AGE_MS
    && updatedAt <= now + RETAILER_SESSION_FUTURE_TOLERANCE_MS;
}

interface QualificationRow {
  adapterVersion: string;
  highestAction: string;
  status: "qualified" | "suspended" | "retired";
  qualifiedAt: string;
  expiresAt: string;
}

export type RequalificationCoverage =
  | "first_party_actionable"
  | "shipping_actionable"
  | "pickup_actionable"
  | "offer_route_ready"
  | "pre_click_rehearsal";

export interface RequalificationCandidate {
  retailerSku: string;
  canonicalUrl: string;
  title: string;
  trialObservedAt: string;
  source: "evidence_history" | "repair_queue" | "catalog";
  qualificationTypes: RequalificationCoverage[];
  currentObserverEvidence: boolean;
  currentRehearsalPassed: boolean;
  priorRehearsalPassed: boolean;
  repairableObserverFailure: boolean;
}

export interface RequalificationEvidence {
  liveEvidenceReady: boolean;
  rehearsalReady: boolean;
  qualificationEvidenceReady: boolean;
  distinctSkuCount: number;
  checks: Array<{
    id: string;
    observed: number;
    required: number;
    requiredForQualification: boolean;
    met: boolean;
  }>;
}

export interface RetailerLaneReadiness {
  retailerId: ActionRetailer;
  expectedAdapterVersion: string;
  expectedObserverVersion: string;
  qualification: {
    status: "qualified" | "suspended" | "retired" | "missing";
    currentVersion: boolean;
    qualifiedAt: string;
    expiresAt: string;
    expiresInMs: number | null;
    warning: "none" | "expiring" | "expired" | "version_changed";
  };
  session: ReadinessRow | null;
  candidate: RequalificationCandidate | null;
  candidates: RequalificationCandidate[];
  evidence: RequalificationEvidence;
  automaticCheckNeeded: boolean;
  checklist: Array<{ id: string; ready: boolean; label: string }>;
  readyForGuardedAdd: boolean;
  readyForWarmObservation: boolean;
}

export interface RetailerSessionBlocker {
  deviceId: string;
  retailerId: ActionRetailer;
  signedInState: "signed_out" | "challenged";
  updatedAt: string;
}

function actionRetailer(value: unknown): ActionRetailer {
  const normalized = cleanText(value, 40).toLocaleLowerCase("en-US") as ActionRetailer;
  if (!ACTION_RETAILERS.includes(normalized)) throw new Error("A supported store is required.");
  return normalized;
}

function exactTimestamp(value: unknown, optional = false): { iso: string; time: number } | null {
  const normalized = cleanText(value, 40);
  if (!normalized && optional) return null;
  const parsed = new Date(normalized);
  const time = parsed.getTime();
  if (!Number.isFinite(time)) throw new Error("A valid retailer-readiness timestamp is required.");
  return { iso: parsed.toISOString(), time };
}

function safeErrorCode(value: unknown): string {
  return cleanText(value, 80).toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

export class RetailerReadinessRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  record(deviceId: string, input: RetailerSessionReadinessInput, now = Date.now()): ReadinessRow {
    if (input?.contractVersion !== WATCH_QUEUE_CONTRACT_VERSION) {
      throw new Error("The retailer-readiness contract version is unsupported.");
    }
    const retailerId = actionRetailer(input.retailerId);
    const safeDeviceId = cleanText(deviceId, 120);
    const scope = currentRequestScope();
    const device = this.db.get<{ id: string }>(
      `SELECT id FROM extension_devices
       WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'active'`,
      safeDeviceId, scope.tenantId, scope.userId
    );
    if (!device) throw new Error("The paired device is unavailable.");
    if (!(["unknown", "ready", "signed_out", "challenged"] as const).includes(input.signedInState)) {
      throw new Error("The retailer signed-in state is invalid.");
    }
    if (!(["unknown", "ready", "stale", "unavailable"] as const).includes(input.cartBaselineState)) {
      throw new Error("The cart-baseline state is invalid.");
    }
    const baseline = exactTimestamp(input.baselineObservedAt, true);
    const expires = exactTimestamp(input.expiresAt, true);
    if (input.cartBaselineState === "ready") {
      if (!baseline || !expires || baseline.time > now + 5 * 60_000
        || now - baseline.time > BASELINE_MAX_AGE_MS
        || expires.time <= now || expires.time > baseline.time + BASELINE_MAX_AGE_MS) {
        throw new Error("A ready cart baseline must carry a fresh bounded five-minute lifetime.");
      }
    }
    const timestamp = nowIso(now);
    this.db.run(
      `INSERT INTO retailer_session_readiness(
         tenant_id, user_id, device_id, retailer_id, signed_in_state,
         cart_baseline_state, baseline_observed_at, expires_at, adapter_version,
         last_error_code, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, user_id, device_id, retailer_id) DO UPDATE SET
         signed_in_state = excluded.signed_in_state,
         cart_baseline_state = excluded.cart_baseline_state,
         baseline_observed_at = excluded.baseline_observed_at,
         expires_at = excluded.expires_at,
         adapter_version = excluded.adapter_version,
         last_error_code = excluded.last_error_code,
         updated_at = excluded.updated_at`,
      scope.tenantId, scope.userId, safeDeviceId, retailerId, input.signedInState,
      input.cartBaselineState, baseline?.iso ?? "", expires?.iso ?? "",
      cleanText(input.adapterVersion, 80), safeErrorCode(input.errorCode), timestamp
    );
    return this.session(retailerId, safeDeviceId) as ReadinessRow;
  }

  lanes(now = Date.now()): RetailerLaneReadiness[] {
    return ACTION_RETAILERS.map((retailerId) => this.lane(retailerId, now));
  }

  freshSessionBlockers(now = Date.now()): RetailerSessionBlocker[] {
    const scope = currentRequestScope();
    return this.db.all<ReadinessRow>(
      `SELECT readiness.device_id AS deviceId, readiness.retailer_id AS retailerId,
              readiness.signed_in_state AS signedInState,
              readiness.cart_baseline_state AS cartBaselineState,
              readiness.baseline_observed_at AS baselineObservedAt,
              readiness.expires_at AS expiresAt,
              readiness.adapter_version AS adapterVersion,
              readiness.last_error_code AS lastErrorCode,
              readiness.updated_at AS updatedAt
       FROM retailer_session_readiness readiness
       JOIN extension_devices device ON device.id = readiness.device_id
       WHERE readiness.tenant_id = ? AND readiness.user_id = ?
         AND device.tenant_id = readiness.tenant_id AND device.user_id = readiness.user_id
         AND device.status = 'active'
         AND readiness.signed_in_state IN ('signed_out', 'challenged')
         AND readiness.updated_at >= ? AND readiness.updated_at <= ?
       ORDER BY readiness.updated_at DESC, readiness.device_id, readiness.retailer_id`,
      scope.tenantId,
      scope.userId,
      nowIso(now - RETAILER_SESSION_MAX_AGE_MS),
      nowIso(now + RETAILER_SESSION_FUTURE_TOLERANCE_MS)
    ).flatMap((row) => row.adapterVersion === LANE_VERSIONS[row.retailerId].add
      ? [{
          deviceId: row.deviceId,
          retailerId: row.retailerId,
          signedInState: row.signedInState as "signed_out" | "challenged",
          updatedAt: row.updatedAt
        }]
      : []);
  }

  lane(retailerValue: string, now = Date.now()): RetailerLaneReadiness {
    const retailerId = actionRetailer(retailerValue);
    const versions = LANE_VERSIONS[retailerId];
    const scope = currentRequestScope();
    const qualification = this.db.get<QualificationRow>(
      `SELECT adapter_version AS adapterVersion, highest_action AS highestAction,
              status, qualified_at AS qualifiedAt, expires_at AS expiresAt
       FROM retailer_adapter_qualifications
       WHERE tenant_id = ? AND user_id = ? AND retailer_id = ?`,
      scope.tenantId, scope.userId, retailerId
    );
    const session = this.session(retailerId);
    const candidates = this.requalificationCandidates(retailerId, versions, now);
    const candidate = candidates[0] ?? null;
    const evidence = this.qualificationEvidence(retailerId, now);
    const expirationTime = qualification?.expiresAt
      ? new Date(qualification.expiresAt).getTime()
      : qualification?.qualifiedAt
        ? new Date(qualification.qualifiedAt).getTime() + QUALIFICATION_LIFETIME_MS
        : Number.NaN;
    const currentVersion = qualification?.adapterVersion === versions.add;
    const qualified = qualification?.status === "qualified" && currentVersion
      && Number.isFinite(expirationTime) && expirationTime > now;
    const expiresInMs = Number.isFinite(expirationTime) ? Math.round(expirationTime - now) : null;
    const warning = !qualification ? "none"
      : !currentVersion ? "version_changed"
        : Number.isFinite(expirationTime) && expirationTime <= now ? "expired"
          : Number.isFinite(expirationTime) && expirationTime <= now + QUALIFICATION_WARNING_MS ? "expiring"
            : "none";
    const automaticCheckNeeded = candidates.length > 0 && (
      warning === "expiring"
      || ((!qualified || warning === "expired" || warning === "version_changed")
        && !evidence.qualificationEvidenceReady)
    );
    const activeDevice = Boolean(this.db.get<{ id: string }>(
      `SELECT id FROM extension_devices
       WHERE tenant_id = ? AND user_id = ? AND status = 'active' AND last_seen_at >= ?
       ORDER BY last_seen_at DESC LIMIT 1`,
      scope.tenantId, scope.userId, nowIso(now - 5 * 60_000)
    ));
    const sessionDeviceActive = Boolean(session && this.db.get<{ id: string }>(
      `SELECT id FROM extension_devices
       WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'active'
         AND last_seen_at >= ?`,
      session.deviceId, scope.tenantId, scope.userId, nowIso(now - RETAILER_SESSION_MAX_AGE_MS)
    ));
    const sessionUpdatedAt = session?.updatedAt ? new Date(session.updatedAt).getTime() : Number.NaN;
    const sessionFresh = sessionDeviceActive && Number.isFinite(sessionUpdatedAt)
      && sessionUpdatedAt >= now - RETAILER_SESSION_MAX_AGE_MS
      && sessionUpdatedAt <= now + RETAILER_SESSION_FUTURE_TOLERANCE_MS;
    const signedIn = sessionFresh && session?.signedInState === "ready"
      && session.adapterVersion === versions.add;
    const baselineObservedAt = session?.baselineObservedAt
      ? new Date(session.baselineObservedAt).getTime()
      : Number.NaN;
    const baselineExpiresAt = session?.expiresAt ? new Date(session.expiresAt).getTime() : Number.NaN;
    const warmBaseline = sessionFresh && session?.cartBaselineState === "ready"
      && Number.isFinite(baselineObservedAt)
      && baselineObservedAt >= now - BASELINE_MAX_AGE_MS
      && baselineObservedAt <= now + 5 * 60_000
      && Number.isFinite(baselineExpiresAt)
      && baselineExpiresAt > now
      && baselineExpiresAt <= baselineObservedAt + BASELINE_MAX_AGE_MS
      && session.adapterVersion === versions.add;
    const sessionBlocksAdd = retailerSessionBlocksGuardedAdd(
      session,
      versions.add,
      sessionDeviceActive,
      now
    );
    const checklist = [
      { id: "qualification", ready: qualified, label: qualified ? "Store checks passed" : "Store checks need a refresh" },
      { id: "device", ready: activeDevice, label: activeDevice ? "Chrome companion online" : "Chrome companion offline" },
      { id: "signed_in", ready: signedIn, label: signedIn ? "Signed in to the store in Chrome" : "Sign in to the store in Chrome" },
      { id: "cart_baseline", ready: warmBaseline, label: warmBaseline ? "Cart warmed up" : "Cart not warmed up yet" }
    ];
    return {
      retailerId,
      expectedAdapterVersion: versions.add,
      expectedObserverVersion: versions.observer,
      qualification: {
        status: qualification?.status ?? "missing",
        currentVersion,
        qualifiedAt: qualification?.qualifiedAt ?? "",
        expiresAt: Number.isFinite(expirationTime) ? new Date(expirationTime).toISOString() : "",
        expiresInMs,
        warning
      },
      session,
      candidate,
      candidates,
      evidence,
      automaticCheckNeeded,
      checklist,
      readyForGuardedAdd: qualified && activeDevice && !sessionBlocksAdd,
      readyForWarmObservation: activeDevice && signedIn
    };
  }

  reverifyPlan(now = Date.now()): { createdAt: string; lanes: RetailerLaneReadiness[] } {
    return { createdAt: nowIso(now), lanes: this.lanes(now) };
  }

  private qualificationEvidence(retailerId: ActionRetailer, now: number): RequalificationEvidence {
    const observations = new ShadowObservationRepository(this.db);
    const readiness = retailerId === "target" ? observations.targetQualificationReadiness(now)
      : retailerId === "walmart" ? observations.walmartQualificationReadiness(now)
        : retailerId === "amazon" ? observations.amazonQualificationReadiness(now)
          : observations.bestBuyQualificationReadiness(now);
    return {
      liveEvidenceReady: readiness.liveEvidenceReady,
      rehearsalReady: readiness.rehearsalReady,
      qualificationEvidenceReady: readiness.qualificationEvidenceReady,
      distinctSkuCount: readiness.distinctSkuCount,
      checks: readiness.checks.map((check) => ({
        id: check.id,
        observed: check.observed,
        required: check.required,
        requiredForQualification: check.requiredForQualification,
        met: check.met
      }))
    };
  }

  private requalificationCandidates(
    retailerId: ActionRetailer,
    versions: { add: string; observer: string },
    now: number
  ): RequalificationCandidate[] {
    const scope = currentRequestScope();
    const cutoff = nowIso(now - QUALIFICATION_LIFETIME_MS);
    const rows = this.db.all<{
      retailerSku: string;
      canonicalUrl: string;
      title: string;
      trialObservedAt: string;
      firstPartyActionable: number;
      shippingActionable: number;
      pickupActionable: number;
      offerRouteReady: number;
      currentObserverEvidence: number;
      currentRehearsalPassed: number;
      priorRehearsalPassed: number;
      repairableObserverFailure: number;
    }>(
      `WITH candidate_history AS (
       SELECT observation.retailer_sku AS retailerSku,
              MAX(observation.canonical_url) AS canonicalUrl,
              COALESCE(MAX(variant.title), '') AS title,
              MAX(observation.observed_at) AS trialObservedAt,
              MAX(CASE WHEN observation.observation_state = 'actionable_candidate'
                         AND observation.availability = 'in_stock'
                         AND observation.seller_type = 'first_party'
                         AND observation.add_control_actionable = 1 THEN 1 ELSE 0 END) AS firstPartyActionable,
              MAX(CASE WHEN observation.observation_state = 'actionable_candidate'
                         AND observation.availability = 'in_stock'
                         AND observation.fulfillment = 'shipping'
                         AND observation.add_control_actionable = 1 THEN 1 ELSE 0 END) AS shippingActionable,
              MAX(CASE WHEN observation.observation_state = 'actionable_candidate'
                         AND observation.availability = 'in_stock'
                         AND observation.fulfillment = 'pickup'
                         AND observation.add_control_actionable = 1 THEN 1 ELSE 0 END) AS pickupActionable,
              MAX(CASE WHEN observation.observation_state = 'actionable_candidate'
                         AND observation.availability = 'in_stock'
                         AND observation.purchase_route_ready = 1 THEN 1 ELSE 0 END) AS offerRouteReady,
              MAX(CASE WHEN observation.adapter_version = ?
                         AND observation.observation_state = 'actionable_candidate'
                         AND observation.availability = 'in_stock'
                         AND observation.observed_at >= ? THEN 1 ELSE 0 END) AS currentObserverEvidence,
              MAX(CASE WHEN trial.outcome = 'passed' AND trial.adapter_version = ?
                         AND trial.observed_at >= ? THEN 1 ELSE 0 END) AS currentRehearsalPassed,
              MAX(CASE WHEN trial.outcome = 'passed' THEN 1 ELSE 0 END) AS priorRehearsalPassed,
              CASE WHEN (
                SELECT diagnostic.outcome
                FROM retailer_adapter_diagnostics diagnostic
                WHERE diagnostic.tenant_id = observation.tenant_id
                  AND diagnostic.user_id = observation.user_id
                  AND diagnostic.retailer_id = observation.retailer_id
                  AND diagnostic.retailer_sku = observation.retailer_sku
                  AND diagnostic.operation = 'observe'
                  AND diagnostic.received_at >= ?
                ORDER BY diagnostic.received_at DESC, diagnostic.id DESC
                LIMIT 1
              ) = 'failed' THEN 1 ELSE 0 END AS repairableObserverFailure
       FROM retailer_shadow_observations observation
       LEFT JOIN listings listing ON listing.retailer_id = observation.retailer_id
         AND listing.retailer_sku = observation.retailer_sku
       LEFT JOIN variants variant ON variant.id = listing.variant_id
       LEFT JOIN retailer_adapter_trials trial
         ON trial.shadow_observation_id = observation.id
        AND trial.tenant_id = observation.tenant_id
        AND trial.user_id = observation.user_id
       WHERE observation.tenant_id = ? AND observation.user_id = ?
         AND observation.retailer_id = ?
         AND observation.canonical_url <> ''
       GROUP BY observation.retailer_sku
       )
       SELECT * FROM candidate_history
       WHERE priorRehearsalPassed = 1
          OR firstPartyActionable = 1
          OR shippingActionable = 1
          OR pickupActionable = 1
          OR repairableObserverFailure = 1
       ORDER BY currentRehearsalPassed DESC,
                currentObserverEvidence DESC,
                priorRehearsalPassed DESC,
                shippingActionable DESC,
                firstPartyActionable DESC,
                repairableObserverFailure DESC,
                trialObservedAt DESC,
                retailerSku
       LIMIT 8`,
      versions.observer,
      cutoff,
      versions.add,
      cutoff,
      cutoff,
      scope.tenantId,
      scope.userId,
      retailerId
    );
    const candidates: RequalificationCandidate[] = rows.map((row) => ({
      retailerSku: row.retailerSku,
      canonicalUrl: row.canonicalUrl,
      title: row.title,
      trialObservedAt: row.trialObservedAt,
      source: row.repairableObserverFailure === 1
        && row.firstPartyActionable !== 1
        && row.shippingActionable !== 1
        && row.pickupActionable !== 1
        && row.priorRehearsalPassed !== 1
        ? "repair_queue" : "evidence_history",
      qualificationTypes: [
        ...(row.firstPartyActionable === 1 ? ["first_party_actionable" as const] : []),
        ...(row.shippingActionable === 1 ? ["shipping_actionable" as const] : []),
        ...(row.pickupActionable === 1 ? ["pickup_actionable" as const] : []),
        ...(row.offerRouteReady === 1 ? ["offer_route_ready" as const] : []),
        ...(row.priorRehearsalPassed === 1 ? ["pre_click_rehearsal" as const] : [])
      ],
      currentObserverEvidence: row.currentObserverEvidence === 1,
      currentRehearsalPassed: row.currentRehearsalPassed === 1,
      priorRehearsalPassed: row.priorRehearsalPassed === 1,
      repairableObserverFailure: row.repairableObserverFailure === 1
    }));
    if (candidates.length >= 8) return candidates;
    const catalogRows = this.db.all<{
      retailerSku: string;
      canonicalUrl: string;
      title: string;
      updatedAt: string;
      userRelevant: number;
    }>(
      `SELECT listing.retailer_sku AS retailerSku,
              listing.canonical_url AS canonicalUrl,
              variant.title,
              listing.updated_at AS updatedAt,
              CASE WHEN EXISTS (
                SELECT 1 FROM mission_targets target
                JOIN missions mission ON mission.id = target.mission_id
                WHERE target.listing_id = listing.id
                  AND target.enabled = 1
                  AND mission.tenant_id = ? AND mission.user_id = ?
                  AND mission.status = 'active'
              ) THEN 1 ELSE 0 END AS userRelevant
       FROM listings listing
       JOIN variants variant ON variant.id = listing.variant_id
       WHERE listing.retailer_id = ?
         AND listing.status = 'in_stock'
         AND listing.canonical_url <> ''
       ORDER BY userRelevant DESC, listing.updated_at DESC, listing.retailer_sku
       LIMIT 16`,
      scope.tenantId,
      scope.userId,
      retailerId
    );
    for (const row of catalogRows) {
      if (candidates.length >= 8) break;
      if (candidates.some((candidate) => candidate.retailerSku === row.retailerSku)) continue;
      candidates.push({
        retailerSku: row.retailerSku,
        canonicalUrl: row.canonicalUrl,
        title: row.title,
        trialObservedAt: row.updatedAt,
        source: "catalog",
        qualificationTypes: [],
        currentObserverEvidence: false,
        currentRehearsalPassed: false,
        priorRehearsalPassed: false,
        repairableObserverFailure: false
      });
    }
    return candidates;
  }

  retireLane(retailerValue: string, reason: unknown, now = Date.now()): RetailerLaneReadiness {
    const retailerId = actionRetailer(retailerValue);
    const reasonCode = safeErrorCode(reason) || "operator_retired";
    const scope = currentRequestScope();
    this.db.transaction(() => {
      this.db.run(
        `UPDATE retailer_adapter_qualifications
         SET status = 'retired', updated_at = ?
         WHERE tenant_id = ? AND user_id = ? AND retailer_id = ?`,
        nowIso(now), scope.tenantId, scope.userId, retailerId
      );
      this.audit.record({
        correlationId: retailerId,
        aggregateType: "retailer_qualification",
        eventType: "retailer_lane_retired",
        reasonCode,
        message: "One store was retired without changing the other stores.",
        data: { retailerId, scope: "single_lane" }
      }, now);
    });
    return this.lane(retailerId, now);
  }

  private session(retailerId: ActionRetailer, deviceId = ""): ReadinessRow | null {
    const scope = currentRequestScope();
    return this.db.get<ReadinessRow>(
      `SELECT device_id AS deviceId, retailer_id AS retailerId,
              signed_in_state AS signedInState, cart_baseline_state AS cartBaselineState,
              baseline_observed_at AS baselineObservedAt, expires_at AS expiresAt,
              adapter_version AS adapterVersion, last_error_code AS lastErrorCode,
              updated_at AS updatedAt
       FROM retailer_session_readiness
       WHERE tenant_id = ? AND user_id = ? AND retailer_id = ?
         AND (? = '' OR device_id = ?)
       ORDER BY updated_at DESC LIMIT 1`,
      scope.tenantId, scope.userId, retailerId, deviceId, deviceId
    ) ?? null;
  }
}
