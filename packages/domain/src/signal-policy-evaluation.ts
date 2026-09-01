import type {
  ListingContext,
  MissionContext,
  NormalizedSignal,
  PurchaseIntentPolicy,
  StrategyDefinition,
  StrategyEvaluation
} from "../../contracts/src/index.js";
import { stableHash } from "./ids.js";
import { evaluatePurchaseIntent, evaluateStrategies } from "./strategies.js";

export const SIGNAL_POLICY_EVALUATOR_CONTRACT_VERSION = 1;

export interface SignalPolicyEvaluationSnapshot {
  evaluation: StrategyEvaluation;
  sourceActionRestricted: boolean;
}

export interface SignalPolicyEvaluationAttestation {
  contractVersion: 1;
  signalTransportHash: string;
  listingId: string;
  missionId: string;
  missionTargetId: string;
  missionEvaluationQuantity: number;
  policyRevisionId: string;
  policyRevision: number;
  policyHash: string;
  strategySetFingerprint: string;
  strategyCount: number;
  state: StrategyEvaluation["state"];
  reason: string;
  decisionSource: StrategyEvaluation["decisionSource"];
  strategyId: string;
  strategyRevision: number;
  maxSignalAgeSeconds: number;
  effectiveUnitCapCents: number | null;
  effectiveQuantity: number;
  effectiveAction: StrategyEvaluation["effectiveAction"];
  sellerPolicy: StrategyEvaluation["sellerPolicy"];
  fulfillment: StrategyEvaluation["fulfillment"];
  sourceActionRestricted: boolean;
  evaluationFingerprint: string;
}

function orderedStrategies(strategies: StrategyDefinition[]): StrategyDefinition[] {
  return [...strategies].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function signalStrategySetFingerprint(strategies: StrategyDefinition[]): string {
  const ordered = orderedStrategies(strategies);
  const parts: Array<string | number> = ["signal-strategy-set-v1", ordered.length];
  for (const strategy of ordered) {
    parts.push(
      strategy.id,
      strategy.name,
      strategy.enabled ? 1 : 0,
      strategy.position,
      strategy.revision,
      JSON.stringify(strategy)
    );
  }
  return stableHash(...parts);
}

export function evaluateSignalPolicySnapshot(
  strategies: StrategyDefinition[],
  policy: PurchaseIntentPolicy,
  signal: NormalizedSignal,
  listing: ListingContext,
  mission: MissionContext,
  sourceTrustLevel: string,
  now = Date.now()
): SignalPolicyEvaluationSnapshot {
  let evaluation = policy.decisionMode === "purchase_intent"
    ? evaluatePurchaseIntent(policy, signal, listing, mission, now, {
        allowDeferredLiveOfferVerification: sourceTrustLevel === "trusted_exact"
          && policy.actionCeiling === "add_to_cart"
      })
    : evaluateStrategies(strategies, signal, listing, mission, now);
  const sourceActionRestricted = evaluation.decisionSource === "purchase_intent"
    && evaluation.effectiveAction !== "notify"
    && sourceTrustLevel !== "trusted_exact";
  if (sourceActionRestricted) {
    evaluation = {
      ...evaluation,
      effectiveAction: "notify",
      reason: "The exact offer matched the reviewed plan, but this source is informational and cannot authorize a retailer action."
    };
  }
  return { evaluation, sourceActionRestricted };
}

export function signalPolicyEvaluationFingerprint(
  attestation: Omit<SignalPolicyEvaluationAttestation, "evaluationFingerprint">
): string {
  return stableHash(
    "signal-policy-evaluation-v1",
    attestation.contractVersion,
    attestation.signalTransportHash,
    attestation.listingId,
    attestation.missionId,
    attestation.missionTargetId,
    attestation.missionEvaluationQuantity,
    attestation.policyRevisionId,
    attestation.policyRevision,
    attestation.policyHash,
    attestation.strategySetFingerprint,
    attestation.strategyCount,
    attestation.state,
    attestation.reason,
    attestation.decisionSource,
    attestation.strategyId,
    attestation.strategyRevision,
    attestation.maxSignalAgeSeconds,
    attestation.effectiveUnitCapCents,
    attestation.effectiveQuantity,
    attestation.effectiveAction,
    attestation.sellerPolicy,
    attestation.fulfillment,
    attestation.sourceActionRestricted ? 1 : 0
  );
}

export function attestSignalPolicyEvaluation(input: {
  strategies: StrategyDefinition[];
  policy: PurchaseIntentPolicy;
  signal: NormalizedSignal;
  listing: ListingContext;
  mission: MissionContext;
  sourceTrustLevel: string;
  now?: number;
}): SignalPolicyEvaluationAttestation {
  const { evaluation, sourceActionRestricted } = evaluateSignalPolicySnapshot(
    input.strategies,
    input.policy,
    input.signal,
    input.listing,
    input.mission,
    input.sourceTrustLevel,
    input.now
  );
  const withoutFingerprint: Omit<SignalPolicyEvaluationAttestation, "evaluationFingerprint"> = {
    contractVersion: SIGNAL_POLICY_EVALUATOR_CONTRACT_VERSION,
    signalTransportHash: input.signal.transportHash,
    listingId: input.listing.id,
    missionId: input.mission.id,
    missionTargetId: input.mission.targetId,
    missionEvaluationQuantity: input.mission.targetQuantity,
    policyRevisionId: input.policy.id,
    policyRevision: input.policy.revision,
    policyHash: input.policy.policyHash,
    strategySetFingerprint: signalStrategySetFingerprint(input.strategies),
    strategyCount: input.strategies.length,
    state: evaluation.state,
    reason: evaluation.reason,
    decisionSource: evaluation.decisionSource,
    strategyId: evaluation.strategy?.id ?? "",
    strategyRevision: evaluation.strategy?.revision ?? 0,
    maxSignalAgeSeconds: evaluation.maxSignalAgeSeconds,
    effectiveUnitCapCents: evaluation.effectiveUnitCapCents,
    effectiveQuantity: evaluation.effectiveQuantity,
    effectiveAction: evaluation.effectiveAction,
    sellerPolicy: evaluation.sellerPolicy,
    fulfillment: evaluation.fulfillment,
    sourceActionRestricted
  };
  return {
    ...withoutFingerprint,
    evaluationFingerprint: signalPolicyEvaluationFingerprint(withoutFingerprint)
  };
}
