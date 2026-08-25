import {
  ACTIONS,
  type Action,
  type ListingContext,
  type MissionContext,
  type NormalizedSignal,
  type PurchaseIntentPolicy,
  type PurchaseIntentDecisionMode,
  type PurchaseIntentPolicyTarget,
  type PurchaseIntentPolicyUpdateInput,
  type StrategyEvaluation,
  type SubstitutionPolicy
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const ACTION_RANK: Record<Action, number> = {
  notify: 0,
  add_to_cart: 1,
  prepare_checkout: 2,
  submit_order: 3
};
const SUBSTITUTION_POLICIES = new Set<SubstitutionPolicy>(["exact_only", "verified_equivalent"]);
const MAX_POLICY_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;

interface MissionPolicyTarget extends PurchaseIntentPolicyTarget {
  currency: string;
  executionSupported: boolean;
}

export class PurchaseSafetyError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "PurchaseSafetyError";
  }
}

interface IntentRevisionRow {
  id: string;
  missionId: string;
  revision: number;
  quantity: number;
  currency: string;
  maxAllInCents: number | null;
  actionCeiling: Action;
  decisionMode: PurchaseIntentDecisionMode;
  maxSignalAgeSeconds: number;
  substitutionPolicy: SubstitutionPolicy;
  expiresAt: string;
  cooldownSeconds: number;
  targetPolicyJson: string;
  policyHash: string;
  changeReason: string;
  createdByActorId: string;
  createdAt: string;
}

export interface IntentActionDecision {
  allowed: boolean;
  reasonCode: string;
  message: string;
  policy: PurchaseIntentPolicy;
  target: PurchaseIntentPolicyTarget | null;
}

function nullableCents(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000) {
    throw new PurchaseSafetyError("intent_policy_invalid", 400, `${field} must be a positive integer number of cents or blank.`);
  }
  return cents;
}

function parseTargets(value: string): PurchaseIntentPolicyTarget[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { parsed = null; }
  if (!Array.isArray(parsed)) throw new Error("The stored purchase-intent target policy is invalid.");
  return parsed.map((target) => {
    if (!target || typeof target !== "object") throw new Error("The stored purchase-intent target policy is invalid.");
    const row = target as Record<string, unknown>;
    return {
      targetId: String(row.targetId ?? ""),
      listingId: String(row.listingId ?? ""),
      retailerId: String(row.retailerId ?? ""),
      enabled: row.enabled === true,
      maxUnitPriceCents: row.maxUnitPriceCents === null || row.maxUnitPriceCents === undefined
        ? null
        : Number(row.maxUnitPriceCents),
      sellerPolicy: row.sellerPolicy as PurchaseIntentPolicyTarget["sellerPolicy"],
      fulfillment: row.fulfillment as PurchaseIntentPolicyTarget["fulfillment"]
    };
  });
}

function intentPolicy(row: IntentRevisionRow): PurchaseIntentPolicy {
  return {
    id: row.id,
    missionId: row.missionId,
    revision: Number(row.revision),
    quantity: Number(row.quantity),
    currency: row.currency,
    maxAllInCents: row.maxAllInCents === null ? null : Number(row.maxAllInCents),
    actionCeiling: row.actionCeiling,
    decisionMode: row.decisionMode,
    maxSignalAgeSeconds: Number(row.maxSignalAgeSeconds),
    substitutionPolicy: row.substitutionPolicy,
    expiresAt: row.expiresAt,
    cooldownSeconds: Number(row.cooldownSeconds),
    targets: parseTargets(row.targetPolicyJson),
    policyHash: row.policyHash,
    changeReason: row.changeReason,
    createdByActorId: row.createdByActorId,
    createdAt: row.createdAt
  };
}

