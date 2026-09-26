import type { PurchaseIntentPolicyUpdateInput } from "../../contracts/src/index.js";

/**
 * The safe draft every new plan starts from unless a shopper reviewed explicit
 * limits: notify only, decided by the plan itself (never by admin strategies),
 * and no price cap until the shopper sets one.
 *
 * Shared by the SQLite repository (control-repository.ts) and the PostgreSQL
 * mission-binding twin (postgres-signal-mission-binding-apply.ts) so both sides
 * seed byte-identical initial revisions.
 */
export const SAFE_INITIAL_PURCHASE_POLICY = Object.freeze({
  actionCeiling: "notify",
  decisionMode: "purchase_intent",
  maxSignalAgeSeconds: 120,
  substitutionPolicy: "exact_only",
  cooldownSeconds: 0,
  changeReason: "Safe user draft created; explicit limits are still required before automated cart actions."
} as const) satisfies Readonly<PurchaseIntentPolicyUpdateInput>;
