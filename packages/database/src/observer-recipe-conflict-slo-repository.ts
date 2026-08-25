import { nowIso } from "../../domain/src/ids.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export const OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION = "observer_recipe_conflict_slo_v1";
export const OBSERVER_RECIPE_CONFLICT_SLO_WINDOW_DAYS = 7;
export const OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_TRIALS = 10;
export const OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_ACCOUNTS = 3;
export const OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_REGIONS = 2;
export const OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICTS = 2;
export const OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICT_ACCOUNTS = 2;
export const OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICT_REGIONS = 2;
export const OBSERVER_RECIPE_CONFLICT_SLO_MAXIMUM_CONFLICT_BASIS_POINTS = 1_000;

const DAY_MS = 24 * 60 * 60_000;

export interface ObserverRecipeConflictSloMeasurement {
  policyVersion: string;
  windowDays: number;
  cutoffAt: string;
  eligibleTrials: number;
  conflictTrials: number;
  distinctEligibleAccounts: number;
  distinctEligibleRegions: number;
  distinctConflictAccounts: number;
  distinctConflictRegions: number;
  conflictRateBasisPoints: number;
  evidenceReady: boolean;
  breached: boolean;
  state: "insufficient_evidence" | "healthy" | "breached";
}

interface MeasurementRow {
  eligibleTrials: number;
  conflictTrials: number;
  distinctEligibleAccounts: number;
  distinctEligibleRegions: number;
  distinctConflictAccounts: number;
  distinctConflictRegions: number;
}

export class ObserverRecipeConflictSloRepository {
  constructor(private readonly db: YoinkDatabase) {}

  measure(recipeId: string, now = Date.now()): ObserverRecipeConflictSloMeasurement {
    const cutoffAt = nowIso(now - OBSERVER_RECIPE_CONFLICT_SLO_WINDOW_DAYS * DAY_MS);
    const row = this.db.get<MeasurementRow>(
      `WITH ranked AS (
         SELECT trial.*,
                ROW_NUMBER() OVER (
                  PARTITION BY contributor_ref_hash, retailer_sku,
                               layout_fingerprint, recipe_state_at_trial
                  ORDER BY observed_at DESC, received_at DESC, id DESC
                ) AS contributor_rank
         FROM observer_recipe_trials trial
         WHERE tenant_id = ? AND recipe_id = ?
           AND received_at >= ?
           AND validation_profile = 'packaged_structured_oracle_v1'
           AND eligibility_state = 'externally_attested'
           AND contributor_ref_hash <> '' AND region_scope <> ''
       ), cohort AS (
         SELECT * FROM ranked WHERE contributor_rank = 1
       )
       SELECT
         COUNT(*) AS eligibleTrials,
         COALESCE(SUM(CASE WHEN oracle_conflict_field_count > 0
                            OR packaged_conflict_field_count > 0 THEN 1 ELSE 0 END), 0) AS conflictTrials,
         COUNT(DISTINCT contributor_ref_hash) AS distinctEligibleAccounts,
         COUNT(DISTINCT region_scope) AS distinctEligibleRegions,
         COUNT(DISTINCT CASE WHEN oracle_conflict_field_count > 0
                               OR packaged_conflict_field_count > 0
                             THEN contributor_ref_hash END) AS distinctConflictAccounts,
         COUNT(DISTINCT CASE WHEN oracle_conflict_field_count > 0
                               OR packaged_conflict_field_count > 0
                             THEN region_scope END) AS distinctConflictRegions
       FROM cohort`,
      currentRequestScope().tenantId,
      recipeId,
      cutoffAt
    );
    const eligibleTrials = Number(row?.eligibleTrials ?? 0);
    const conflictTrials = Number(row?.conflictTrials ?? 0);
    const distinctEligibleAccounts = Number(row?.distinctEligibleAccounts ?? 0);
    const distinctEligibleRegions = Number(row?.distinctEligibleRegions ?? 0);
    const distinctConflictAccounts = Number(row?.distinctConflictAccounts ?? 0);
    const distinctConflictRegions = Number(row?.distinctConflictRegions ?? 0);
    const conflictRateBasisPoints = eligibleTrials > 0
      ? Math.floor(conflictTrials * 10_000 / eligibleTrials)
      : 0;
    const evidenceReady = eligibleTrials >= OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_TRIALS
      && distinctEligibleAccounts >= OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_ACCOUNTS
      && distinctEligibleRegions >= OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_REGIONS;
    const breached = evidenceReady
      && conflictTrials >= OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICTS
      && distinctConflictAccounts >= OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICT_ACCOUNTS
      && distinctConflictRegions >= OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICT_REGIONS
      && conflictRateBasisPoints > OBSERVER_RECIPE_CONFLICT_SLO_MAXIMUM_CONFLICT_BASIS_POINTS;
    return {
      policyVersion: OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION,
      windowDays: OBSERVER_RECIPE_CONFLICT_SLO_WINDOW_DAYS,
      cutoffAt,
      eligibleTrials,
      conflictTrials,
      distinctEligibleAccounts,
      distinctEligibleRegions,
      distinctConflictAccounts,
      distinctConflictRegions,
      conflictRateBasisPoints,
      evidenceReady,
      breached,
      state: breached ? "breached" : evidenceReady ? "healthy" : "insufficient_evidence"
    };
  }

  status(limit = 100, now = Date.now()): Record<string, unknown> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const recipes = this.db.all<{ id: string; retailerId: string; recipeVersion: string; lifecycleState: string }>(
      `SELECT id, retailer_id AS retailerId, recipe_version AS recipeVersion,
              lifecycle_state AS lifecycleState
       FROM observer_recipe_candidates
       WHERE tenant_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
      currentRequestScope().tenantId,
      safeLimit
    ).map((recipe) => ({ ...recipe, measurement: this.measure(recipe.id, now) }));
    return {
      policyVersion: OBSERVER_RECIPE_CONFLICT_SLO_POLICY_VERSION,
      windowDays: OBSERVER_RECIPE_CONFLICT_SLO_WINDOW_DAYS,
      minimumEligibleTrials: OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_TRIALS,
      minimumIndependentAccounts: OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_ACCOUNTS,
      minimumRegions: OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_REGIONS,
      minimumConflictTrials: OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICTS,
      minimumConflictAccounts: OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICT_ACCOUNTS,
      minimumConflictRegions: OBSERVER_RECIPE_CONFLICT_SLO_MINIMUM_CONFLICT_REGIONS,
      maximumConflictBasisPoints: OBSERVER_RECIPE_CONFLICT_SLO_MAXIMUM_CONFLICT_BASIS_POINTS,
      measuredRecipeCount: recipes.length,
      evidenceReadyRecipeCount: recipes.filter((recipe) => recipe.measurement.evidenceReady).length,
      breachedRecipeCount: recipes.filter((recipe) => recipe.measurement.breached).length,
      recipes,
      enforcement: "disable_read_only_distribution_only",
      recoveredValuesRecorded: false,
      applicationAffected: false,
      qualificationAffected: false,
      mutationCapable: false
    };
  }
}
