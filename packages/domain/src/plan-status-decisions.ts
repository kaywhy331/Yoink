/**
 * Decisions recorded when a call reaches a plan that is paused or deleted.
 *
 * The SQLite engine (packages/engine/src/signal-engine.ts) and the PostgreSQL
 * post-incident decision twin
 * (packages/database/src/postgres-signal-post-incident-decision-apply.ts) both
 * record these outcomes with these exact reasons, so the cutover proof stays
 * byte-identical.
 */
export const PLAN_PAUSED_DECISION_OUTCOME = "plan_paused";
export const PLAN_DELETED_DECISION_OUTCOME = "plan_deleted";

export const PLAN_PAUSED_DECISION_REASON =
  "This plan is paused, so no call was sent and no cart add was tried. Resume the plan to receive calls again.";
export const PLAN_DELETED_DECISION_REASON =
  "This plan was deleted, so no call was sent. Restore the plan or quick add the product to watch it again.";

export type PlanStatusDecisionOutcome =
  | typeof PLAN_PAUSED_DECISION_OUTCOME
  | typeof PLAN_DELETED_DECISION_OUTCOME;
