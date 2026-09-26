import { AdapterDiagnosticRepository } from "../../database/src/adapter-diagnostic-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import {
  isGeneratedObserverRepairSelector,
  ObserverRepairCandidateRepository
} from "../../database/src/observer-repair-candidate-repository.js";
import type { ObserverRecipeField, ObserverRecipeFieldInput } from "../../contracts/src/index.js";
import type { BackgroundTaskResult } from "../../domain/src/background-task.js";

export const OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS = 2_000;
export const OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES = 25;
const GENERATED_CANDIDATE_LIFETIME_MS = 30 * 24 * 60 * 60_000;

export class ObserverRecipeCandidateEvaluationService {
  private readonly diagnostics: AdapterDiagnosticRepository;
  private readonly candidates: ObserverRepairCandidateRepository;

  constructor(db: YoinkDatabase) {
    this.diagnostics = new AdapterDiagnosticRepository(db);
    this.candidates = new ObserverRepairCandidateRepository(db);
  }

  execute(runtimeVersion: string, now = Date.now()): BackgroundTaskResult {
    // The queue's maturity window is judged at the task's own time, not the
    // wall clock, so a pinned worker cycle sees the same evidence it records.
    const groups = this.diagnostics.listRepairQueue(
      OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_DIAGNOSTICS,
      now
    );
    let unsupportedMatureSelectors = 0;
    const mature = groups.flatMap((group) => {
      if (group.status !== "open" || group.operation !== "observe") return [];
      const ready = group.repairSuggestions
        .filter((suggestion) => suggestion.reviewState === "maintainer_ready" && suggestion.executable === false);
      const suggestions = ready
        .filter((suggestion) => isGeneratedObserverRepairSelector(suggestion.field, suggestion.selector))
        .sort((left, right) => left.field.localeCompare(right.field) || left.selector.localeCompare(right.selector));
      unsupportedMatureSelectors += ready.length - suggestions.length;
      return suggestions.length ? [{ group, suggestions }] : [];
    });
    let candidatesCreated = 0;
    let candidatesReused = 0;
    let expiredCandidates = 0;
    let reviewedCandidates = 0;
    let selectorsEvaluated = 0;
    let candidateFieldsEvaluated = 0;
    for (const { group, suggestions } of mature.slice(
      0,
      OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES
    )) {
      const fields: Partial<Record<ObserverRecipeField, ObserverRecipeFieldInput>> = {};
      for (const suggestion of suggestions) {
        const current = fields[suggestion.field];
        fields[suggestion.field] = {
          mode: suggestion.mode,
          selectors: [...new Set([...(current?.selectors ?? []), suggestion.selector])]
            .sort((left, right) => left.localeCompare(right))
        };
      }
      selectorsEvaluated += suggestions.length;
      candidateFieldsEvaluated += Object.keys(fields).length;
      const ensured = this.candidates.ensure({
        retailerId: group.retailerId,
        layoutFingerprint: group.layoutFingerprint,
        fields,
        minimumExtensionVersion: runtimeVersion,
        occurrenceCount: suggestions.reduce((sum, suggestion) => sum + suggestion.occurrenceCount, 0),
        minimumDistinctDeviceCount: Math.min(...suggestions.map((suggestion) => suggestion.distinctDeviceCount)),
        minimumDistinctSkuCount: Math.min(...suggestions.map((suggestion) => suggestion.distinctSkuCount))
      }, now);
      if (ensured.created) candidatesCreated += 1;
      else candidatesReused += 1;
      if (new Date(ensured.expiresAt).getTime() <= now) expiredCandidates += 1;
      if (ensured.lifecycleState !== "quarantined") reviewedCandidates += 1;
    }
    return {
      repairGroupsEvaluated: groups.length,
      matureRepairGroups: mature.length,
      unsupportedMatureSelectors,
      selectorsEvaluated,
      candidateFieldsEvaluated,
      supportedRepairFields: 5,
      candidatesCreated,
      candidatesReused,
      candidatesDeferred: Math.max(
        0,
        mature.length - OBSERVER_REPAIR_CANDIDATE_EVALUATION_MAXIMUM_CANDIDATES
      ),
      expiredCandidates,
      reviewedCandidates,
      generatedCandidateLifetimeDays: GENERATED_CANDIDATE_LIFETIME_MS / (24 * 60 * 60_000),
      mutationAuthority: false,
      generatedCandidatesExecutable: false
    };
  }
}
