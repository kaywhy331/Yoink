import { ControlRepository } from "../../packages/database/src/control-repository.js";
import type { YoinkDatabase } from "../../packages/database/src/database.js";

/**
 * Plans created from a trusted call now start as the safe notify-only draft
 * (see SAFE_INITIAL_PURCHASE_POLICY). Tests that exercise admin strategy
 * decisions seed a legacy strategy-mode plan explicitly with this helper, the
 * same shape the engine used to create implicitly before that change.
 */
export function seedLegacyStrategyPlan(
  db: YoinkDatabase,
  listing: { retailerId: string; retailerSku: string },
  options: { targetQuantity?: number; origin?: string; now?: number } = {}
): { missionId: string; listingId: string; variantId: string } {
  const control = new ControlRepository(db);
  const now = options.now ?? Date.now();
  const row = db.get<{ id: string; variantId: string }>(
    "SELECT id, variant_id AS variantId FROM listings WHERE retailer_id = ? AND retailer_sku = ? ORDER BY id LIMIT 1",
    listing.retailerId,
    listing.retailerSku
  );
  if (!row) throw new Error(`No listing exists for ${listing.retailerId} ${listing.retailerSku}.`);
  const ensured = control.ensureMission(row.variantId, row.id, options.origin ?? "signal:trackalacker", now);
  const targets = db.all<{
    id: string;
    enabled: number;
    maxUnitPriceCents: number | null;
    sellerPolicy: "first_party_only" | "allow_third_party" | "inherit";
    fulfillment: "shipping" | "pickup" | "either" | "manual" | "unknown" | "inherit";
  }>(
    `SELECT id, enabled, max_unit_price_cents AS maxUnitPriceCents, seller_policy AS sellerPolicy, fulfillment
     FROM mission_targets WHERE mission_id = ? ORDER BY created_at, id`,
    ensured.mission.id
  );
  control.updateMission(ensured.mission.id, {
    status: "active",
    targetQuantity: options.targetQuantity ?? 5,
    targets: targets.map((target) => ({
      id: target.id,
      enabled: target.enabled === 1,
      maxUnitPriceCents: target.maxUnitPriceCents,
      sellerPolicy: target.sellerPolicy,
      fulfillment: target.fulfillment
    })),
    policy: {
      decisionMode: "strategy",
      actionCeiling: "add_to_cart",
      changeReason: "Test fixture: legacy admin-strategy plan."
    }
  }, now);
  return { missionId: ensured.mission.id, listingId: row.id, variantId: row.variantId };
}
