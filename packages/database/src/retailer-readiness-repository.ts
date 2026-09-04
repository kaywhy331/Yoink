import type { RetailerSessionReadinessInput } from "../../contracts/src/action-platform.js";
import { WATCH_QUEUE_CONTRACT_VERSION } from "../../contracts/src/action-platform.js";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  AMAZON_OBSERVER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  RETAILER_REVERIFICATION_RUN_CONTRACT_VERSION,
  RETAILER_REVERIFICATION_RUN_MAX_PRODUCTS,
  RETAILER_REVERIFICATION_RUN_OUTCOMES,
  RETAILER_REVERIFICATION_RUN_TRIGGERS,
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_OBSERVER_VERSION,
  type RetailerReverificationRunInput,
  type RetailerReverificationRunOutcome,
  type RetailerReverificationRunTrigger,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import {
  AdapterDiagnosticRepository,
  laneDegradation,
  type AdapterRepairQueueItem,
  type LaneDegradationReason
} from "./adapter-diagnostic-repository.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { ShadowObservationRepository } from "./shadow-observation-repository.js";

const ACTION_RETAILERS = ["target", "walmart", "amazon", "bestbuy"] as const;
type ActionRetailer = typeof ACTION_RETAILERS[number];
const QUALIFICATION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const QUALIFICATION_WARNING_MS = 7 * 24 * 60 * 60_000;
const BASELINE_MAX_AGE_MS = 5 * 60_000;
const MAX_CANDIDATES = 8;
// When a lane still needs a passing no-click rehearsal, keep room for
// products that can actually be rehearsed today: a sold-out history can never
// rebuild the evidence ladder on its own.
const PURCHASABLE_CANDIDATE_RESERVE = 2;
const RUN_RECEIPT_MAX_AGE_MS = 10 * 60_000;
const RUN_RECEIPT_CLOCK_SKEW_MS = 5 * 60_000;
const RUN_RECEIPT_READ_LIMIT = 500;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RUN_TRIGGERS = new Set<string>(RETAILER_REVERIFICATION_RUN_TRIGGERS);
const RUN_OUTCOMES = new Set<string>(RETAILER_REVERIFICATION_RUN_OUTCOMES);
// Outcomes that neither prove nor disprove the lane: they do not count toward
// a stall, but they do not clear one either.
const NEUTRAL_RUN_OUTCOMES = new Set<RetailerReverificationRunOutcome>(["skipped", "parked", "missing_candidate"]);
// Run receipts are bounded domain events on the existing append-only audit
// ledger rather than a new tenant-scoped table: the PostgreSQL tenant RLS
// surface is sealed at an exact table count, and a receipt is exactly the
// kind of counted, enum-only operational fact the ledger already carries.
const RUN_EVENT_TYPE = "retailer_reverification_run";
export const RETAILER_SESSION_MAX_AGE_MS = 5 * 60_000;
export const RETAILER_SESSION_FUTURE_TOLERANCE_MS = 5 * 60_000;

const LANE_VERSIONS: Record<ActionRetailer, { add: string; observer: string }> = {
  target: { add: TARGET_ADD_ADAPTER_VERSION, observer: TARGET_OBSERVER_VERSION },
  walmart: { add: WALMART_ADD_ADAPTER_VERSION, observer: WALMART_OBSERVER_VERSION },
  amazon: { add: AMAZON_ADD_ADAPTER_VERSION, observer: AMAZON_OBSERVER_VERSION },
  bestbuy: { add: BESTBUY_ADD_ADAPTER_VERSION, observer: BESTBUY_OBSERVER_VERSION }
};

const runCorrelationId = (retailerId: ActionRetailer): string => `retailer_reverification:${retailerId}`;

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
  currentlyPurchasable: boolean;
  layoutFingerprint: string;
}

export type LaneBlockedReason = "" | "no_purchasable_candidate" | "no_candidate";

