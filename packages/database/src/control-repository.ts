import {
  ACTIONS,
  PRICE_POLICY_KINDS,
  type Fulfillment,
  type JobState,
  type MissionStatus,
  type AppSettingsUpdateInput,
  LEGACY_PURCHASE_INTENT_TRANSITION_CONFIRMATION,
  LEGACY_PURCHASE_INTENT_TRANSITION_CONTRACT_VERSION,
  PURCHASE_INTENT_DELETE_CONFIRMATION,
  PURCHASE_PROFILE_APPLY_CONFIRMATION,
  type LegacyPurchaseIntentTransitionInput,
  type MissionContext,
  type PurchaseIntentCreateInput,
  type PurchaseIntentDeleteInput,
  type PurchaseIntentDraftInput,
  type PurchaseIntentPreflightInput,
  PURCHASE_INTENT_PREFLIGHT_TTL_SECONDS,
  type PurchaseIntentPolicy,
  type PurchaseIntentPolicyUpdateInput,
  type MissionUpdateInput,
  type PurchaseProfile,
  type PurchaseProfileApplyInput,
  type PurchaseProfileApplyResult,
  type PurchaseProfileInput,
  type PurchaseProfilePropagationSkip,
  type PurchaseProfilePropagationSummary,
  type PurchaseProfileRetailerReconciliationResult,
  type PurchaseProfileSaveResult,
  type SellerPolicy,
  type StrategyDefinition
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { canTransitionJob, jobIsTerminal, jobMayHaveMutated } from "../../domain/src/job-state.js";
import { cleanText } from "../../domain/src/normalize.js";
import type { PurchaseAutomationPlanInput } from "../../domain/src/purchase-automation-readiness.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { AuditRepository } from "./audit-repository.js";
import { PurchasePolicyRepository, PurchaseSafetyError } from "./purchase-policy-repository.js";
import { SignalRepository } from "./signal-repository.js";
import { SpendLedgerRepository } from "./spend-ledger-repository.js";

interface StrategyRow {
  id: string;
  name: string;
  enabled: number;
  position: number;
  revision: number;
  definition_json: string;
}

interface MissionRow {
  id: string;
  status: MissionStatus;
  target_quantity: number;
  target_id: string;
  target_enabled: number;
  max_unit_price_cents: number | null;
  seller_policy: SellerPolicy | "inherit";
  fulfillment: Fulfillment | "inherit";
}

interface LegacyPurchaseIntentTransitionRow {
  id: string;
  title: string;
  origin: string;
  status: "active" | "paused";
  revision: number;
  policyHash: string;
  updatedAt: string;
}

export interface LegacyPurchaseIntentTransitionPreview {
  contractVersion: typeof LEGACY_PURCHASE_INTENT_TRANSITION_CONTRACT_VERSION;
  eligibleCount: number;
  activeCount: number;
  pausedCount: number;
  previewFingerprint: string;
  outcome: "notification_only";
  retailerMutationAuthorized: false;
  checkoutAuthorized: false;
  samplePlans: Array<{ id: string; title: string; status: "active" | "paused" }>;
}

export interface LegacyPurchaseIntentTransitionResult {
  transitionedCount: number;
  cancelledPendingJobCount: number;
  transitionedPlanIds: string[];
  preview: LegacyPurchaseIntentTransitionPreview;
}

export interface MissionEnsureResult {
  mission: MissionContext;
  created: boolean;
}

interface MissionCreationConfiguration {
  targetQuantity: number;
  selectedOnly: boolean;
  selectedMaxUnitPriceCents: number | null;
  selectedSellerPolicy: SellerPolicy | "inherit";
  selectedFulfillment: Fulfillment | "inherit";
  initialPolicy: PurchaseIntentPolicyUpdateInput;
  quickAddProfileId?: string;
}

interface ConfiguredMissionListing {
  variantId: string;
  title: string;
  retailerId: string;
  retailerName: string;
  retailerSku: string;
  executionSupported: boolean;
  currency: string;
}

interface ValidatedConfiguredMission {
  listingId: string;
  listing: ConfiguredMissionListing;
  draft: PurchaseIntentDraftInput & { expiresAt: string };
  cost: {
    currency: string;
    itemSubtotalCapCents: number;
    taxReserveCents: number;
    storeReserveCents: number;
    minimumAllInCents: number;
    reviewedAllInCents: number;
    headroomCents: number;
    autoRaised: boolean;
    spendingLimit: {
      allowed: boolean;
      reasonCode: string;
      message: string;
    };
  };
}

export interface ConfiguredMissionPreflight {
  contractVersion: 1;
  noPurchasePlanSaved: true;
  listing: Omit<ConfiguredMissionListing, "variantId"> & { listingId: string };
  draft: PurchaseIntentDraftInput & { expiresAt: string };
  cost: ValidatedConfiguredMission["cost"];
  readinessPlan: PurchaseAutomationPlanInput;
}

export interface AppSettings {
  actionsPaused: boolean;
  pauseReason: string;
  executionMode: "shadow" | "live";
  dedupeWindowSeconds: number;
  affiliateMode: "prefer_fallback" | "require" | "disabled";
  taxBps: number;
  storeAllowancesCents: Record<string, number>;
}

export interface TenantActionSettingsUpdate {
  settings: AppSettings;
  affectedUserCount: number;
}

function parseStrategy(row: StrategyRow): StrategyDefinition {
  const definition = JSON.parse(row.definition_json) as StrategyDefinition;
  return {
    ...definition,
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    position: Number(row.position),
    revision: Number(row.revision)
  };
}

function missionContext(row: MissionRow): MissionContext {
  return {
    id: row.id,
    status: row.status,
    targetQuantity: Number(row.target_quantity),
    targetId: row.target_id,
    targetEnabled: row.target_enabled === 1,
    maxUnitPriceCents: row.max_unit_price_cents === null ? null : Number(row.max_unit_price_cents),
    sellerPolicy: row.seller_policy,
    fulfillment: row.fulfillment
  };
}

const SELLER_POLICIES = new Set(["first_party_only", "allow_third_party"]);
const FULFILLMENTS = new Set(["shipping", "pickup", "either", "manual", "unknown"]);
const EDITABLE_MISSION_STATUSES = new Set(["active", "paused", "satisfied", "archived"]);
const MISSION_TARGET_POLICIES = new Set(["inherit", "first_party_only", "allow_third_party"]);
const MISSION_TARGET_FULFILLMENTS = new Set(["inherit", "shipping", "pickup", "either", "manual", "unknown"]);
const SETTING_RETAILERS = new Set(["target", "walmart", "amazon", "bestbuy"]);
const MAX_POLICY_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;

function stringList(value: unknown, field: string, maximumItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maximumItems || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be a list of at most ${maximumItems} names.`);
  }
  return value.map((item) => cleanText(item, 100).toLocaleLowerCase("en-US")).filter(Boolean);
}

function validatedStrategy(strategy: StrategyDefinition, index: number): StrategyDefinition {
  if (!strategy || typeof strategy !== "object") throw new Error("Every strategy must be an object.");
  const id = cleanText(strategy.id || `strategy_${index + 1}`, 80);
  const name = cleanText(strategy.name, 100);
  const position = Number(strategy.position);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(id)) throw new Error("Every strategy needs a valid ID.");
  if (!name) throw new Error("Every strategy needs a name.");
  if (!Number.isInteger(position) || position < 1 || position > 10_000) {
    throw new Error("Every strategy needs a position from 1 through 10,000.");
  }
  if (!strategy.pricePolicy || !PRICE_POLICY_KINDS.includes(strategy.pricePolicy.kind)) {
    throw new Error("Every strategy needs a supported price policy.");
  }
  if (["absolute_max", "above_msrp"].includes(strategy.pricePolicy.kind)) {
    const cap = Number(strategy.pricePolicy.maxPriceCents);
    if (!Number.isSafeInteger(cap) || cap <= 0 || cap > 100_000_000) {
      throw new Error("Absolute and above-MSRP policies require a positive maximum price.");
    }
  }
  if (strategy.pricePolicy.kind === "slightly_above_msrp" && strategy.pricePolicy.toleranceBps !== undefined) {
    const tolerance = Number(strategy.pricePolicy.toleranceBps);
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 10_000) {
      throw new Error("The slightly-above-MSRP tolerance must be from 0% through 100%.");
    }
  }
  if (!SELLER_POLICIES.has(strategy.sellerPolicy)) throw new Error("Every strategy needs a supported seller policy.");
  if (!ACTIONS.includes(strategy.action)) throw new Error("Every strategy needs a supported action.");
  if (!FULFILLMENTS.has(strategy.fulfillment)) throw new Error("Every strategy needs a supported fulfillment policy.");
  if (!Number.isInteger(strategy.quantity) && strategy.quantity !== "max") throw new Error("Strategy quantity must be 1 through 5 or Max allowed.");
  if (typeof strategy.quantity === "number" && (strategy.quantity < 1 || strategy.quantity > 5)) throw new Error("Strategy quantity must be 1 through 5 or Max allowed.");
  if (!Number.isInteger(strategy.maxSignalAgeSeconds) || strategy.maxSignalAgeSeconds < 10 || strategy.maxSignalAgeSeconds > 3_600) {
    throw new Error("Maximum signal age must be 10 through 3,600 seconds.");
  }
  if (typeof strategy.enabled !== "boolean" || typeof strategy.includeKeywords !== "string" || typeof strategy.excludeKeywords !== "string") {
    throw new Error("Strategy enabled and keyword fields have invalid types.");
  }
  const revision = Number(strategy.revision);
  return {
    ...strategy,
    id,
    name,
    enabled: strategy.enabled,
    position,
    revision: Number.isInteger(revision) && revision > 0 ? revision : 1,
    sources: stringList(strategy.sources, "Strategy sources"),
    retailers: stringList(strategy.retailers, "Strategy retailers"),
    allowedSellers: stringList(strategy.allowedSellers, "Allowed sellers"),
    includeKeywords: cleanText(strategy.includeKeywords, 2_000),
    excludeKeywords: cleanText(strategy.excludeKeywords, 2_000)
  };
}

export class ControlRepository {
  private readonly auditEvents: AuditRepository;
  private readonly purchasePolicies: PurchasePolicyRepository;
  private readonly signals: SignalRepository;
  private readonly spendLedger: SpendLedgerRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.auditEvents = new AuditRepository(db);
    this.purchasePolicies = new PurchasePolicyRepository(db);
    this.signals = new SignalRepository(db);
    this.spendLedger = new SpendLedgerRepository(db);
  }

  settings(): AppSettings {
    const row = this.db.get<{
      actions_paused: number;
      pause_reason: string;
      execution_mode: string;
      dedupe_window_seconds: number;
      affiliate_mode: string;
      tax_bps: number;
      store_allowances_json: string;
    }>("SELECT * FROM app_settings WHERE user_id = ?", currentRequestScope().userId);
    if (!row) throw new Error("Local application settings are unavailable.");
    return {
      actionsPaused: row.actions_paused === 1,
      pauseReason: row.pause_reason,
      executionMode: row.execution_mode === "live" ? "live" : "shadow",
      dedupeWindowSeconds: Number(row.dedupe_window_seconds),
      affiliateMode: row.affiliate_mode === "require" || row.affiliate_mode === "disabled"
        ? row.affiliate_mode
        : "prefer_fallback",
      taxBps: Number(row.tax_bps),
      storeAllowancesCents: JSON.parse(row.store_allowances_json) as Record<string, number>
    };
  }

  setActionsPaused(paused: boolean, reason = "User changed the global action state.", now = Date.now()): AppSettings {
    const normalizedReason = cleanText(reason, 240);
    this.db.run(
      "UPDATE app_settings SET actions_paused = ?, pause_reason = ?, updated_at = ? WHERE user_id = ?",
      paused ? 1 : 0,
      normalizedReason,
      nowIso(now),
      currentRequestScope().userId
    );
    this.auditEvents.record({
      correlationId: currentRequestScope().userId,
      aggregateType: "user_settings",
      eventType: "actions_pause_changed",
      reasonCode: paused ? "actions_paused" : "actions_resumed",
      message: paused ? "Retailer actions were globally paused." : "Qualified retailer actions were globally resumed.",
      data: { paused, reason: normalizedReason }
    }, now);
    return this.settings();
  }

  setTenantActionsPaused(
    paused: boolean,
    reason = "An administrator changed the tenant action state.",
    now = Date.now()
  ): TenantActionSettingsUpdate {
    const scope = currentRequestScope();
    const normalizedReason = cleanText(reason, 240);
    const affectedUserCount = this.db.transaction(() => {
      const updated = this.db.run(
        `UPDATE app_settings
         SET actions_paused = ?, pause_reason = ?, updated_at = ?
         WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)`,
        paused ? 1 : 0,
        normalizedReason,
        nowIso(now),
        scope.tenantId
      );
      this.auditEvents.record({
        correlationId: scope.actorId,
        aggregateType: "tenant_settings",
        eventType: "tenant_actions_pause_changed",
        reasonCode: paused ? "tenant_actions_paused" : "tenant_actions_resumed",
        message: paused
          ? "Retailer actions were paused for every shopper in the tenant."
          : "Qualified retailer actions were resumed for every shopper in the tenant.",
        data: { paused, reason: normalizedReason, affectedUserCount: Number(updated.changes ?? 0) }
      }, now);
      return Number(updated.changes ?? 0);
    });
    return { settings: this.settings(), affectedUserCount };
  }

  updateSettings(input: AppSettingsUpdateInput, now = Date.now()): AppSettings {
    const dedupeWindowSeconds = Number(input?.dedupeWindowSeconds);
    const taxBps = Number(input?.taxBps);
    if (!Number.isInteger(dedupeWindowSeconds) || dedupeWindowSeconds < 30 || dedupeWindowSeconds > 3_600) {
      throw new Error("The incident dedupe window must be 30 through 3,600 seconds.");
    }
    if (!["prefer_fallback", "require", "disabled"].includes(String(input?.affiliateMode))) {
      throw new Error("A supported affiliate-routing mode is required.");
    }
    if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10_000) {
      throw new Error("The tax reserve must be from 0% through 100%.");
    }
    if (!input.storeAllowancesCents || typeof input.storeAllowancesCents !== "object" || Array.isArray(input.storeAllowancesCents)) {
      throw new Error("Store allowances must be an object keyed by retailer.");
    }
    const allowances: Record<string, number> = {};
    for (const retailerId of SETTING_RETAILERS) {
      const value = Number(input.storeAllowancesCents[retailerId] ?? 0);
      if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
        throw new Error(`The ${retailerId} order allowance is invalid.`);
      }
      allowances[retailerId] = value;
    }
    this.db.run(
      `UPDATE app_settings SET dedupe_window_seconds = ?, affiliate_mode = ?,
         tax_bps = ?, store_allowances_json = ?, updated_at = ? WHERE user_id = ?`,
      dedupeWindowSeconds,
      input.affiliateMode,
      taxBps,
      JSON.stringify(allowances),
      nowIso(now),
      currentRequestScope().userId
    );
    this.auditEvents.record({
      correlationId: currentRequestScope().userId,
      aggregateType: "user_settings",
      eventType: "guardrail_settings_updated",
      reasonCode: "saved",
      message: "Signal deduplication, affiliate fallback, tax reserve, and store allowances were updated.",
      data: { dedupeWindowSeconds, affiliateMode: input.affiliateMode, taxBps, storeAllowancesCents: allowances }
    }, now);
    return this.settings();
  }

  listPurchaseProfiles(): PurchaseProfile[] {
    const row = this.db.get<{ purchase_profiles_json: string }>(
      "SELECT purchase_profiles_json FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    if (!row) throw new Error("Local application settings are unavailable.");
    try {
      const parsed = JSON.parse(row.purchase_profiles_json) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((value): value is PurchaseProfile => Boolean(value) && typeof value === "object")
        .map((profile) => ({
          ...profile,
          // Profiles pre-dating explicit fulfillment were shipping-only in
          // every quick-add call site. Preserve that behavior while upgrading
          // their projected contract without a migration or silent pickup.
          fulfillment: profile.fulfillment === "pickup" ? "pickup" : "shipping"
        }));
    } catch {
      return [];
    }
  }

  private validatePurchaseProfile(input: PurchaseProfileInput, existing: PurchaseProfile[], now: number): PurchaseProfile {
    const id = cleanText(input?.id, 120);
    const name = cleanText(input?.name, 60);
    if (!name) throw new Error("A purchase profile needs a short name.");
    if (name.toLocaleLowerCase("en-US") === "default") {
      throw new Error("\"Default\" is reserved for the built-in quick-add configuration.");
    }
    const duplicate = existing.find((profile) => profile.id !== id
      && profile.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"));
    if (duplicate) throw new Error("Another purchase profile already uses that name.");
    const targetQuantity = Number(input?.targetQuantity);
    if (!Number.isInteger(targetQuantity) || targetQuantity < 1 || targetQuantity > 99) {
      throw new Error("Profile quantity must be 1 through 99.");
    }
    const actionCeiling = input?.actionCeiling === "add_to_cart" ? "add_to_cart" : "notify";
    const fulfillment = input?.fulfillment === "pickup" ? "pickup" : "shipping";
    const priceMode = ["fixed_cap", "msrp", "msrp_offset_percent"].includes(String(input?.priceMode))
      ? (input?.priceMode as PurchaseProfile["priceMode"])
      : "store_price";
    let maxUnitPriceCents: number | null = null;
    let msrpOffsetPercent: number | null = null;
    if (priceMode === "fixed_cap") {
      maxUnitPriceCents = Number(input?.maxUnitPriceCents);
      if (!Number.isSafeInteger(maxUnitPriceCents) || maxUnitPriceCents < 1 || maxUnitPriceCents > 100_000_000) {
        throw new Error("A fixed-cap profile needs a positive maximum item price.");
      }
    }
    if (priceMode === "msrp_offset_percent") {
      msrpOffsetPercent = Number(input?.msrpOffsetPercent);
      if (!Number.isInteger(msrpOffsetPercent) || msrpOffsetPercent < -90 || msrpOffsetPercent > 90) {
        throw new Error("An MSRP-offset profile needs a whole-number percent from -90 through 90.");
      }
    }
    const cooldownSeconds = Number(input?.cooldownSeconds ?? 0);
    if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 2_592_000) {
      throw new Error("The profile wait between attempts must be from zero through 30 days.");
    }
    const isDefault = input?.isDefault === true;
    const timestamp = nowIso(now);
    const current = id ? existing.find((profile) => profile.id === id) : undefined;
    if (id && !current) throw new Error("That purchase profile no longer exists.");
    return {
      id: current?.id ?? newId("purchase_profile"),
      name,
      targetQuantity,
      actionCeiling,
      fulfillment,
      priceMode,
      maxUnitPriceCents,
      msrpOffsetPercent,
      isDefault,
      cooldownSeconds,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  savePurchaseProfile(input: PurchaseProfileInput, now = Date.now()): PurchaseProfileSaveResult {
    return this.db.transaction(() => {
      const existing = this.listPurchaseProfiles();
      const profile = this.validatePurchaseProfile(input, existing, now);
      const created = !existing.some((candidate) => candidate.id === profile.id);
      if (created && existing.length >= 12) {
        throw new Error("Up to 12 purchase profiles are supported; remove one first.");
      }
      let next = created
        ? [...existing, profile]
        : existing.map((candidate) => (candidate.id === profile.id ? profile : candidate));
      if (profile.isDefault) {
        next = next.map((candidate) => (candidate.id === profile.id ? candidate : { ...candidate, isDefault: false }));
      }
      this.db.run(
        "UPDATE app_settings SET purchase_profiles_json = ?, updated_at = ? WHERE user_id = ?",
        JSON.stringify(next),
        nowIso(now),
        currentRequestScope().userId
      );
      this.auditEvents.record({
        correlationId: currentRequestScope().userId,
        aggregateType: "user_settings",
        eventType: created ? "purchase_profile_created" : "purchase_profile_updated",
        reasonCode: "saved",
        message: created
          ? "A reusable quick-add purchase profile was created."
          : "A reusable quick-add purchase profile was updated.",
        data: { profile }
      }, now);
      const propagation = created
        ? { matchedMissionCount: 0, updatedMissionCount: 0, skipped: [] }
        : this.propagatePurchaseProfile(profile, now);
      return { profiles: next, propagation };
    });
  }

  deletePurchaseProfile(id: string, now = Date.now()): PurchaseProfile[] {
    return this.db.transaction(() => {
      const profileId = cleanText(id, 120);
      const existing = this.listPurchaseProfiles();
      const target = existing.find((profile) => profile.id === profileId);
      if (!target) throw new Error("That purchase profile no longer exists.");
      const next = existing.filter((profile) => profile.id !== profileId);
      this.db.run(
        "UPDATE app_settings SET purchase_profiles_json = ?, updated_at = ? WHERE user_id = ?",
        JSON.stringify(next),
        nowIso(now),
        currentRequestScope().userId
      );
      const unlinked = this.db.run(
        "UPDATE missions SET quick_add_profile_id = '', updated_at = ? WHERE tenant_id = ? AND user_id = ? AND quick_add_profile_id = ?",
        nowIso(now),
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        profileId
      );
      this.auditEvents.record({
        correlationId: currentRequestScope().userId,
        aggregateType: "user_settings",
        eventType: "purchase_profile_deleted",
        reasonCode: "deleted",
        message: "A reusable quick-add purchase profile was removed.",
        data: { profileId, name: target.name, unlinkedMissionCount: Number(unlinked.changes ?? 0) }
      }, now);
      return next;
    });
  }

  purchaseProfileLinkedMissionIds(id: string): string[] {
    const profileId = cleanText(id, 120);
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(profileId)) return [];
    return this.db.all<{ id: string }>(
      `SELECT id FROM missions
       WHERE tenant_id = ? AND user_id = ? AND quick_add_profile_id = ? AND status <> 'deleted'
       ORDER BY id`,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      profileId
    ).map((row) => row.id);
  }

  private resolveProfileUnitPriceCents(
    profile: PurchaseProfile,
    listing: { msrpCents: number | null; currentPriceCents: number | null }
  ): number | null {
    if (profile.priceMode === "fixed_cap") {
      return Number.isSafeInteger(profile.maxUnitPriceCents) && Number(profile.maxUnitPriceCents) > 0
        ? Number(profile.maxUnitPriceCents)
        : null;
    }
    if (profile.priceMode === "msrp") {
      return Number.isSafeInteger(listing.msrpCents) && Number(listing.msrpCents) > 0 ? Number(listing.msrpCents) : null;
    }
    if (profile.priceMode === "msrp_offset_percent") {
      if (!Number.isSafeInteger(listing.msrpCents) || Number(listing.msrpCents) <= 0) return null;
      const percent = Number.isInteger(profile.msrpOffsetPercent) ? Number(profile.msrpOffsetPercent) : 0;
      const cents = Math.round(Number(listing.msrpCents) * (100 + percent) / 100);
      return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
    }
    return Number.isSafeInteger(listing.currentPriceCents) && Number(listing.currentPriceCents) > 0
      ? Number(listing.currentPriceCents)
      : null;
  }

  private propagatePurchaseProfile(
    profile: PurchaseProfile,
    now: number,
    missionIds?: readonly string[]
  ): PurchaseProfilePropagationSummary {
    const scope = currentRequestScope();
    if (missionIds && !missionIds.length) {
      return { matchedMissionCount: 0, updatedMissionCount: 0, skipped: [] };
    }
    const missionFilter = missionIds
      ? ` AND m.id IN (${missionIds.map(() => "?").join(", ")})`
      : "";
    const missions = this.db.all<{ id: string; title: string; targetQuantity: number }>(
      `SELECT m.id, v.title, m.target_quantity AS targetQuantity
       FROM missions m JOIN variants v ON v.id = m.variant_id
       WHERE m.tenant_id = ? AND m.user_id = ? AND m.quick_add_profile_id = ?
         AND m.status IN ('active', 'paused')${missionFilter}`,
      scope.tenantId,
      scope.userId,
      profile.id,
      ...(missionIds ?? [])
    );
    if (!missions.length) return { matchedMissionCount: 0, updatedMissionCount: 0, skipped: [] };
    const settings = this.settings();
    const skipped: PurchaseProfilePropagationSkip[] = [];
    let updatedMissionCount = 0;
    for (const mission of missions) {
      const targets = this.db.all<{
        id: string;
        retailerId: string;
        executionSupported: number;
        maxUnitPriceCents: number | null;
        msrpCents: number | null;
        currentPriceCents: number | null;
      }>(
        `SELECT mt.id, l.retailer_id AS retailerId, l.execution_supported AS executionSupported,
                mt.max_unit_price_cents AS maxUnitPriceCents, l.msrp_cents AS msrpCents,
                (SELECT oo.unit_price_cents FROM offer_observations oo
                 WHERE oo.listing_id = l.id AND oo.unit_price_cents IS NOT NULL
                 ORDER BY oo.observed_at DESC LIMIT 1) AS currentPriceCents
         FROM mission_targets mt JOIN listings l ON l.id = mt.listing_id
         WHERE mt.mission_id = ? AND mt.enabled = 1`,
        mission.id
      );
      if (!targets.length) {
        skipped.push({ missionId: mission.id, title: mission.title, reasonCode: "no_enabled_target" });
        continue;
      }
      if (profile.actionCeiling === "add_to_cart"
        && targets.some((target) => Number(target.executionSupported) !== 1)) {
        skipped.push({ missionId: mission.id, title: mission.title, reasonCode: "unsupported_target" });
        continue;
      }
      const resolved: Array<{
        id: string;
        retailerId: string;
        executionSupported: boolean;
        maxUnitPriceCents: number | null;
      }> = [];
      let missingReason: "msrp_unavailable" | "price_unavailable" | null = null;
      for (const target of targets) {
        const unit = this.resolveProfileUnitPriceCents(profile, {
          msrpCents: target.msrpCents === null ? null : Number(target.msrpCents),
          currentPriceCents: target.currentPriceCents === null ? null : Number(target.currentPriceCents)
        });
        if (unit === null) {
          if (profile.actionCeiling === "add_to_cart") {
            missingReason = profile.priceMode === "msrp" || profile.priceMode === "msrp_offset_percent"
              ? "msrp_unavailable"
              : "price_unavailable";
            break;
          }
        }
        resolved.push({
          id: target.id,
          retailerId: target.retailerId,
          executionSupported: Number(target.executionSupported) === 1,
          // Reducing a profile to notification-only must never be blocked by
          // missing price evidence. Preserve the prior target cap until fresh
          // evidence can safely re-derive it.
          maxUnitPriceCents: unit ?? (target.maxUnitPriceCents === null ? null : Number(target.maxUnitPriceCents))
        });
      }
      if (missingReason) {
        skipped.push({ missionId: mission.id, title: mission.title, reasonCode: missingReason });
        continue;
      }
      const actionCeiling = profile.actionCeiling;
      const taxBps = actionCeiling === "add_to_cart" ? Math.max(0, settings.taxBps) : 0;
      let requiredAllInCents: number | undefined;
      if (actionCeiling === "add_to_cart") {
        requiredAllInCents = Math.max(...resolved.map((target) => {
          const itemTotal = Number(target.maxUnitPriceCents) * profile.targetQuantity;
          const storeReserve = Math.max(0, Number(settings.storeAllowancesCents[target.retailerId] ?? 0));
          return Math.ceil(itemTotal * (10_000 + taxBps) / 10_000) + storeReserve;
        }));
        if (!Number.isSafeInteger(requiredAllInCents) || requiredAllInCents <= 0) {
          skipped.push({ missionId: mission.id, title: mission.title, reasonCode: "no_enabled_target" });
          continue;
        }
      } else if (resolved.every((target) => target.maxUnitPriceCents !== null)) {
        requiredAllInCents = Math.max(...resolved.map((target) => Number(target.maxUnitPriceCents) * profile.targetQuantity));
      }
      const timestamp = nowIso(now);
      this.db.run(
        "UPDATE missions SET target_quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND user_id = ?",
        profile.targetQuantity,
        timestamp,
        mission.id,
        scope.tenantId,
        scope.userId
      );
      for (const target of resolved) {
        if (actionCeiling === "add_to_cart") {
          this.db.run(
            `UPDATE mission_targets
             SET max_unit_price_cents = ?, seller_policy = 'first_party_only', fulfillment = ?, updated_at = ?
             WHERE id = ? AND mission_id = ?`,
            target.maxUnitPriceCents,
            profile.fulfillment,
            timestamp,
            target.id,
            mission.id
          );
        } else {
          this.db.run(
            "UPDATE mission_targets SET max_unit_price_cents = ?, updated_at = ? WHERE id = ? AND mission_id = ?",
            target.maxUnitPriceCents,
            timestamp,
            target.id,
            mission.id
          );
        }
      }
      const intentPolicy = this.purchasePolicies.revise(mission.id, {
        ...(requiredAllInCents === undefined ? {} : { maxAllInCents: requiredAllInCents }),
        actionCeiling,
        decisionMode: "purchase_intent",
        cooldownSeconds: profile.cooldownSeconds,
        changeReason: `Quick-add profile "${profile.name}" was applied or updated; this plan's limits were automatically re-derived.`
      }, now);
      const stalePendingJobs = this.db.all<{ id: string }>(
        `SELECT id FROM action_jobs
         WHERE mission_id = ? AND tenant_id = ? AND user_id = ?
           AND intent_revision_id IS NOT NULL AND intent_revision_id <> ?
           AND state IN ('shadow_ready', 'awaiting_executor')
         ORDER BY created_at, id`,
        mission.id,
        scope.tenantId,
        scope.userId,
        intentPolicy.id
      );
      for (const job of stalePendingJobs) {
        this.signals.transitionJob(
          job.id,
          "cancelled",
          "intent_revision_superseded",
          "The purchase profile changed before the action was leased; the stale job and reservation were cancelled.",
          { intentRevision: intentPolicy.revision, purchaseProfileId: profile.id },
          now
        );
      }
      updatedMissionCount += 1;
    }
    return { matchedMissionCount: missions.length, updatedMissionCount, skipped };
  }

  applyPurchaseProfileToMissions(
    input: PurchaseProfileApplyInput,
    now = Date.now()
  ): PurchaseProfileApplyResult {
    if (input?.confirmation !== PURCHASE_PROFILE_APPLY_CONFIRMATION) {
      throw new PurchaseSafetyError(
        "purchase_profile_apply_confirmation_required",
        400,
        "Review and confirm the saved setup before applying it to purchase plans."
      );
    }
    const profileId = cleanText(input?.profileId, 120);
    const missionIds = Array.isArray(input?.missionIds)
      ? [...new Set(input.missionIds.map((id) => cleanText(id, 120)))]
      : [];
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(profileId)) {
      throw new PurchaseSafetyError("purchase_profile_invalid", 400, "Choose a current saved purchase profile.");
    }
    if (!missionIds.length || missionIds.length > 200
      || missionIds.some((id) => !/^[A-Za-z0-9_-]{3,120}$/.test(id))) {
      throw new PurchaseSafetyError(
        "purchase_profile_plan_selection_invalid",
        400,
        "Choose between one and 200 current purchase plans."
      );
    }

    return this.db.transaction(() => {
      const scope = currentRequestScope();
      const profile = this.listPurchaseProfiles().find((candidate) => candidate.id === profileId);
      if (!profile) {
        throw new PurchaseSafetyError("purchase_profile_not_found", 404, "That saved purchase profile no longer exists.");
      }
      const placeholders = missionIds.map(() => "?").join(", ");
      const missions = this.db.all<{ id: string; status: string }>(
        `SELECT id, status FROM missions
         WHERE tenant_id = ? AND user_id = ? AND status <> 'deleted'
           AND id IN (${placeholders})`,
        scope.tenantId,
        scope.userId,
        ...missionIds
      );
      if (missions.length !== missionIds.length) {
        throw new PurchaseSafetyError(
          "purchase_profile_plan_selection_stale",
          409,
          "One or more selected purchase plans changed. Refresh and review the selection again."
        );
      }
      if (missions.some((mission) => !["active", "paused"].includes(mission.status))) {
        throw new PurchaseSafetyError(
          "purchase_profile_plan_status_invalid",
          409,
          "Saved setups can be applied only to active or paused purchase plans."
        );
      }
      const timestamp = nowIso(now);
      let linkedMissionCount = 0;
      for (const missionId of missionIds) {
        const linked = this.db.run(
          `UPDATE missions SET quick_add_profile_id = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND user_id = ? AND status IN ('active', 'paused')`,
          profile.id,
          timestamp,
          missionId,
          scope.tenantId,
          scope.userId
        );
        linkedMissionCount += Number(linked.changes ?? 0);
      }
      const propagation = this.propagatePurchaseProfile(profile, now, missionIds);
      this.auditEvents.record({
        correlationId: profile.id,
        aggregateType: "purchase_profile",
        eventType: "purchase_profile_applied",
        reasonCode: "user_confirmed",
        message: "The user applied one saved purchase setup to an explicit set of current plans.",
        data: {
          profileId: profile.id,
          profileName: profile.name,
          actionCeiling: profile.actionCeiling,
          fulfillment: profile.fulfillment,
          selectedMissionCount: missionIds.length,
          linkedMissionCount,
          updatedMissionCount: propagation.updatedMissionCount,
          skippedMissionCount: propagation.skipped.length
        }
      }, now);
      return {
        profile,
        selectedMissionCount: missionIds.length,
        linkedMissionCount,
        propagation
      };
    });
  }

  reconcilePurchaseProfilesForRetailer(
    retailerId: string,
    now = Date.now()
  ): PurchaseProfileRetailerReconciliationResult {
    const normalizedRetailerId = cleanText(retailerId, 40) as PurchaseProfileRetailerReconciliationResult["retailerId"];
    if (!["target", "walmart", "amazon", "bestbuy"].includes(normalizedRetailerId)) {
      throw new Error("A guarded retailer is required for purchase-profile reconciliation.");
    }
    return this.db.transaction(() => {
      const scope = currentRequestScope();
      const profiles = new Map(this.listPurchaseProfiles()
        .filter((profile) => profile.actionCeiling === "add_to_cart")
        .map((profile) => [profile.id, profile]));
      const rows = this.db.all<{ missionId: string; profileId: string }>(
        `SELECT DISTINCT m.id AS missionId, m.quick_add_profile_id AS profileId
         FROM missions m
         JOIN mission_targets mt ON mt.mission_id = m.id AND mt.enabled = 1
         JOIN listings l ON l.id = mt.listing_id
         WHERE m.tenant_id = ? AND m.user_id = ? AND m.status IN ('active', 'paused')
           AND m.quick_add_profile_id <> '' AND l.retailer_id = ?
         ORDER BY m.id`,
        scope.tenantId,
        scope.userId,
        normalizedRetailerId
      ).filter((row) => profiles.has(row.profileId));
      const missionIdsByProfile = new Map<string, string[]>();
      for (const row of rows) {
        const ids = missionIdsByProfile.get(row.profileId) ?? [];
        ids.push(row.missionId);
        missionIdsByProfile.set(row.profileId, ids);
      }
      let updatedMissionCount = 0;
      const skipped: PurchaseProfilePropagationSkip[] = [];
      for (const [profileId, missionIds] of missionIdsByProfile) {
        const profile = profiles.get(profileId);
        if (!profile) continue;
        const propagation = this.propagatePurchaseProfile(profile, now, missionIds);
        updatedMissionCount += propagation.updatedMissionCount;
        skipped.push(...propagation.skipped);
      }
      const result: PurchaseProfileRetailerReconciliationResult = {
        retailerId: normalizedRetailerId,
        matchedProfileCount: missionIdsByProfile.size,
        matchedMissionCount: rows.length,
        updatedMissionCount,
        skipped
      };
      if (rows.length) {
        this.auditEvents.record({
          correlationId: normalizedRetailerId,
          aggregateType: "retailer_qualification",
          eventType: "purchase_profiles_reconciled",
          reasonCode: "retailer_lane_activated",
          message: "Previously reviewed saved setups were revalidated after a guarded retailer lane became executable.",
          data: {
            ...result,
            skippedMissionCount: skipped.length
          }
        }, now);
      }
      return result;
    });
  }

  reconcilePurchaseProfileForListing(
    listingId: string,
    now = Date.now()
  ): PurchaseProfilePropagationSummary {
    const id = cleanText(listingId, 120);
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(id)) {
      return { matchedMissionCount: 0, updatedMissionCount: 0, skipped: [] };
    }
    const scope = currentRequestScope();
    const linked = this.db.get<{
      missionId: string;
      profileId: string;
      missionUpdatedAt: string;
    }>(
      `SELECT m.id AS missionId, m.quick_add_profile_id AS profileId, m.updated_at AS missionUpdatedAt
       FROM missions m
       JOIN mission_targets mt ON mt.mission_id = m.id
       WHERE m.tenant_id = ? AND m.user_id = ? AND m.status IN ('active', 'paused')
         AND m.quick_add_profile_id <> '' AND mt.listing_id = ?
       LIMIT 1`,
      scope.tenantId,
      scope.userId,
      id
    );
    if (!linked) return { matchedMissionCount: 0, updatedMissionCount: 0, skipped: [] };
    const profile = this.listPurchaseProfiles().find((candidate) => candidate.id === linked.profileId);
    if (!profile) return { matchedMissionCount: 0, updatedMissionCount: 0, skipped: [] };
    const current = this.currentPurchaseIntentPolicy(linked.missionId, now);
    const profileChangedAfterMission = new Date(profile.updatedAt).getTime() > new Date(linked.missionUpdatedAt).getTime();
    if (current.actionCeiling === profile.actionCeiling && !profileChangedAfterMission) {
      return { matchedMissionCount: 1, updatedMissionCount: 0, skipped: [] };
    }
    return this.db.transaction(() => this.propagatePurchaseProfile(profile, now, [linked.missionId]));
  }

  listStrategies(): StrategyDefinition[] {
    return this.db.all<StrategyRow>(
      "SELECT id, name, enabled, position, revision, definition_json FROM strategies WHERE user_id = ? ORDER BY position, id",
      currentRequestScope().userId
    ).map(parseStrategy);
  }

  replaceStrategies(input: StrategyDefinition[], now = Date.now()): StrategyDefinition[] {
    if (!Array.isArray(input) || input.length > 100) throw new Error("Provide at most 100 ordered strategies.");
    const ids = new Set<string>();
    const positions = new Set<number>();
    const normalized = input.map((rawStrategy, index) => {
      const strategy = validatedStrategy(rawStrategy, index);
      const { id, name, position } = strategy;
      if (ids.has(id)) throw new Error("Every strategy needs a unique valid ID.");
      if (positions.has(position)) throw new Error("Every strategy needs a unique position from 1 through 10,000.");
      ids.add(id);
      positions.add(position);
      return strategy;
    });

    this.db.transaction(() => {
      const timestamp = nowIso(now);
      const current = new Map(this.listStrategies().map((strategy) => [strategy.id, strategy]));
      this.db.run("UPDATE strategies SET position = -position WHERE user_id = ?", currentRequestScope().userId);
      for (const strategy of normalized) {
        const previous = current.get(strategy.id);
        const comparable = { ...strategy, revision: previous?.revision ?? 1 };
        const changed = previous
          ? JSON.stringify({ ...previous, revision: 0 }) !== JSON.stringify({ ...comparable, revision: 0 })
          : true;
        const revision = previous ? previous.revision + (changed ? 1 : 0) : 1;
        const saved = { ...strategy, revision };
        this.db.run(
          `INSERT INTO strategies(
             id, tenant_id, user_id, name, enabled, position, revision,
             definition_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             enabled = excluded.enabled,
             position = excluded.position,
             revision = excluded.revision,
             definition_json = excluded.definition_json,
             updated_at = excluded.updated_at`,
          saved.id,
          currentRequestScope().tenantId,
          currentRequestScope().userId,
          saved.name,
          saved.enabled ? 1 : 0,
          saved.position,
          saved.revision,
          JSON.stringify(saved),
          timestamp,
          timestamp
        );
      }
      if (ids.size) {
        const placeholders = [...ids].map(() => "?").join(", ");
        this.db.run(`DELETE FROM strategies WHERE user_id = ? AND id NOT IN (${placeholders})`, currentRequestScope().userId, ...ids);
      } else {
        this.db.run("DELETE FROM strategies WHERE user_id = ?", currentRequestScope().userId);
      }
      this.auditEvents.record({
        correlationId: currentRequestScope().userId,
        aggregateType: "signal_strategy_set",
        eventType: "signal_strategies_replaced",
        reasonCode: "saved",
        message: `${normalized.length} ordered signal strateg${normalized.length === 1 ? "y was" : "ies were"} saved.`,
        data: { strategyIds: normalized.map((strategy) => strategy.id), enabledCount: normalized.filter((strategy) => strategy.enabled).length }
      }, now);
    });
    return this.listStrategies();
  }

  ensureMission(variantId: string, listingId: string, origin: string, now = Date.now()): MissionEnsureResult {
    return this.ensureMissionInternal(variantId, listingId, origin, now);
  }

  ensureUserMission(variantId: string, listingId: string, now = Date.now()): MissionEnsureResult {
    return this.ensureMissionInternal(variantId, listingId, "user_selected_legacy", now, {
      targetQuantity: 1,
      selectedOnly: true,
      selectedMaxUnitPriceCents: null,
      selectedSellerPolicy: "first_party_only",
      selectedFulfillment: "inherit",
      initialPolicy: {
        actionCeiling: "notify",
        decisionMode: "purchase_intent",
        maxSignalAgeSeconds: 120,
        substitutionPolicy: "exact_only",
        cooldownSeconds: 0,
        changeReason: "Safe user draft created; explicit limits are still required before automated cart actions."
      }
    });
  }

  private validateConfiguredMissionDraft(
    input: PurchaseIntentDraftInput,
    now: number,
    mode: "preview" | "create" = "create"
  ): ValidatedConfiguredMission {
    const listingId = cleanText(input?.listingId, 120);
    const row = this.db.get<{
      variantId: string;
      title: string;
      retailerId: string;
      retailerName: string;
      retailerSku: string;
      executionSupported: number;
      currency: string;
    }>(
      `SELECT l.variant_id AS variantId, v.title, l.retailer_id AS retailerId,
              r.display_name AS retailerName, l.retailer_sku AS retailerSku,
              l.execution_supported AS executionSupported, l.currency
       FROM listings l
       JOIN variants v ON v.id = l.variant_id
       JOIN retailers r ON r.id = l.retailer_id
       WHERE l.id = ?`,
      listingId
    );
    if (!row) throw new PurchaseSafetyError("purchase_listing_not_found", 404, "The exact retailer listing no longer exists.");
    if (row.currency !== "USD") {
      throw new PurchaseSafetyError("purchase_intent_currency_unsupported", 409, "Guided purchase plans currently require a USD listing.");
    }
    const listing: ConfiguredMissionListing = {
      ...row,
      executionSupported: Number(row.executionSupported) === 1
    };
    const targetQuantity = Number(input?.targetQuantity);
    const maxUnitPriceCents = Number(input?.maxUnitPriceCents);
    const maxAllInCents = Number(input?.maxAllInCents);
    const cooldownSeconds = Number(input?.cooldownSeconds);
    if (typeof input?.targetQuantity !== "number" || !Number.isInteger(targetQuantity) || targetQuantity < 1 || targetQuantity > 99) {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "Quantity must be 1 through 99.");
    }
    if (typeof input?.maxUnitPriceCents !== "number" || !Number.isSafeInteger(maxUnitPriceCents) || maxUnitPriceCents <= 0 || maxUnitPriceCents > 100_000_000) {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "The maximum item price must be a positive number of cents.");
    }
    if (typeof input?.maxAllInCents !== "number" || !Number.isSafeInteger(maxAllInCents) || maxAllInCents <= 0 || maxAllInCents > 100_000_000) {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "The maximum all-in total must be a positive number of cents.");
    }
    const itemSubtotalCapCents = maxUnitPriceCents * targetQuantity;
    if (!Number.isSafeInteger(itemSubtotalCapCents)) {
      throw new PurchaseSafetyError(
        "purchase_intent_invalid",
        400,
        "The maximum all-in total must cover the maximum item price multiplied by the requested quantity."
      );
    }
    if (typeof input?.cooldownSeconds !== "number" || !Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 2_592_000) {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "The wait between attempts must be from zero through 30 days.");
    }
    if (!["notify", "add_to_cart"].includes(String(input?.actionCeiling))) {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "Yoink may only notify or add an exact item to the cart from this setup flow.");
    }
    if (input?.sellerPolicy !== "first_party_only" || input?.substitutionPolicy !== "exact_only") {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "Guided purchase plans require the retailer itself and the exact selected item.");
    }
    if (!["shipping", "pickup", "either", "manual"].includes(String(input?.fulfillment))) {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "Choose Shipping or Pickup.");
    }
    const fulfillment = input.fulfillment === "pickup"
      ? "pickup"
      : "shipping";
    if (input.actionCeiling === "add_to_cart" && !["shipping", "pickup"].includes(fulfillment)) {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "Automatic cart actions require an exact Shipping or Pickup choice.");
    }
    if (input.actionCeiling === "add_to_cart" && !listing.executionSupported) {
      throw new PurchaseSafetyError("purchase_intent_execution_unavailable", 409, "This store is monitor-only until its add-to-cart mapping is separately qualified.");
    }
    const expiresAtInput = cleanText(input?.expiresAt, 40);
    let expiresAt = "";
    if (expiresAtInput) {
      const expiry = new Date(expiresAtInput).getTime();
      if (!Number.isFinite(expiry) || expiry <= now || expiry > now + MAX_POLICY_LIFETIME_MS) {
        throw new PurchaseSafetyError("purchase_intent_invalid", 400, "Intent expiry must be a future timestamp no more than one year away.");
      }
      expiresAt = new Date(expiry).toISOString();
    }
    const settings = this.settings();
    const taxReserveCents = input.actionCeiling === "add_to_cart"
      ? Math.ceil(itemSubtotalCapCents * Math.max(0, settings.taxBps) / 10_000)
      : 0;
    const storeReserveCents = input.actionCeiling === "add_to_cart"
      ? Math.max(0, Number(settings.storeAllowancesCents[listing.retailerId] ?? 0))
      : 0;
    const minimumAllInCents = itemSubtotalCapCents + taxReserveCents + storeReserveCents;
    if (!Number.isSafeInteger(minimumAllInCents)) {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "The computed maximum total is invalid.");
    }
    const tooLow = maxAllInCents < minimumAllInCents;
    if (mode === "create" && tooLow) {
      throw new PurchaseSafetyError(
        "purchase_intent_all_in_bound_too_low",
        400,
        `Automatic cart actions need a maximum total of at least $${(minimumAllInCents / 100).toFixed(2)} under the current tax and store-fee safety reserve. Choose notifications only or raise the reviewed total.`
      );
    }
    // In preview mode a too-low reviewed total is never fatal: the item price is the
    // only figure the user actually sets, and tax/store-fee reserves are always
    // layered on top automatically. The raised total is echoed back in both the
    // draft and the cost breakdown so the client can resubmit it verbatim for
    // creation, and the preflight fingerprint below binds to this raised value.
    const autoRaised = mode === "preview" && tooLow;
    const reviewedAllInCents = autoRaised ? minimumAllInCents : maxAllInCents;
    const spendingLimit = input.actionCeiling === "add_to_cart"
      ? this.spendLedger.evaluatePlannedAmount(reviewedAllInCents, now)
      : { allowed: true, reasonCode: "notifications_only", message: "Notifications do not reserve spending capacity." };
    if (mode === "create" && !spendingLimit.allowed) {
      throw new PurchaseSafetyError(spendingLimit.reasonCode, 409, `${spendingLimit.message} Lower this plan's maximum or raise the spending limit first.`);
    }
    return {
      listingId,
      listing,
      draft: {
        listingId,
        targetQuantity,
        maxUnitPriceCents,
        maxAllInCents: reviewedAllInCents,
        actionCeiling: input.actionCeiling,
        sellerPolicy: "first_party_only",
        fulfillment,
        substitutionPolicy: "exact_only",
        expiresAt,
        cooldownSeconds
      },
      cost: {
        currency: listing.currency,
        itemSubtotalCapCents,
        taxReserveCents,
        storeReserveCents,
        minimumAllInCents,
        reviewedAllInCents,
        headroomCents: reviewedAllInCents - minimumAllInCents,
        autoRaised,
        spendingLimit
      }
    };
  }

  previewConfiguredMission(input: PurchaseIntentPreflightInput, now = Date.now()): ConfiguredMissionPreflight {
    if (input?.contractVersion !== 2) {
      throw new PurchaseSafetyError("purchase_intent_contract_unsupported", 400, "A supported purchase-plan contract version is required.");
    }
    if (input?.confirmation !== "PREFLIGHT_EXACT_PURCHASE_PLAN") {
      throw new PurchaseSafetyError("purchase_intent_preflight_confirmation_required", 400, "Request an explicit no-write purchase-plan preview.");
    }
    const validated = this.validateConfiguredMissionDraft(input, now, "preview");
    const existing = this.db.get<{ id: string; status: string }>(
      "SELECT id, status FROM missions WHERE user_id = ? AND variant_id = ?",
      currentRequestScope().userId,
      validated.listing.variantId
    );
    if (existing && existing.status !== "deleted") {
      throw new PurchaseSafetyError("purchase_intent_exists", 409, "A purchase plan already exists for this exact product. Open it to review the current limits.");
    }
    const { variantId: _variantId, ...publicListing } = validated.listing;
    return {
      contractVersion: 1,
      noPurchasePlanSaved: true,
      listing: { listingId: validated.listingId, ...publicListing },
      draft: validated.draft,
      cost: validated.cost,
      readinessPlan: {
        id: "purchase_intent_preflight",
        status: "active",
        title: validated.listing.title,
        targetQuantity: validated.draft.targetQuantity,
        maxAllInCents: validated.draft.maxAllInCents,
        actionCeiling: validated.draft.actionCeiling,
        decisionMode: "purchase_intent",
        expiresAt: validated.draft.expiresAt,
        targets: [{
          targetId: "",
          listingId: validated.listingId,
          retailerId: validated.listing.retailerId,
          retailerName: validated.listing.retailerName,
          retailerSku: validated.listing.retailerSku,
          enabled: true,
          executionSupported: validated.listing.executionSupported,
          maxUnitPriceCents: validated.draft.maxUnitPriceCents,
          sellerPolicy: "first_party_only",
          fulfillment: validated.draft.fulfillment
        }]
      }
    };
  }

  createConfiguredMission(
    input: PurchaseIntentCreateInput,
    now = Date.now(),
    expectedPreflightFingerprint = ""
  ): MissionEnsureResult {
    if (typeof input?.contractVersion !== "number" || ![1, 2].includes(input.contractVersion)) {
      throw new PurchaseSafetyError("purchase_intent_contract_unsupported", 400, "A supported purchase-plan contract version is required.");
    }
    if (input?.confirmation !== "CREATE_EXACT_PURCHASE_PLAN") {
      throw new PurchaseSafetyError("purchase_intent_confirmation_required", 400, "Review and confirm the exact purchase plan before creating it.");
    }
    if (input.contractVersion === 2) {
      const presentedFingerprint = cleanText(input.preflightFingerprint, 64);
      const expectedFingerprint = cleanText(expectedPreflightFingerprint, 64);
      if (!/^[a-f0-9]{64}$/.test(presentedFingerprint) || presentedFingerprint !== expectedFingerprint) {
        throw new PurchaseSafetyError("purchase_intent_preflight_required", 409, "Your plan preview changed or is missing. Review the current server check before creating this plan.");
      }
      const preflightedAt = new Date(cleanText(input.preflightedAt, 40)).getTime();
      const maximumAgeMs = PURCHASE_INTENT_PREFLIGHT_TTL_SECONDS * 1_000;
      if (!Number.isFinite(preflightedAt) || preflightedAt > now + 30_000 || preflightedAt < now - maximumAgeMs) {
        throw new PurchaseSafetyError("purchase_intent_preflight_stale", 409, "Your plan preview expired. Run the server check again before creating this plan.");
      }
    }
    const validated = this.validateConfiguredMissionDraft(input, now, "create");
    const { listingId, listing, draft } = validated;
    const quickAddProfileId = cleanText(input.quickAddProfileId, 120);

    return this.db.transaction(() => {
      const result = this.ensureMissionInternal(listing.variantId, listingId, "user_guided", now, {
        targetQuantity: draft.targetQuantity,
        selectedOnly: true,
        selectedMaxUnitPriceCents: draft.maxUnitPriceCents,
        selectedSellerPolicy: "first_party_only",
        selectedFulfillment: draft.fulfillment,
        quickAddProfileId,
        initialPolicy: {
          maxAllInCents: draft.maxAllInCents,
          actionCeiling: draft.actionCeiling,
          decisionMode: "purchase_intent",
          maxSignalAgeSeconds: 120,
          substitutionPolicy: "exact_only",
          expiresAt: draft.expiresAt,
          cooldownSeconds: draft.cooldownSeconds,
          changeReason: "Exact purchase plan reviewed and created from the guided user setup."
        }
      });
      if (!result.created) {
        throw new PurchaseSafetyError(
          "purchase_intent_exists",
          409,
          "A purchase plan already exists for this exact product. Open it to review the current limits."
        );
      }
      return result;
    });
  }

  private ensureMissionInternal(
    variantId: string,
    listingId: string,
    origin: string,
    now: number,
    creation?: MissionCreationConfiguration
  ): MissionEnsureResult {
    return this.db.transaction(() => {
      const timestamp = nowIso(now);
      let mission = this.db.get<{ id: string; status: MissionStatus }>(
        "SELECT id, status FROM missions WHERE tenant_id = ? AND user_id = ? AND variant_id = ?",
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        variantId
      );
      const recreated = mission?.status === "deleted" && creation !== undefined;
      const created = !mission || recreated;
      if (!mission) {
        mission = { id: newId("mission"), status: "active" };
        this.db.run(
          `INSERT INTO missions(
             id, tenant_id, user_id, variant_id, status, origin,
             target_quantity, fulfilled_quantity, quick_add_profile_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?, ?, ?)`,
          mission.id,
          currentRequestScope().tenantId,
          currentRequestScope().userId,
          variantId,
          cleanText(origin, 60),
          creation?.targetQuantity ?? 1,
          cleanText(creation?.quickAddProfileId ?? "", 120),
          timestamp,
          timestamp
        );
      } else if (recreated) {
        this.db.run(
          `UPDATE missions
           SET status = 'active', origin = ?, target_quantity = ?, fulfilled_quantity = 0,
               quick_add_profile_id = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'deleted'`,
          cleanText(origin, 60),
          creation.targetQuantity,
          cleanText(creation.quickAddProfileId ?? "", 120),
          timestamp,
          mission.id,
          currentRequestScope().tenantId,
          currentRequestScope().userId
        );
      }
      const listing = this.db.get<{ variant_id: string }>("SELECT variant_id FROM listings WHERE id = ?", listingId);
      if (!listing || listing.variant_id !== variantId) throw new Error("The mission target listing does not belong to the exact variant.");
      const variantListings = this.db.all<{ id: string; currency: string }>(
        "SELECT id, currency FROM listings WHERE variant_id = ?",
        variantId
      );
      for (const target of variantListings) {
        const selected = target.id === listingId;
        const enabled = creation?.selectedOnly ? selected : true;
        const maxUnitPriceCents = creation && selected ? creation.selectedMaxUnitPriceCents : null;
        const sellerPolicy = creation && selected ? creation.selectedSellerPolicy : "inherit";
        const fulfillment = creation && selected ? creation.selectedFulfillment : "inherit";
        const conflictAction = recreated
          ? `ON CONFLICT(mission_id, listing_id) DO UPDATE SET
               enabled = excluded.enabled,
               max_unit_price_cents = excluded.max_unit_price_cents,
               currency = excluded.currency,
               seller_policy = excluded.seller_policy,
               fulfillment = excluded.fulfillment,
               updated_at = excluded.updated_at`
          : "ON CONFLICT(mission_id, listing_id) DO NOTHING";
        this.db.run(
          `INSERT INTO mission_targets(
             id, mission_id, listing_id, enabled, max_unit_price_cents,
             currency, seller_policy, fulfillment, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ${conflictAction}`,
          newId("mission_target"),
          mission.id,
          target.id,
          enabled ? 1 : 0,
          maxUnitPriceCents,
          target.currency,
          sellerPolicy,
          fulfillment,
          timestamp,
          timestamp
        );
      }
      if (created) {
        this.auditEvents.record({
          correlationId: mission.id,
          aggregateType: "mission",
          eventType: recreated ? "mission_recreated" : "mission_created",
          reasonCode: recreated ? "user_recreated" : cleanText(origin, 60) || "created",
          message: recreated
            ? "A previously deleted purchase plan was recreated from a new explicit user review."
            : "A mission was created for an exact product variant and all known retailer targets were attached.",
          data: {
            variantId,
            initialListingId: listingId,
            targetCount: variantListings.length,
            enabledTargetCount: creation?.selectedOnly ? 1 : variantListings.length,
            creationMode: creation ? "explicit_user_configuration" : "strategy_or_internal",
            recreated
          }
        }, now);
      }
      if (recreated) {
        this.purchasePolicies.revise(mission.id, {
          ...creation.initialPolicy,
          changeReason: cleanText(creation.initialPolicy.changeReason, 300)
            || "Deleted purchase plan recreated after a new explicit review."
        }, now);
      } else {
        this.purchasePolicies.ensureCurrent(mission.id, now, creation?.initialPolicy);
      }
      return { mission: this.requireMissionContext(mission.id, listingId), created };
    });
  }

  requireMissionContext(missionId: string, listingId: string): MissionContext {
    const row = this.db.get<MissionRow>(
      `SELECT m.id, m.status, m.target_quantity, mt.id AS target_id,
              mt.enabled AS target_enabled, mt.max_unit_price_cents,
              mt.seller_policy, mt.fulfillment
       FROM missions m JOIN mission_targets mt ON mt.mission_id = m.id
       WHERE m.id = ? AND mt.listing_id = ? AND m.tenant_id = ? AND m.user_id = ?`,
      missionId,
      listingId,
      currentRequestScope().tenantId,
      currentRequestScope().userId
    );
    if (!row) throw new Error("The mission target no longer exists.");
    return missionContext(row);
  }

  currentPurchaseIntentPolicy(missionId: string, now = Date.now()): PurchaseIntentPolicy {
    return this.purchasePolicies.ensureCurrent(missionId, now);
  }

  findMissionForListing(listingId: string): MissionContext | null {
    const row = this.db.get<MissionRow>(
      `SELECT m.id, m.status, m.target_quantity, mt.id AS target_id,
              mt.enabled AS target_enabled, mt.max_unit_price_cents,
              mt.seller_policy, mt.fulfillment
       FROM listings l
       JOIN missions m ON m.variant_id = l.variant_id AND m.user_id = ?
       JOIN mission_targets mt ON mt.mission_id = m.id AND mt.listing_id = l.id
       WHERE l.id = ?`,
      currentRequestScope().userId,
      listingId
    );
    return row ? missionContext(row) : null;
  }

  setMissionTargetQuantity(missionId: string, quantity: number, now = Date.now()): void {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Mission quantity must be 1 through 99.");
    this.db.transaction(() => {
      this.db.run(
        "UPDATE missions SET target_quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        quantity,
        nowIso(now),
        missionId,
        currentRequestScope().userId
      );
      this.purchasePolicies.revise(missionId, { changeReason: "Signal strategy established the requested quantity." }, now);
    });
  }

  missionDetail(missionId: string): Record<string, unknown> | null {
    const mission = this.db.get<Record<string, unknown>>(
      `SELECT m.id, m.status, m.origin, m.target_quantity AS targetQuantity,
              m.fulfilled_quantity AS fulfilledQuantity, m.variant_id AS variantId,
              v.title, m.created_at AS createdAt, m.updated_at AS updatedAt
       FROM missions m JOIN variants v ON v.id = m.variant_id
       WHERE m.id = ? AND m.user_id = ? AND m.status <> 'deleted'`,
      cleanText(missionId, 120),
      currentRequestScope().userId
    );
    if (!mission) return null;
    const targets = this.db.all<Record<string, unknown>>(
      `SELECT mt.id, mt.enabled, mt.max_unit_price_cents AS maxUnitPriceCents,
              mt.currency, mt.seller_policy AS sellerPolicy, mt.fulfillment,
              l.id AS listingId, l.retailer_id AS retailerId,
              r.display_name AS retailerName, l.retailer_sku AS retailerSku,
              l.canonical_url AS canonicalUrl, l.status AS listingStatus,
              l.execution_supported AS executionSupported, l.msrp_cents AS msrpCents,
              (SELECT oo.unit_price_cents FROM offer_observations oo
               WHERE oo.listing_id = l.id ORDER BY oo.observed_at DESC LIMIT 1) AS lastObservedPriceCents,
              mt.created_at AS createdAt, mt.updated_at AS updatedAt
       FROM mission_targets mt
       JOIN listings l ON l.id = mt.listing_id
       JOIN retailers r ON r.id = l.retailer_id
       WHERE mt.mission_id = ? ORDER BY r.display_name, l.retailer_sku`,
      mission.id as string
    ).map((target) => ({
      ...target,
      enabled: Number(target.enabled) === 1,
      executionSupported: Number(target.executionSupported) === 1
    }));
    return { ...mission, intentPolicy: this.purchasePolicies.current(String(mission.id)), targets };
  }

  private legacyPurchaseIntentTransitionRows(): LegacyPurchaseIntentTransitionRow[] {
    return this.db.all<LegacyPurchaseIntentTransitionRow>(
      `SELECT m.id, v.title, m.origin, m.status, ir.revision,
              ir.policy_hash AS policyHash, m.updated_at AS updatedAt
       FROM missions m
       JOIN variants v ON v.id = m.variant_id
       JOIN mission_intent_revisions ir ON ir.mission_id = m.id
       WHERE m.user_id = ? AND m.status IN ('active', 'paused')
         AND m.origin LIKE 'signal:%'
         AND ir.decision_mode = 'strategy'
         AND ir.revision = (
           SELECT MAX(current_ir.revision)
           FROM mission_intent_revisions current_ir
           WHERE current_ir.mission_id = m.id
         )
       ORDER BY m.id`,
      currentRequestScope().userId
    );
  }

  legacyPurchaseIntentTransitionPreview(): LegacyPurchaseIntentTransitionPreview {
    const rows = this.legacyPurchaseIntentTransitionRows();
    const previewFingerprint = stableHash(
      "legacy-purchase-intent-transition-v1",
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      ...rows.flatMap((row) => [
        row.id,
        row.origin,
        row.status,
        Number(row.revision),
        row.policyHash,
        row.updatedAt
      ])
    );
    return {
      contractVersion: LEGACY_PURCHASE_INTENT_TRANSITION_CONTRACT_VERSION,
      eligibleCount: rows.length,
      activeCount: rows.filter((row) => row.status === "active").length,
      pausedCount: rows.filter((row) => row.status === "paused").length,
      previewFingerprint,
      outcome: "notification_only",
      retailerMutationAuthorized: false,
      checkoutAuthorized: false,
      samplePlans: rows.slice(0, 5).map((row) => ({ id: row.id, title: row.title, status: row.status }))
    };
  }

  transitionLegacyPurchaseIntents(
    input: LegacyPurchaseIntentTransitionInput,
    now = Date.now()
  ): LegacyPurchaseIntentTransitionResult {
    if (input?.contractVersion !== LEGACY_PURCHASE_INTENT_TRANSITION_CONTRACT_VERSION
      || input?.confirmation !== LEGACY_PURCHASE_INTENT_TRANSITION_CONFIRMATION
      || !/^[a-f0-9]{64}$/.test(String(input?.previewFingerprint ?? ""))) {
      throw new PurchaseSafetyError(
        "legacy_purchase_intent_transition_confirmation_required",
        400,
        "Review the current legacy-plan preview and explicitly confirm notification-only transition."
      );
    }
    return this.db.transaction(() => {
      const preview = this.legacyPurchaseIntentTransitionPreview();
      if (input.previewFingerprint !== preview.previewFingerprint) {
        throw new PurchaseSafetyError(
          "legacy_purchase_intent_transition_stale",
          409,
          "The eligible legacy plans changed after preview. Review the current transition summary before trying again."
        );
      }
      const rows = this.legacyPurchaseIntentTransitionRows();
      let cancelledPendingJobCount = 0;
      for (const row of rows) {
        const intentPolicy = this.purchasePolicies.revise(row.id, {
          expectedRevision: Number(row.revision),
          actionCeiling: "notify",
          decisionMode: "purchase_intent",
          changeReason: "Explicitly converted from a legacy strategy plan to a user-controlled notification plan."
        }, now);
        const stalePendingJobs = this.db.all<{ id: string }>(
          `SELECT id FROM action_jobs
           WHERE mission_id = ? AND user_id = ?
             AND intent_revision_id IS NOT NULL AND intent_revision_id <> ?
             AND state IN ('shadow_ready', 'awaiting_executor')
           ORDER BY created_at, id`,
          row.id,
          currentRequestScope().userId,
          intentPolicy.id
        );
        for (const job of stalePendingJobs) {
          this.signals.transitionJob(
            job.id,
            "cancelled",
            "intent_revision_superseded",
            "The legacy plan was converted before the action was leased; the stale job and reservation were cancelled.",
            { intentRevision: intentPolicy.revision },
            now
          );
          cancelledPendingJobCount += 1;
        }
      }
      if (rows.length) {
        this.auditEvents.record({
          correlationId: currentRequestScope().userId,
          aggregateType: "purchase_intent_set",
          eventType: "legacy_purchase_intents_transitioned",
          reasonCode: "notification_only",
          message: `${rows.length} legacy purchase plan${rows.length === 1 ? " was" : "s were"} converted to explicit notification-only plans.`,
          data: {
            transitionedPlanIds: rows.map((row) => row.id),
            transitionedCount: rows.length,
            cancelledPendingJobCount,
            retailerMutationAuthorized: false,
            checkoutAuthorized: false
          }
        }, now);
      }
      return {
        transitionedCount: rows.length,
        cancelledPendingJobCount,
        transitionedPlanIds: rows.map((row) => row.id),
        preview: this.legacyPurchaseIntentTransitionPreview()
      };
    });
  }

  updateMission(missionId: string, input: MissionUpdateInput, now = Date.now()): Record<string, unknown> {
    const id = cleanText(missionId, 120);
    const status = String(input?.status || "");
    const targetQuantity = Number(input?.targetQuantity);
    if (!EDITABLE_MISSION_STATUSES.has(status)) throw new Error("A supported mission status is required.");
    if (!Number.isInteger(targetQuantity) || targetQuantity < 1 || targetQuantity > 99) {
      throw new Error("Mission quantity must be 1 through 99.");
    }
    if (!Array.isArray(input?.targets) || input.targets.length > 10_000) {
      throw new Error("Mission targets must be a list of at most 10,000 exact listings.");
    }
    const normalizedTargets = input.targets.map((target) => {
      const targetId = cleanText(target?.id, 120);
      const cap = target?.maxUnitPriceCents === null || target?.maxUnitPriceCents === undefined
        ? null
        : Number(target.maxUnitPriceCents);
      if (!/^[A-Za-z0-9_-]{3,120}$/.test(targetId) || typeof target?.enabled !== "boolean") {
        throw new Error("Every mission target needs a valid ID and enabled state.");
      }
      if (cap !== null && (!Number.isSafeInteger(cap) || cap <= 0 || cap > 100_000_000)) {
        throw new Error("Every mission target price cap must be a positive amount or blank.");
      }
      if (!MISSION_TARGET_POLICIES.has(String(target.sellerPolicy))) {
        throw new Error("Every mission target needs a supported seller policy.");
      }
      if (!MISSION_TARGET_FULFILLMENTS.has(String(target.fulfillment))) {
        throw new Error("Every mission target needs a supported fulfillment policy.");
      }
      return {
        id: targetId,
        enabled: target.enabled,
        maxUnitPriceCents: cap,
        sellerPolicy: String(target.sellerPolicy),
        fulfillment: target.fulfillment
      };
    });
    const targetIds = new Set(normalizedTargets.map((target) => target.id));
    if (targetIds.size !== normalizedTargets.length) throw new Error("Mission target IDs must be unique.");

    return this.db.transaction(() => {
      const existing = this.db.get<{ id: string }>(
        "SELECT id FROM missions WHERE id = ? AND user_id = ? AND status <> 'deleted'",
        id,
        currentRequestScope().userId
      );
      if (!existing) throw new Error("The mission does not exist.");
      const ownedTargets = new Set(this.db.all<{ id: string }>(
        "SELECT id FROM mission_targets WHERE mission_id = ?",
        id
      ).map((target) => target.id));
      if (ownedTargets.size !== normalizedTargets.length || normalizedTargets.some((target) => !ownedTargets.has(target.id))) {
        throw new Error("Submit the complete exact target set for this mission.");
      }
      const timestamp = nowIso(now);
      this.db.run(
        "UPDATE missions SET status = ?, target_quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        status,
        targetQuantity,
        timestamp,
        id,
        currentRequestScope().userId
      );
      for (const target of normalizedTargets) {
        this.db.run(
          `UPDATE mission_targets SET enabled = ?, max_unit_price_cents = ?,
             seller_policy = ?, fulfillment = ?, updated_at = ?
           WHERE id = ? AND mission_id = ?`,
          target.enabled ? 1 : 0,
          target.maxUnitPriceCents,
          target.sellerPolicy,
          target.fulfillment,
          timestamp,
          target.id,
          id
        );
      }
      const intentPolicy = this.purchasePolicies.revise(id, input.policy ?? {}, now);
      const stalePendingJobs = this.db.all<{ id: string }>(
        `SELECT id FROM action_jobs
         WHERE mission_id = ? AND user_id = ?
           AND intent_revision_id IS NOT NULL AND intent_revision_id <> ?
           AND state IN ('shadow_ready', 'awaiting_executor')
         ORDER BY created_at, id`,
        id,
        currentRequestScope().userId,
        intentPolicy.id
      );
      for (const job of stalePendingJobs) {
        this.signals.transitionJob(
          job.id,
          "cancelled",
          "intent_revision_superseded",
          "The purchase intent changed before the action was leased; the stale job and reservation were cancelled.",
          { intentRevision: intentPolicy.revision },
          now
        );
      }
      const detail = this.missionDetail(id);
      if (!detail) throw new Error("The updated mission could not be loaded.");
      this.auditEvents.record({
        correlationId: id,
        aggregateType: "mission",
        eventType: "mission_updated",
        reasonCode: status,
        message: "Mission status, quantity, and exact retailer targets were updated.",
        data: {
          status,
          targetQuantity,
          intentRevision: intentPolicy.revision,
          targetCount: normalizedTargets.length,
          enabledTargetCount: normalizedTargets.filter((target) => target.enabled).length
        }
      }, now);
      return detail;
    });
  }

  deleteMission(
    missionId: string,
    input: PurchaseIntentDeleteInput,
    now = Date.now()
  ): {
    id: string;
    deleted: true;
    cancelledPendingJobCount: number;
    cancelledWatchItemCount: number;
  } {
    const id = cleanText(missionId, 120);
    if (input?.confirmation !== PURCHASE_INTENT_DELETE_CONFIRMATION) {
      throw new PurchaseSafetyError(
        "purchase_intent_delete_confirmation_required",
        400,
        "Confirm that you want to permanently remove this purchase plan."
      );
    }
    return this.db.transaction(() => {
      const mission = this.db.get<{ id: string; status: string; variantId: string; title: string }>(
        `SELECT m.id, m.status, m.variant_id AS variantId, v.title
         FROM missions m JOIN variants v ON v.id = m.variant_id
         WHERE m.id = ? AND m.tenant_id = ? AND m.user_id = ? AND m.status <> 'deleted'`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId
      );
      if (!mission) {
        throw new PurchaseSafetyError("purchase_intent_not_found", 404, "The purchase plan does not exist.");
      }
      const openJobs = this.db.all<{ id: string; state: JobState }>(
        `SELECT id, state FROM action_jobs
         WHERE mission_id = ? AND tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId
      ).filter((job) => !jobIsTerminal(job.state));
      const uncertainJob = openJobs.find((job) => jobMayHaveMutated(job.state));
      if (uncertainJob) {
        throw new PurchaseSafetyError(
          "purchase_intent_action_in_progress",
          409,
          "This plan has a cart action that may already have changed the retailer cart. Resolve that action before deleting the plan."
        );
      }
      const cancelableJobs = openJobs.filter((job) => canTransitionJob(job.state, "cancelled"));
      if (cancelableJobs.length !== openJobs.length) {
        throw new PurchaseSafetyError(
          "purchase_intent_action_in_progress",
          409,
          "This plan has unfinished action work that cannot be cancelled safely yet. Try again after reviewing the action."
        );
      }
      for (const job of cancelableJobs) {
        this.signals.transitionJob(
          job.id,
          "cancelled",
          "purchase_plan_deleted",
          "The purchase plan was deleted before the retailer action could mutate a cart.",
          { missionId: id, retailerMutationAuthorized: false },
          now
        );
      }
      const timestamp = nowIso(now);
      this.db.run(
        `UPDATE mission_targets SET enabled = 0, updated_at = ?
         WHERE mission_id = ?`,
        timestamp,
        id
      );
      const cancelledWatchItems = this.db.run(
        `UPDATE watch_queue_items
         SET state = 'cancelled', closed_reason = 'purchase_plan_deleted',
             lease_expires_at = '', updated_at = ?
         WHERE mission_id = ? AND tenant_id = ? AND user_id = ?
           AND state IN ('queued', 'observing')`,
        timestamp,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId
      );
      const deleted = this.db.run(
        `UPDATE missions SET status = 'deleted', quick_add_profile_id = '', updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ? AND status <> 'deleted'`,
        timestamp,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId
      );
      if (Number(deleted.changes) !== 1) {
        throw new PurchaseSafetyError("purchase_intent_not_found", 404, "The purchase plan does not exist.");
      }
      this.auditEvents.record({
        correlationId: id,
        aggregateType: "mission",
        eventType: "mission_deleted",
        reasonCode: "user_deleted",
        message: "The user deleted a purchase plan; mutable targets were disabled while historical action and spend evidence was retained.",
        data: {
          missionId: id,
          variantId: mission.variantId,
          previousStatus: mission.status,
          cancelledPendingJobCount: cancelableJobs.length,
          cancelledWatchItemCount: Number(cancelledWatchItems.changes ?? 0),
          actionHistoryRetained: true,
          spendHistoryRetained: true,
          retailerMutationAuthorized: false
        }
      }, now);
      return {
        id,
        deleted: true,
        cancelledPendingJobCount: cancelableJobs.length,
        cancelledWatchItemCount: Number(cancelledWatchItems.changes ?? 0)
      };
    });
  }

  listMissions(limit = 500, offset = 0, search = "", includeAutomationTargets = false): Array<Record<string, unknown>> {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 500)));
    const safeOffset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
    const missions = this.db.all<Record<string, unknown>>(
      `SELECT m.id, m.status, m.origin, m.target_quantity AS targetQuantity,
              m.fulfilled_quantity AS fulfilledQuantity, v.id AS variantId,
              v.title, m.quick_add_profile_id AS quickAddProfileId, COUNT(mt.id) AS targetCount,
              SUM(CASE WHEN mt.enabled = 1 THEN 1 ELSE 0 END) AS enabledTargetCount,
              (SELECT ir.revision FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS intentRevision,
              (SELECT ir.max_all_in_cents FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS maxAllInCents,
              (SELECT ir.action_ceiling FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS actionCeiling,
              (SELECT ir.decision_mode FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS decisionMode,
              (SELECT ir.expires_at FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS expiresAt,
              (SELECT r2.display_name FROM mission_targets mt2
               JOIN listings l2 ON l2.id = mt2.listing_id
               JOIN retailers r2 ON r2.id = l2.retailer_id
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primaryRetailerName,
              (SELECT l2.retailer_id FROM mission_targets mt2
               JOIN listings l2 ON l2.id = mt2.listing_id
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primaryRetailerId,
              (SELECT l2.retailer_sku FROM mission_targets mt2
               JOIN listings l2 ON l2.id = mt2.listing_id
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primaryRetailerSku,
              (SELECT l2.canonical_url FROM mission_targets mt2
               JOIN listings l2 ON l2.id = mt2.listing_id
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primaryCanonicalUrl,
              (SELECT mt2.max_unit_price_cents FROM mission_targets mt2
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primaryMaxUnitPriceCents,
              (SELECT mt2.seller_policy FROM mission_targets mt2
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primarySellerPolicy,
              (SELECT mt2.fulfillment FROM mission_targets mt2
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primaryFulfillment,
              (SELECT oo.unit_price_cents FROM offer_observations oo
               WHERE oo.listing_id = (
                 SELECT mt2.listing_id FROM mission_targets mt2
                 WHERE mt2.mission_id = m.id AND mt2.enabled = 1
                 ORDER BY mt2.created_at, mt2.id LIMIT 1
               ) AND oo.unit_price_cents IS NOT NULL
               ORDER BY oo.observed_at DESC LIMIT 1) AS primaryCurrentPriceCents,
              m.created_at AS createdAt, m.updated_at AS updatedAt
       FROM missions m
       JOIN variants v ON v.id = m.variant_id
       LEFT JOIN mission_targets mt ON mt.mission_id = m.id
       WHERE m.user_id = ? AND m.status <> 'deleted'
         AND (? = '' OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR m.origin LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR m.status LIKE ? ESCAPE '\\' COLLATE NOCASE)
       GROUP BY m.id
       ORDER BY m.updated_at DESC
       LIMIT ? OFFSET ?`,
      currentRequestScope().userId,
      query,
      pattern,
      pattern,
      pattern,
      safeLimit,
      safeOffset
    );
    if (!includeAutomationTargets || !missions.length) return missions;
    const missionIds = missions.map((mission) => String(mission.id));
    const placeholders = missionIds.map(() => "?").join(", ");
    const targets: Array<Record<string, unknown>> = this.db.all<Record<string, unknown>>(
      `SELECT mt.mission_id AS missionId, mt.id AS targetId,
              mt.listing_id AS listingId, mt.enabled = 1 AS enabled,
              mt.max_unit_price_cents AS maxUnitPriceCents,
              mt.seller_policy AS sellerPolicy, mt.fulfillment,
              l.retailer_id AS retailerId, r.display_name AS retailerName,
              l.retailer_sku AS retailerSku,
              l.execution_supported = 1 AS executionSupported
       FROM mission_targets mt
       JOIN listings l ON l.id = mt.listing_id
       JOIN retailers r ON r.id = l.retailer_id
       WHERE mt.mission_id IN (${placeholders}) AND mt.enabled = 1
       ORDER BY mt.mission_id, mt.created_at, mt.id`,
      ...missionIds
    ).map((target) => ({
      ...target,
      enabled: Number(target.enabled) === 1,
      executionSupported: Number(target.executionSupported) === 1
    }));
    const targetsByMission = new Map<string, Array<Record<string, unknown>>>();
    for (const target of targets) {
      const missionId = String(target.missionId);
      const grouped = targetsByMission.get(missionId) ?? [];
      grouped.push(target);
      targetsByMission.set(missionId, grouped);
    }
    return missions.map((mission) => ({
      ...mission,
      automationTargets: targetsByMission.get(String(mission.id)) ?? []
    }));
  }

  missionCount(search = ""): number {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM missions m
       JOIN variants v ON v.id = m.variant_id
       WHERE m.user_id = ? AND m.status <> 'deleted'
         AND (? = '' OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR m.origin LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR m.status LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      currentRequestScope().userId,
      query,
      pattern,
      pattern,
      pattern
    )?.count ?? 0);
  }

  listSources(): Array<Record<string, unknown>> {
    return this.db.all<Record<string, unknown>>(
      `SELECT sc.id, sc.source, sc.name, sc.status, sc.trust_level AS trustLevel,
              sc.auto_create_missions AS autoCreateMissions,
              sc.last_event_at AS lastEventAt,
              (SELECT COUNT(*) FROM signal_events se
               WHERE se.source_connection_id = sc.id AND se.test = 0) AS signalCount,
              (SELECT COUNT(*) FROM signal_events se
               WHERE se.source_connection_id = sc.id AND se.test = 0
                 AND se.resolution_status = 'matched') AS matchedSignalCount,
              (SELECT COUNT(*) FROM signal_events se
               WHERE se.source_connection_id = sc.id AND se.test = 0
                 AND se.resolution_status = 'unresolved') AS unresolvedSignalCount,
              (SELECT COUNT(*) FROM signal_events se
               WHERE se.source_connection_id = sc.id AND se.test = 0
                 AND se.resolution_status = 'ambiguous') AS ambiguousSignalCount,
              (SELECT COUNT(*) FROM signal_events se
               JOIN mission_decisions md ON md.event_id = se.id
               WHERE se.source_connection_id = sc.id AND se.test = 0
                 AND md.outcome IN ('qualified', 'corroborated', 'sibling_store_claimed')) AS qualifiedSignalCount,
              (SELECT COUNT(*) FROM signal_events se
               JOIN mission_decisions md ON md.event_id = se.id
               WHERE se.source_connection_id = sc.id AND se.test = 0
                 AND md.outcome = 'corroborated') AS corroboratedSignalCount
       FROM source_connections sc WHERE sc.user_id = ? ORDER BY sc.name`,
      currentRequestScope().userId
    ).map((source) => {
      const signalCount = Number(source.signalCount ?? 0);
      const matchedSignalCount = Number(source.matchedSignalCount ?? 0);
      return {
        ...source,
        signalCount,
        matchedSignalCount,
        matchRatePercent: signalCount ? Math.round(matchedSignalCount * 10_000 / signalCount) / 100 : null
      };
    });
  }
}