export class PurchasePolicyRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  current(missionId: string): PurchaseIntentPolicy | null {
    const row = this.db.get<IntentRevisionRow>(
      `SELECT ir.id, ir.mission_id AS missionId, ir.revision, ir.quantity,
              ir.currency, ir.max_all_in_cents AS maxAllInCents,
              ir.action_ceiling AS actionCeiling,
              ir.decision_mode AS decisionMode,
              ir.max_signal_age_seconds AS maxSignalAgeSeconds,
              ir.substitution_policy AS substitutionPolicy,
              ir.expires_at AS expiresAt, ir.cooldown_seconds AS cooldownSeconds,
              ir.target_policy_json AS targetPolicyJson, ir.policy_hash AS policyHash,
              ir.change_reason AS changeReason,
              ir.created_by_actor_id AS createdByActorId, ir.created_at AS createdAt
       FROM mission_intent_revisions ir
       JOIN missions m ON m.id = ir.mission_id
       WHERE ir.mission_id = ? AND m.tenant_id = ? AND m.user_id = ?
       ORDER BY ir.revision DESC LIMIT 1`,
      cleanText(missionId, 120),
      currentRequestScope().tenantId,
      currentRequestScope().userId
    );
    return row ? intentPolicy(row) : null;
  }

  ensureCurrent(
    missionId: string,
    now = Date.now(),
    initialInput: PurchaseIntentPolicyUpdateInput = {}
  ): PurchaseIntentPolicy {
    const existing = this.current(missionId);
    if (existing) return existing;
    const { expectedRevision: _discardedRevision, ...initial } = initialInput;
    return this.revise(missionId, {
      ...initial,
      changeReason: cleanText(initialInput.changeReason, 300) || "Initial exact purchase policy."
    }, now, true);
  }

  revise(
    missionId: string,
    input: PurchaseIntentPolicyUpdateInput = {},
    now = Date.now(),
    allowInitial = false
  ): PurchaseIntentPolicy {
    const id = cleanText(missionId, 120);
    return this.db.transaction(() => {
      const mission = this.db.get<{ id: string; quantity: number }>(
        `SELECT id, target_quantity AS quantity FROM missions
         WHERE id = ? AND tenant_id = ? AND user_id = ?`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId
      );
      if (!mission) throw new PurchaseSafetyError("purchase_intent_not_found", 404, "The purchase intent does not exist.");
      const current = this.current(id);
      if (!allowInitial && !current) {
        throw new PurchaseSafetyError("intent_policy_missing", 409, "The purchase intent has no current policy revision.");
      }
      if (input.expectedRevision !== undefined
        && (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) !== Number(current?.revision ?? 0))) {
        throw new PurchaseSafetyError(
          "intent_revision_conflict",
          409,
          "The purchase intent changed after it was loaded. Refresh it before saving again."
        );
      }
      const targets = this.targetsForMission(id);
      if (!targets.length) throw new PurchaseSafetyError("intent_targets_missing", 409, "The purchase intent has no exact retailer targets.");
      const currencies = new Set(targets.map((target) => target.currency));
      if (currencies.size !== 1 || !currencies.has("USD")) {
        throw new PurchaseSafetyError("intent_currency_unsupported", 409, "A purchase intent must use one supported currency.");
      }
      const actionCeiling = (input.actionCeiling ?? current?.actionCeiling ?? "add_to_cart") as Action;
      if (!ACTIONS.includes(actionCeiling)) {
        throw new PurchaseSafetyError("intent_policy_invalid", 400, "A supported action ceiling is required.");
      }
      const decisionMode = (input.decisionMode ?? current?.decisionMode ?? "strategy") as PurchaseIntentDecisionMode;
      if (!new Set<PurchaseIntentDecisionMode>(["strategy", "purchase_intent"]).has(decisionMode)) {
        throw new PurchaseSafetyError("intent_policy_invalid", 400, "A supported purchase-plan decision mode is required.");
      }
      if (decisionMode === "purchase_intent" && !["notify", "add_to_cart"].includes(actionCeiling)) {
        throw new PurchaseSafetyError(
          "intent_policy_invalid",
          400,
          "Direct purchase plans currently support notifications or guarded add-to-cart only."
        );
      }
      const maxSignalAgeSeconds = input.maxSignalAgeSeconds === undefined
        ? current?.maxSignalAgeSeconds ?? 120
        : Number(input.maxSignalAgeSeconds);
      if (!Number.isInteger(maxSignalAgeSeconds) || maxSignalAgeSeconds < 10 || maxSignalAgeSeconds > 3_600) {
        throw new PurchaseSafetyError("intent_policy_invalid", 400, "Signal freshness must be 10 through 3,600 seconds.");
      }
      const substitutionPolicy = (input.substitutionPolicy ?? current?.substitutionPolicy ?? "exact_only") as SubstitutionPolicy;
      if (!SUBSTITUTION_POLICIES.has(substitutionPolicy)) {
        throw new PurchaseSafetyError("intent_policy_invalid", 400, "A supported substitution policy is required.");
      }
      const maxAllInCents = input.maxAllInCents === undefined
        ? current?.maxAllInCents ?? null
        : nullableCents(input.maxAllInCents, "The all-in cap");
      const cooldownSeconds = input.cooldownSeconds === undefined
        ? current?.cooldownSeconds ?? 0
        : Number(input.cooldownSeconds);
      if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 2_592_000) {
        throw new PurchaseSafetyError("intent_policy_invalid", 400, "Cooldown must be from zero through 2,592,000 seconds.");
      }
      const expiresAt = input.expiresAt === undefined ? current?.expiresAt ?? "" : cleanText(input.expiresAt, 40);
      if (expiresAt) {
        const expiry = new Date(expiresAt).getTime();
        if (!Number.isFinite(expiry) || expiry <= now || expiry > now + MAX_POLICY_LIFETIME_MS) {
          throw new PurchaseSafetyError("intent_policy_invalid", 400, "Intent expiry must be a future timestamp no more than one year away.");
        }
      }
      const targetPolicy: PurchaseIntentPolicyTarget[] = targets.map((target) => ({
        targetId: target.targetId,
        listingId: target.listingId,
        retailerId: target.retailerId,
        enabled: target.enabled,
        maxUnitPriceCents: target.maxUnitPriceCents,
        sellerPolicy: target.sellerPolicy,
        fulfillment: target.fulfillment
      }));
      if (decisionMode === "purchase_intent" && actionCeiling === "add_to_cart") {
        const enabledTargets = targets.filter((target) => target.enabled);
        if (!enabledTargets.length) {
          throw new PurchaseSafetyError("intent_targets_missing", 409, "A guarded cart plan needs one enabled exact retailer offer.");
        }
        const unsafeTarget = enabledTargets.find((target) => !target.executionSupported
          || target.maxUnitPriceCents === null
          || target.sellerPolicy !== "first_party_only"
          || target.fulfillment !== "shipping");
        if (unsafeTarget) {
          throw new PurchaseSafetyError(
            "intent_purchase_target_unsafe",
            409,
            "Every enabled cart target must have a packaged mapping, a reviewed item cap, the retailer itself as seller, and shipping selected."
          );
        }
        const settings = this.db.get<{ taxBps: number; allowances: string }>(
          `SELECT tax_bps AS taxBps, store_allowances_json AS allowances
           FROM app_settings WHERE user_id = ?`,
          currentRequestScope().userId
        );
        let allowances: Record<string, unknown> = {};
        try { allowances = JSON.parse(settings?.allowances ?? "{}"); } catch { allowances = {}; }
        const taxBps = Math.max(0, Number(settings?.taxBps ?? 0));
        const requiredAllInCents = Math.max(...enabledTargets.map((target) => {
          const itemTotal = Number(target.maxUnitPriceCents) * mission.quantity;
          const storeAllowance = Math.max(0, Number(allowances[target.retailerId] ?? 0));
          return Math.ceil(itemTotal * (10_000 + taxBps) / 10_000) + storeAllowance;
        }));
        if (!Number.isSafeInteger(requiredAllInCents) || maxAllInCents === null || maxAllInCents < requiredAllInCents) {
          throw new PurchaseSafetyError(
            "intent_all_in_bound_too_low",
            400,
            `Guarded cart actions need a maximum total of at least $${(requiredAllInCents / 100).toFixed(2)} under the current quantity, tax, and store-fee safety reserve.`
          );
        }
      }
      const targetPolicyJson = JSON.stringify(targetPolicy);
      const policyHash = stableHash(
        "intent-policy-v2",
        id,
        mission.quantity,
        "USD",
        maxAllInCents,
        actionCeiling,
        decisionMode,
        maxSignalAgeSeconds,
        substitutionPolicy,
        expiresAt,
        cooldownSeconds,
        targetPolicyJson
      );
      if (current?.policyHash === policyHash) return current;
      const revision = Number(current?.revision ?? 0) + 1;
      const revisionId = newId("intent_revision");
      const timestamp = nowIso(now);
      const reason = cleanText(input.changeReason, 300) || (current ? "Purchase preferences updated." : "Initial exact purchase policy.");
      this.db.run(
        `INSERT INTO mission_intent_revisions(
           id, tenant_id, user_id, mission_id, revision, quantity, currency,
           max_all_in_cents, action_ceiling, substitution_policy, expires_at,
           cooldown_seconds, target_policy_json, policy_hash, change_reason,
           decision_mode, max_signal_age_seconds,
           created_by_actor_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        revisionId,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        id,
        revision,
        mission.quantity,
        maxAllInCents,
        actionCeiling,
        substitutionPolicy,
        expiresAt,
        cooldownSeconds,
        targetPolicyJson,
        policyHash,
        reason,
        decisionMode,
        maxSignalAgeSeconds,
        currentRequestScope().actorId,
        timestamp
      );
      this.audit.record({
        correlationId: id,
        aggregateType: "purchase_intent",
        eventType: "purchase_intent_policy_revised",
        reasonCode: current ? "preferences_updated" : "initial_policy",
        message: `Purchase intent policy revision ${revision} was recorded append-only.`,
        data: {
          missionId: id,
          revision,
          actionCeiling,
          decisionMode,
          maxSignalAgeSeconds,
          substitutionPolicy,
          targetCount: targetPolicy.length
        }
      }, now);
      const saved = this.current(id);
      if (!saved) throw new Error("The purchase-intent policy revision could not be loaded.");
      return saved;
    });
  }

  evaluateAction(
    signal: NormalizedSignal,
    listing: ListingContext,
    mission: MissionContext,
    evaluation: StrategyEvaluation,
    maximumAllInCents: number | null,
    now = Date.now()
  ): IntentActionDecision {
    const policy = this.ensureCurrent(mission.id, now);
    const target = policy.targets.find((candidate) => candidate.listingId === listing.id) ?? null;
    const rejected = (reasonCode: string, message: string): IntentActionDecision => ({ allowed: false, reasonCode, message, policy, target });
    if (!target || !target.enabled || mission.status !== "active") {
      return rejected("intent_target_disabled", "The exact retailer offer is not enabled in the current purchase intent.");
    }
    if (policy.expiresAt && new Date(policy.expiresAt).getTime() <= now) {
      return rejected("intent_expired", "The current purchase intent has expired.");
    }
    if (ACTION_RANK[evaluation.effectiveAction] > ACTION_RANK[policy.actionCeiling]) {
      return rejected("intent_action_ceiling", "The requested action exceeds the purchase intent action ceiling.");
    }
    const fulfilled = Number(this.db.get<{ fulfilled: number }>(
      "SELECT fulfilled_quantity AS fulfilled FROM missions WHERE id = ? AND user_id = ?",
      mission.id,
      currentRequestScope().userId
    )?.fulfilled ?? 0);
    if (fulfilled + evaluation.effectiveQuantity > policy.quantity) {
      return rejected("intent_quantity_exceeded", "The requested quantity exceeds the unfulfilled purchase intent quantity.");
    }
    if (signal.offer.unitPriceCents === null) {
      return rejected("intent_price_required", "An exact numeric offer price is required before a purchase action.");
    }
    if (target.maxUnitPriceCents !== null && signal.offer.unitPriceCents > target.maxUnitPriceCents) {
      return rejected("intent_unit_cap_exceeded", "The selected offer exceeds the retailer-specific unit-price cap.");
    }
    if (policy.maxAllInCents !== null
      && (maximumAllInCents === null || maximumAllInCents > policy.maxAllInCents)) {
      return rejected("intent_all_in_cap_exceeded", "The bounded maximum order total exceeds the purchase intent all-in cap.");
    }
    if (evaluation.sellerPolicy === "first_party_only" && signal.offer.sellerType !== "first_party") {
      return rejected("intent_seller_unverified", "A first-party seller must be explicitly verified for this purchase intent.");
    }
    if (!["either", "manual", "unknown"].includes(evaluation.fulfillment)
      && signal.offer.fulfillment !== evaluation.fulfillment) {
      return rejected("intent_fulfillment_unverified", "The selected offer fulfillment does not match the purchase intent.");
    }
    if (policy.cooldownSeconds > 0) {
      const latest = this.db.get<{ createdAt: string }>(
        `SELECT created_at AS createdAt FROM action_jobs
         WHERE mission_id = ? AND user_id = ? AND action <> 'notify'
           AND state IN ('confirmed', 'manual_review', 'submission_uncertain')
         ORDER BY created_at DESC LIMIT 1`,
        mission.id,
        currentRequestScope().userId
      );
      if (latest && new Date(latest.createdAt).getTime() + policy.cooldownSeconds * 1_000 > now) {
        return rejected("intent_cooldown_active", "The purchase intent cooldown is still active.");
      }
    }
    return { allowed: true, reasonCode: "intent_policy_verified", message: "The exact offer is within the current purchase intent revision.", policy, target };
  }

  private targetsForMission(missionId: string): MissionPolicyTarget[] {
    return this.db.all<PurchaseIntentPolicyTarget & { currency: string; executionSupported: number }>(
      `SELECT mt.id AS targetId, mt.listing_id AS listingId,
              l.retailer_id AS retailerId, mt.enabled = 1 AS enabled,
              l.execution_supported AS executionSupported,
              mt.max_unit_price_cents AS maxUnitPriceCents,
              mt.seller_policy AS sellerPolicy, mt.fulfillment,
              mt.currency
       FROM mission_targets mt JOIN listings l ON l.id = mt.listing_id
       JOIN missions m ON m.id = mt.mission_id
       WHERE mt.mission_id = ? AND m.tenant_id = ? AND m.user_id = ?
       ORDER BY mt.id`,
      missionId,
      currentRequestScope().tenantId,
      currentRequestScope().userId
    ).map((target) => ({
      ...target,
      enabled: Boolean(target.enabled),
      executionSupported: Number(target.executionSupported) === 1
    }));
  }
}