export interface StoredRetailerReverificationRun {
  id: string;
  deviceId: string;
  retailerId: ActionRetailer;
  runId: string;
  automatic: boolean;
  trigger: RetailerReverificationRunTrigger;
  outcome: RetailerReverificationRunOutcome;
  reasonCode: string;
  attemptedProductCount: number;
  passedProductCount: number;
  startedAt: string;
  finishedAt: string;
  extensionVersion: string;
  planSignature: string;
  receivedAt: string;
}

export interface LaneAutomaticRunSummary {
  runId: string;
  outcome: RetailerReverificationRunOutcome;
  reasonCode: string;
  attemptedProductCount: number;
  passedProductCount: number;
  finishedAt: string;
  extensionVersion: string;
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
  blockedReason: LaneBlockedReason;
  degraded: boolean;
  degradedReasons: LaneDegradationReason[];
  lastAutomaticRun: LaneAutomaticRunSummary | null;
  consecutiveNonPassingRuns: number;
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
    const repairCandidateAvailable = candidates.some((item) => item.repairableObserverFailure);
    const purchasableCandidateAvailable = candidates.some((item) => item.currentlyPurchasable);
    const degradation = laneDegradation(this.db, retailerId, versions, now);
    const lastAutomaticRun = this.lastAutomaticRun(retailerId);
    const consecutiveNonPassingRuns = this.consecutiveNonPassingRuns(retailerId);
    const latestLaneDecision = qualification?.status === "retired"
      ? this.db.get<{ eventType: string }>(
        `SELECT event_type AS eventType FROM audit_events
         WHERE tenant_id = ? AND user_id = ? AND correlation_id = ?
           AND event_type IN ('retailer_adapter_qualified', 'retailer_lane_retired')
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        scope.tenantId,
        scope.userId,
        retailerId
      ) : null;
    const manuallyRetired = qualification?.status === "retired"
      && latestLaneDecision?.eventType === "retailer_lane_retired";
    // `suspended` is a legacy status no current code writes; it is treated as
    // a previously authorized lane that fresh passing evidence may renew.
    const previouslyAuthorizedRefreshNeeded = Boolean(qualification)
      && !manuallyRetired
      && (!qualified || warning !== "none");
    const evidenceStillNeeded = !qualified || warning !== "none" || degradation.degraded;
    const blockedReason: LaneBlockedReason = !candidates.length
      ? "no_candidate"
      : !repairCandidateAvailable && !purchasableCandidateAvailable && evidenceStillNeeded
        ? "no_purchasable_candidate"
        : "";
    const automaticCheckNeeded = blockedReason === "" && candidates.length > 0 && (
      repairCandidateAvailable
      || previouslyAuthorizedRefreshNeeded
      || (!qualified && !evidence.qualificationEvidenceReady)
      || degradation.degraded
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
      { id: "store_checks", ready: !degradation.degraded, label: degradation.degraded ? "Store checks failing" : "Store checks healthy" },
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
      blockedReason,
      degraded: degradation.degraded,
      degradedReasons: degradation.reasons,
      lastAutomaticRun,
      consecutiveNonPassingRuns,
      checklist,
      readyForGuardedAdd: qualified && activeDevice && !sessionBlocksAdd && !degradation.degraded,
      readyForWarmObservation: activeDevice && signedIn
    };
  }

  reverifyPlan(now = Date.now()): { createdAt: string; lanes: RetailerLaneReadiness[] } {
    return { createdAt: nowIso(now), lanes: this.lanes(now) };
  }

  recordReverificationRun(
    deviceId: string,
    input: RetailerReverificationRunInput,
    now = Date.now()
  ): StoredRetailerReverificationRun {
    if (!input || typeof input !== "object") throw new Error("A store re-verification run receipt is required.");
    if (input.contractVersion !== RETAILER_REVERIFICATION_RUN_CONTRACT_VERSION) {
      throw new Error("The store re-verification run contract version is unsupported.");
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
    const runId = cleanText(input.runId, 80);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error("A valid store re-verification run ID is required.");
    if (typeof input.automatic !== "boolean") throw new Error("The store re-verification automatic flag must be boolean.");
    if (!RUN_TRIGGERS.has(String(input.trigger))) throw new Error("The store re-verification trigger is invalid.");
    if (!RUN_OUTCOMES.has(String(input.outcome))) throw new Error("The store re-verification outcome is invalid.");
    const reasonCode = cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US");
    if (!REASON_PATTERN.test(reasonCode)) throw new Error("The store re-verification reason code is invalid.");
    const attempted = Number(input.attemptedProductCount);
    const passed = Number(input.passedProductCount);
    if (!Number.isInteger(attempted) || attempted < 0 || attempted > RETAILER_REVERIFICATION_RUN_MAX_PRODUCTS
      || !Number.isInteger(passed) || passed < 0 || passed > RETAILER_REVERIFICATION_RUN_MAX_PRODUCTS
      || passed > attempted) {
      throw new Error("Store re-verification product counts are out of bounds.");
    }
    const started = exactTimestamp(input.startedAt);
    const finished = exactTimestamp(input.finishedAt);
    if (!started || !finished || started.time > finished.time
      || finished.time > now + RUN_RECEIPT_CLOCK_SKEW_MS
      || now - finished.time > RUN_RECEIPT_MAX_AGE_MS) {
      throw new Error("The store re-verification run receipt is stale or has invalid timestamps.");
    }
    const extensionVersion = cleanText(input.extensionVersion, 40);
    if (!SEMVER_PATTERN.test(extensionVersion)) throw new Error("A valid companion version is required on the run receipt.");
    const planSignature = cleanText(input.planSignature, 200);
    const existing = this.runRows(retailerId, RUN_RECEIPT_READ_LIMIT)
      .find((row) => row.runId === runId && row.deviceId === safeDeviceId);
    if (existing) return existing;
    const receipt: Omit<StoredRetailerReverificationRun, "id" | "receivedAt"> = {
      deviceId: safeDeviceId,
      retailerId,
      runId,
      automatic: input.automatic,
      trigger: input.trigger,
      outcome: input.outcome,
      reasonCode,
      attemptedProductCount: attempted,
      passedProductCount: passed,
      startedAt: started.iso,
      finishedAt: finished.iso,
      extensionVersion,
      planSignature
    };
    const recorded = this.audit.record({
      correlationId: runCorrelationId(retailerId),
      aggregateType: "retailer_reverification",
      eventType: RUN_EVENT_TYPE,
      reasonCode,
      message: `A ${input.automatic ? "automatic" : "manual"} ${retailerId} store check finished ${input.outcome.replaceAll("_", " ")}.`,
      data: receipt
    }, now) as { id: string; createdAt: string };
    return { id: recorded.id, receivedAt: recorded.createdAt, ...receipt };
  }

  private runRows(retailerId: ActionRetailer, limit: number): StoredRetailerReverificationRun[] {
    const scope = currentRequestScope();
    const rows: StoredRetailerReverificationRun[] = [];
    for (const row of this.db.all<{ id: string; dataJson: string; createdAt: string }>(
      `SELECT id, data_json AS dataJson, created_at AS createdAt FROM audit_events
       WHERE tenant_id = ? AND user_id = ? AND correlation_id = ? AND event_type = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      scope.tenantId,
      scope.userId,
      runCorrelationId(retailerId),
      RUN_EVENT_TYPE,
      limit
    )) {
      let data: Record<string, unknown>;
      try { data = JSON.parse(row.dataJson) as Record<string, unknown>; } catch { continue; }
      if (!RUN_OUTCOMES.has(String(data.outcome)) || !RUN_TRIGGERS.has(String(data.trigger))) continue;
      rows.push({
        id: row.id,
        deviceId: String(data.deviceId ?? ""),
        retailerId,
        runId: String(data.runId ?? ""),
        automatic: data.automatic === true,
        trigger: data.trigger as RetailerReverificationRunTrigger,
        outcome: data.outcome as RetailerReverificationRunOutcome,
        reasonCode: String(data.reasonCode ?? ""),
        attemptedProductCount: Number(data.attemptedProductCount) || 0,
        passedProductCount: Number(data.passedProductCount) || 0,
        startedAt: String(data.startedAt ?? ""),
        finishedAt: String(data.finishedAt ?? ""),
        extensionVersion: String(data.extensionVersion ?? ""),
        planSignature: String(data.planSignature ?? ""),
        receivedAt: row.createdAt
      });
    }
    return rows.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt) || right.receivedAt.localeCompare(left.receivedAt));
  }

  private lastAutomaticRun(retailerId: ActionRetailer): LaneAutomaticRunSummary | null {
    const row = this.runRows(retailerId, RUN_RECEIPT_READ_LIMIT).find((run) => run.automatic);
    return row ? {
      runId: row.runId,
      outcome: row.outcome,
      reasonCode: row.reasonCode,
      attemptedProductCount: row.attemptedProductCount,
      passedProductCount: row.passedProductCount,
      finishedAt: row.finishedAt,
      extensionVersion: row.extensionVersion
    } : null;
  }

  private consecutiveNonPassingRuns(retailerId: ActionRetailer): number {
    let count = 0;
    for (const row of this.runRows(retailerId, RUN_RECEIPT_READ_LIMIT)) {
      if (!row.automatic) continue;
      if (row.outcome === "passed") break;
      if (NEUTRAL_RUN_OUTCOMES.has(row.outcome)) continue;
      count += 1;
    }
    return count;
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
    const repairBySku = new Map<string, AdapterRepairQueueItem>();
    for (const repair of new AdapterDiagnosticRepository(this.db).listRepairQueue(2_000)) {
      if (repair.status !== "open" || repair.retailerId !== retailerId) continue;
      for (const retailerSku of repair.repairRetailerSkus) {
        if (!repairBySku.has(retailerSku)) repairBySku.set(retailerSku, repair);
      }
    }
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
      currentlyPurchasable: number;
      layoutFingerprint: string;
    }>(
      `WITH candidate_history AS (
       SELECT observation.retailer_sku AS retailerSku,
              MAX(observation.canonical_url) AS canonicalUrl,
              COALESCE(MAX(variant.title), '') AS title,
              MAX(observation.observed_at) AS trialObservedAt,
              MAX(CASE WHEN observation.observation_state = 'actionable_candidate'
                         AND observation.availability IN ('in_stock', 'preorder')
                         AND observation.seller_type = 'first_party'
                         AND observation.add_control_actionable = 1 THEN 1 ELSE 0 END) AS firstPartyActionable,
              MAX(CASE WHEN observation.observation_state = 'actionable_candidate'
                         AND observation.availability IN ('in_stock', 'preorder')
                         AND observation.fulfillment = 'shipping'
                         AND observation.add_control_actionable = 1 THEN 1 ELSE 0 END) AS shippingActionable,
              MAX(CASE WHEN observation.observation_state = 'actionable_candidate'
                         AND observation.availability IN ('in_stock', 'preorder')
                         AND observation.fulfillment = 'pickup'
                         AND observation.add_control_actionable = 1 THEN 1 ELSE 0 END) AS pickupActionable,
              MAX(CASE WHEN observation.observation_state = 'actionable_candidate'
                         AND observation.availability IN ('in_stock', 'preorder')
                         AND observation.purchase_route_ready = 1 THEN 1 ELSE 0 END) AS offerRouteReady,
              MAX(CASE WHEN observation.adapter_version = ?
                         AND observation.observation_state = 'actionable_candidate'
                         AND observation.availability IN ('in_stock', 'preorder')
                         AND observation.observed_at >= ? THEN 1 ELSE 0 END) AS currentObserverEvidence,
              MAX(CASE WHEN trial.outcome = 'passed' AND trial.adapter_version = ?
                         AND trial.observed_at >= ? THEN 1 ELSE 0 END) AS currentRehearsalPassed,
              MAX(CASE WHEN trial.outcome = 'passed' THEN 1 ELSE 0 END) AS priorRehearsalPassed,
              MAX(CASE WHEN listing.status IN ('in_stock', 'preorder') THEN 1 ELSE 0 END) AS currentlyPurchasable,
              COALESCE((
                SELECT diagnostic.layout_fingerprint
                FROM retailer_adapter_diagnostics diagnostic
                WHERE diagnostic.tenant_id = observation.tenant_id
                  AND diagnostic.user_id = observation.user_id
                  AND diagnostic.retailer_id = observation.retailer_id
                  AND diagnostic.retailer_sku = observation.retailer_sku
                  AND diagnostic.operation = 'observe'
                  AND diagnostic.received_at >= ?
                ORDER BY diagnostic.received_at DESC, diagnostic.id DESC
                LIMIT 1
              ), '') AS layoutFingerprint,
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
       ORDER BY repairableObserverFailure DESC,
                currentlyPurchasable DESC,
                currentRehearsalPassed DESC,
                currentObserverEvidence DESC,
                priorRehearsalPassed DESC,
                shippingActionable DESC,
                firstPartyActionable DESC,
                trialObservedAt DESC,
                retailerSku
       LIMIT 24`,
      versions.observer,
      cutoff,
      versions.add,
      cutoff,
      cutoff,
      cutoff,
      scope.tenantId,
      scope.userId,
      retailerId
    );
    const candidates: RequalificationCandidate[] = rows.map((row) => {
      const repair = repairBySku.get(row.retailerSku);
      const repairNeeded = Boolean(repair) || row.repairableObserverFailure === 1;
      return {
        retailerSku: row.retailerSku,
        canonicalUrl: row.canonicalUrl,
        title: row.title,
        trialObservedAt: row.trialObservedAt,
        source: repairNeeded
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
        repairableObserverFailure: repairNeeded,
        currentlyPurchasable: row.currentlyPurchasable === 1,
        layoutFingerprint: repair?.layoutFingerprint || row.layoutFingerprint
      };
    });
    for (const [retailerSku, repair] of repairBySku) {
      if (candidates.some((candidate) => candidate.retailerSku === retailerSku)) continue;
      const observation = this.db.get<{ canonicalUrl: string; title: string; observedAt: string }>(
        `SELECT observation.canonical_url AS canonicalUrl,
                COALESCE(variant.title, '') AS title,
                observation.observed_at AS observedAt
         FROM retailer_shadow_observations observation
         LEFT JOIN listings listing ON listing.retailer_id = observation.retailer_id
           AND listing.retailer_sku = observation.retailer_sku
         LEFT JOIN variants variant ON variant.id = listing.variant_id
         WHERE observation.tenant_id = ? AND observation.user_id = ?
           AND observation.retailer_id = ? AND observation.retailer_sku = ?
           AND observation.canonical_url <> ''
         ORDER BY observation.observed_at DESC, observation.id DESC LIMIT 1`,
        scope.tenantId,
        scope.userId,
        retailerId,
        retailerSku
      );
      if (!observation) continue;
      candidates.push({
        retailerSku,
        canonicalUrl: observation.canonicalUrl,
        title: observation.title,
        trialObservedAt: observation.observedAt,
        source: "repair_queue",
        qualificationTypes: [],
        currentObserverEvidence: false,
        currentRehearsalPassed: false,
        priorRehearsalPassed: false,
        repairableObserverFailure: true,
        currentlyPurchasable: Boolean(this.db.get<{ id: string }>(
          `SELECT id FROM listings WHERE retailer_id = ? AND retailer_sku = ? AND status IN ('in_stock', 'preorder') LIMIT 1`,
          retailerId,
          retailerSku
        )),
        layoutFingerprint: repair.layoutFingerprint
      });
    }
    const diversified: RequalificationCandidate[] = [];
    const append = (candidate: RequalificationCandidate): void => {
      if (diversified.length >= MAX_CANDIDATES
        || diversified.some((item) => item.retailerSku === candidate.retailerSku)) return;
      diversified.push(candidate);
    };
    const repairLayouts = new Set<string>();
    for (const candidate of candidates.filter((item) => item.repairableObserverFailure)) {
      if (candidate.layoutFingerprint && repairLayouts.has(candidate.layoutFingerprint)) continue;
      append(candidate);
      if (candidate.layoutFingerprint) repairLayouts.add(candidate.layoutFingerprint);
    }
    for (const candidate of candidates.filter((item) => item.repairableObserverFailure)) append(candidate);
    const observedLayouts = new Set(diversified.map((item) => item.layoutFingerprint).filter(Boolean));
    for (const candidate of candidates) {
      if (!candidate.layoutFingerprint || observedLayouts.has(candidate.layoutFingerprint)) continue;
      append(candidate);
      observedLayouts.add(candidate.layoutFingerprint);
    }
    const covered = new Set(diversified.flatMap((item) => item.qualificationTypes));
    while (diversified.length < MAX_CANDIDATES) {
      const next = candidates
        .filter((candidate) => !diversified.some((item) => item.retailerSku === candidate.retailerSku))
        .sort((left, right) => {
          const leftNew = left.qualificationTypes.filter((item) => !covered.has(item)).length;
          const rightNew = right.qualificationTypes.filter((item) => !covered.has(item)).length;
          return rightNew - leftNew;
        })[0];
      if (!next) break;
      append(next);
      next.qualificationTypes.forEach((item) => covered.add(item));
    }
    candidates.splice(0, candidates.length, ...diversified);
    const rehearsalCovered = candidates.some((candidate) => candidate.currentRehearsalPassed);
    const purchasableReserve = rehearsalCovered ? 0 : PURCHASABLE_CANDIDATE_RESERVE;
    if (candidates.length >= MAX_CANDIDATES
      && candidates.filter((candidate) => candidate.currentlyPurchasable).length >= purchasableReserve) {
      return candidates;
    }
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
         AND listing.status IN ('in_stock', 'preorder')
         AND listing.canonical_url <> ''
       ORDER BY userRelevant DESC, listing.updated_at DESC, listing.retailer_sku
       LIMIT 16`,
      scope.tenantId,
      scope.userId,
      retailerId
    );
    for (const row of catalogRows) {
      if (candidates.some((candidate) => candidate.retailerSku === row.retailerSku)) continue;
      const purchasableCount = candidates.filter((candidate) => candidate.currentlyPurchasable).length;
      const catalogCandidate: RequalificationCandidate = {
        retailerSku: row.retailerSku,
        canonicalUrl: row.canonicalUrl,
        title: row.title,
        trialObservedAt: row.updatedAt,
        source: "catalog",
        qualificationTypes: [],
        currentObserverEvidence: false,
        currentRehearsalPassed: false,
        priorRehearsalPassed: false,
        repairableObserverFailure: false,
        currentlyPurchasable: true,
        layoutFingerprint: ""
      };
      if (candidates.length < MAX_CANDIDATES) {
        candidates.push(catalogCandidate);
        continue;
      }
      if (purchasableCount >= purchasableReserve) break;
      // Reserve a slot: replace the last sold-out history product that carries
      // no open repair, so the loop can still rehearse something purchasable.
      const replaceable = candidates.map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => !candidate.repairableObserverFailure && !candidate.currentlyPurchasable)
        .at(-1);
      if (!replaceable) break;
      candidates.splice(replaceable.index, 1, catalogCandidate);
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
