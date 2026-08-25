import {
  ACTIONS,
  PRICE_POLICY_KINDS,
  type Fulfillment,
  type AppSettingsUpdateInput,
  type MissionContext,
  type PurchaseIntentCreateInput,
  type PurchaseIntentPolicy,
  type PurchaseIntentPolicyUpdateInput,
  type MissionUpdateInput,
  type SellerPolicy,
  type StrategyDefinition
} from "../../contracts/src/index.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { AuditRepository } from "./audit-repository.js";
import { PurchasePolicyRepository, PurchaseSafetyError } from "./purchase-policy-repository.js";
import { SignalRepository } from "./signal-repository.js";

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
  status: "active" | "paused" | "satisfied" | "archived";
  target_quantity: number;
  target_id: string;
  target_enabled: number;
  max_unit_price_cents: number | null;
  seller_policy: SellerPolicy | "inherit";
  fulfillment: Fulfillment | "inherit";
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
const MISSION_STATUSES = new Set(["active", "paused", "satisfied", "archived"]);
const MISSION_TARGET_POLICIES = new Set(["inherit", "first_party_only", "allow_third_party"]);
const MISSION_TARGET_FULFILLMENTS = new Set(["inherit", "shipping", "pickup", "either", "manual", "unknown"]);
const SETTING_RETAILERS = new Set(["target", "walmart", "amazon", "bestbuy"]);

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

  constructor(private readonly db: YoinkDatabase) {
    this.auditEvents = new AuditRepository(db);
    this.purchasePolicies = new PurchasePolicyRepository(db);
    this.signals = new SignalRepository(db);
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

  createConfiguredMission(input: PurchaseIntentCreateInput, now = Date.now()): MissionEnsureResult {
    if (input?.contractVersion !== 1) {
      throw new PurchaseSafetyError("purchase_intent_contract_unsupported", 400, "A supported purchase-plan contract version is required.");
    }
    const listingId = cleanText(input?.listingId, 120);
    const listing = this.db.get<{ variantId: string; retailerId: string; executionSupported: number }>(
      `SELECT variant_id AS variantId, retailer_id AS retailerId,
              execution_supported AS executionSupported
       FROM listings WHERE id = ?`,
      listingId
    );
    if (!listing) throw new PurchaseSafetyError("purchase_listing_not_found", 404, "The exact retailer listing no longer exists.");
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
    const boundedItemTotal = maxUnitPriceCents * targetQuantity;
    if (!Number.isSafeInteger(boundedItemTotal) || boundedItemTotal > maxAllInCents) {
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
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "Choose shipping, pickup, either, or manual fulfillment.");
    }
    if (input.actionCeiling === "add_to_cart" && input.fulfillment !== "shipping") {
      throw new PurchaseSafetyError("purchase_intent_invalid", 400, "Automatic cart actions currently require an explicitly selected shipping offer.");
    }
    if (input.actionCeiling === "add_to_cart" && Number(listing.executionSupported) !== 1) {
      throw new PurchaseSafetyError("purchase_intent_execution_unavailable", 409, "This store is monitor-only until its add-to-cart mapping is separately qualified.");
    }
    if (input.actionCeiling === "add_to_cart") {
      const settings = this.settings();
      const storeReserveCents = Math.max(0, Number(settings.storeAllowancesCents[listing.retailerId] ?? 0));
      const requiredAllInCents = Math.ceil(
        boundedItemTotal * (10_000 + settings.taxBps) / 10_000
      ) + storeReserveCents;
      if (!Number.isSafeInteger(requiredAllInCents) || maxAllInCents < requiredAllInCents) {
        throw new PurchaseSafetyError(
          "purchase_intent_all_in_bound_too_low",
          400,
          `Automatic cart actions need a maximum total of at least $${(requiredAllInCents / 100).toFixed(2)} under the current tax and store-fee safety reserve. Choose notifications only or raise the reviewed total.`
        );
      }
    }
    if (input?.confirmation !== "CREATE_EXACT_PURCHASE_PLAN") {
      throw new PurchaseSafetyError("purchase_intent_confirmation_required", 400, "Review and confirm the exact purchase plan before creating it.");
    }

    return this.db.transaction(() => {
      const result = this.ensureMissionInternal(listing.variantId, listingId, "user_guided", now, {
        targetQuantity,
        selectedOnly: true,
        selectedMaxUnitPriceCents: maxUnitPriceCents,
        selectedSellerPolicy: "first_party_only",
        selectedFulfillment: input.fulfillment,
        initialPolicy: {
          maxAllInCents,
          actionCeiling: input.actionCeiling,
          decisionMode: "purchase_intent",
          maxSignalAgeSeconds: 120,
          substitutionPolicy: "exact_only",
          expiresAt: input.expiresAt ?? "",
          cooldownSeconds,
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
      let mission = this.db.get<{ id: string }>(
        "SELECT id FROM missions WHERE tenant_id = ? AND user_id = ? AND variant_id = ?",
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        variantId
      );
      const created = !mission;
      if (!mission) {
        mission = { id: newId("mission") };
        this.db.run(
          `INSERT INTO missions(
             id, tenant_id, user_id, variant_id, status, origin,
             target_quantity, fulfilled_quantity, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)`,
          mission.id,
          currentRequestScope().tenantId,
          currentRequestScope().userId,
          variantId,
          cleanText(origin, 60),
          creation?.targetQuantity ?? 1,
          timestamp,
          timestamp
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
        this.db.run(
          `INSERT OR IGNORE INTO mission_targets(
             id, mission_id, listing_id, enabled, max_unit_price_cents,
             currency, seller_policy, fulfillment, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          eventType: "mission_created",
          reasonCode: cleanText(origin, 60) || "created",
          message: "A mission was created for an exact product variant and all known retailer targets were attached.",
          data: {
            variantId,
            initialListingId: listingId,
            targetCount: variantListings.length,
            enabledTargetCount: creation?.selectedOnly ? 1 : variantListings.length,
            creationMode: creation ? "explicit_user_configuration" : "strategy_or_internal"
          }
        }, now);
      }
      this.purchasePolicies.ensureCurrent(mission.id, now, creation?.initialPolicy);
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
       WHERE m.id = ? AND m.user_id = ?`,
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

  updateMission(missionId: string, input: MissionUpdateInput, now = Date.now()): Record<string, unknown> {
    const id = cleanText(missionId, 120);
    const status = String(input?.status || "");
    const targetQuantity = Number(input?.targetQuantity);
    if (!MISSION_STATUSES.has(status)) throw new Error("A supported mission status is required.");
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
        sellerPolicy: target.sellerPolicy,
        fulfillment: target.fulfillment
      };
    });
    const targetIds = new Set(normalizedTargets.map((target) => target.id));
    if (targetIds.size !== normalizedTargets.length) throw new Error("Mission target IDs must be unique.");

    return this.db.transaction(() => {
      const existing = this.db.get<{ id: string }>("SELECT id FROM missions WHERE id = ? AND user_id = ?", id, currentRequestScope().userId);
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

  listMissions(limit = 500, offset = 0, search = ""): Array<Record<string, unknown>> {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 500)));
    const safeOffset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
    return this.db.all(
      `SELECT m.id, m.status, m.origin, m.target_quantity AS targetQuantity,
              m.fulfilled_quantity AS fulfilledQuantity, v.id AS variantId,
              v.title, COUNT(mt.id) AS targetCount,
              SUM(CASE WHEN mt.enabled = 1 THEN 1 ELSE 0 END) AS enabledTargetCount,
              (SELECT ir.revision FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS intentRevision,
              (SELECT ir.max_all_in_cents FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS maxAllInCents,
              (SELECT ir.action_ceiling FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS actionCeiling,
              (SELECT ir.decision_mode FROM mission_intent_revisions ir
               WHERE ir.mission_id = m.id ORDER BY ir.revision DESC LIMIT 1) AS decisionMode,
              (SELECT r2.display_name FROM mission_targets mt2
               JOIN listings l2 ON l2.id = mt2.listing_id
               JOIN retailers r2 ON r2.id = l2.retailer_id
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primaryRetailerName,
              (SELECT l2.retailer_sku FROM mission_targets mt2
               JOIN listings l2 ON l2.id = mt2.listing_id
               WHERE mt2.mission_id = m.id AND mt2.enabled = 1
               ORDER BY mt2.created_at, mt2.id LIMIT 1) AS primaryRetailerSku,
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
       WHERE m.user_id = ? AND (? = '' OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
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
  }

  missionCount(search = ""): number {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM missions m
       JOIN variants v ON v.id = m.variant_id
       WHERE m.user_id = ? AND (? = '' OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
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
