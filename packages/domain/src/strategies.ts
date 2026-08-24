import type {
  Action,
  ListingContext,
  MissionContext,
  NormalizedSignal,
  PricePolicy,
  SellerPolicy,
  StrategyDefinition,
  StrategyEvaluation
} from "../../contracts/src/index.js";
import { keywordRulesMatch } from "./keywords.js";
import { normalizedKey } from "./normalize.js";

const ACTION_RANK: Record<Action, number> = {
  notify: 0,
  add_to_cart: 1,
  prepare_checkout: 2,
  submit_order: 3
};

export function pricePolicyCap(policy: PricePolicy, msrpCents: number | null): number | null {
  if (policy.kind === "any") return null;
  if (policy.kind === "absolute_max" || policy.kind === "above_msrp") {
    const cap = Number(policy.maxPriceCents);
    return Number.isSafeInteger(cap) && cap > 0 ? cap : null;
  }
  if (!Number.isSafeInteger(msrpCents) || Number(msrpCents) <= 0) return null;
  if (policy.kind === "below_msrp") return Math.max(1, Number(msrpCents) - 1);
  if (policy.kind === "at_or_below_msrp") return Number(msrpCents);
  const toleranceBps = Number.isInteger(policy.toleranceBps)
    ? Math.max(0, Math.min(10_000, Number(policy.toleranceBps)))
    : 1_000;
  return Math.floor(Number(msrpCents) * (10_000 + toleranceBps) / 10_000);
}

function sourceAndStoreMatch(strategy: StrategyDefinition, signal: NormalizedSignal, listing: ListingContext): boolean {
  const sources = strategy.sources.map((value) => normalizedKey(value, 60));
  const retailers = strategy.retailers.map((value) => normalizedKey(value, 60));
  return (!sources.length || sources.includes(signal.source))
    && (!retailers.length || retailers.includes(listing.retailerId));
}

function sellerMatches(strategy: StrategyDefinition, signal: NormalizedSignal, policy: SellerPolicy): boolean {
  if (policy === "first_party_only" && signal.offer.sellerType === "third_party") return false;
  if (!strategy.allowedSellers.length) return true;
  if (!signal.offer.sellerName) return false;
  const seller = normalizedKey(signal.offer.sellerName, 160);
  return strategy.allowedSellers.some((candidate) => normalizedKey(candidate, 160) === seller);
}

function actionCappedByMission(action: Action, mission: MissionContext): Action {
  if (!mission.targetEnabled || mission.status !== "active") return "notify";
  return action;
}

function unmatched(reason: string): StrategyEvaluation {
  return {
    state: "unmatched",
    reason,
    strategy: null,
    effectiveUnitCapCents: null,
    effectiveQuantity: 1,
    effectiveAction: "notify",
    sellerPolicy: "first_party_only",
    fulfillment: "unknown"
  };
}

export function evaluateStrategies(
  strategies: StrategyDefinition[],
  signal: NormalizedSignal,
  listing: ListingContext,
  mission: MissionContext,
  now = Date.now()
): StrategyEvaluation {
  const keywordText = [listing.title, signal.identity.title, signal.evidence.headline, signal.evidence.body]
    .filter(Boolean)
    .join("\n");
  const ordered = [...strategies].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  let sawStaleCandidate = false;
  let sawQuantityLimit = false;

  for (const strategy of ordered) {
    if (!strategy.enabled || !sourceAndStoreMatch(strategy, signal, listing)) continue;
    if (!keywordRulesMatch(strategy.includeKeywords, strategy.excludeKeywords, keywordText)) continue;
    const effectiveSellerPolicy: SellerPolicy = mission.sellerPolicy === "first_party_only"
      || strategy.sellerPolicy === "first_party_only"
      ? "first_party_only"
      : "allow_third_party";
    if (!sellerMatches(strategy, signal, effectiveSellerPolicy)) continue;
    const effectiveFulfillment = mission.fulfillment === "inherit" ? strategy.fulfillment : mission.fulfillment;
    if (
      !["either", "manual", "unknown"].includes(effectiveFulfillment)
      && signal.offer.fulfillment !== "unknown"
      && signal.offer.fulfillment !== "either"
      && signal.offer.fulfillment !== effectiveFulfillment
    ) continue;
    const observedAt = new Date(signal.observedAt).getTime();
    if (!Number.isFinite(observedAt) || now - observedAt > strategy.maxSignalAgeSeconds * 1_000 || observedAt > now + 30_000) {
      sawStaleCandidate = true;
      continue;
    }

    const strategyCap = pricePolicyCap(strategy.pricePolicy, listing.msrpCents);
    const signalPrice = signal.offer.unitPriceCents;
    if (strategy.pricePolicy.kind !== "any" && strategyCap === null) continue;
    if (strategyCap !== null && signalPrice !== null && signalPrice > strategyCap) continue;

    const requestedQuantity = strategy.quantity === "max"
      ? Math.max(1, mission.targetQuantity)
      : Math.max(1, Math.min(strategy.quantity, mission.targetQuantity));
    if (strategy.quantity !== "max" && signal.offer.orderLimit !== null && signal.offer.orderLimit < requestedQuantity) {
      sawQuantityLimit = true;
      continue;
    }
    const effectiveQuantity = strategy.quantity === "max" && signal.offer.orderLimit !== null
      ? Math.max(1, Math.min(requestedQuantity, signal.offer.orderLimit))
      : requestedQuantity;
    const effectiveAction = actionCappedByMission(strategy.action, mission);
    const purchaseRequested = ACTION_RANK[effectiveAction] > ACTION_RANK.notify;
    const trustedCaps = [strategyCap, mission.maxUnitPriceCents]
      .filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0);
    if (purchaseRequested && (!trustedCaps.length || signalPrice === null)) {
      return {
        state: "needs_price",
        reason: "The winning strategy requires a trusted numeric cap and a readable signal price.",
        strategy,
        effectiveUnitCapCents: trustedCaps.length ? Math.min(...trustedCaps) : null,
        effectiveQuantity,
        effectiveAction: "notify",
        sellerPolicy: effectiveSellerPolicy,
        fulfillment: effectiveFulfillment
      };
    }
    const effectiveUnitCapCents = trustedCaps.length
      ? Math.min(...trustedCaps, ...(signalPrice === null ? [] : [signalPrice]))
      : null;
    return {
      state: "matched",
      reason: effectiveAction === "notify"
        ? `Signal strategy “${strategy.name}” matched for notification.`
        : `Signal strategy “${strategy.name}” matched with live verification required.`,
      strategy,
      effectiveUnitCapCents,
      effectiveQuantity,
      effectiveAction,
      sellerPolicy: effectiveSellerPolicy,
      fulfillment: effectiveFulfillment
    };
  }

  if (sawQuantityLimit) {
    return { ...unmatched("The signal order limit is below the requested exact quantity."), state: "quantity_limited" };
  }
  if (sawStaleCandidate) return { ...unmatched("The signal is older than the matching strategy allows."), state: "stale" };
  return unmatched("No enabled signal strategy matched the source, retailer, price, seller, and keyword criteria.");
}
