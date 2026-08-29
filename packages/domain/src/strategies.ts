import type {
  Action,
  ListingContext,
  MissionContext,
  NormalizedSignal,
  PricePolicy,
  PurchaseIntentPolicy,
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
    decisionSource: "strategy",
    maxSignalAgeSeconds: 120,
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
    const configuredFulfillment = mission.fulfillment === "inherit" ? strategy.fulfillment : mission.fulfillment;
    // Pickup is never inferred from an ambiguous or inherited configuration.
    // Legacy `either`/`unknown` policies retain a safe, deterministic shipping
    // default; only an exact saved pickup value can authorize pickup evidence.
    const effectiveFulfillment = configuredFulfillment === "pickup"
      ? "pickup"
      : configuredFulfillment === "manual" ? "manual" : "shipping";
    if (effectiveFulfillment !== "manual" && signal.offer.fulfillment !== effectiveFulfillment) continue;
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
        decisionSource: "strategy",
        maxSignalAgeSeconds: strategy.maxSignalAgeSeconds,
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
      decisionSource: "strategy",
      maxSignalAgeSeconds: strategy.maxSignalAgeSeconds,
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

export function evaluatePurchaseIntent(
  policy: PurchaseIntentPolicy,
  signal: NormalizedSignal,
  listing: ListingContext,
  mission: MissionContext,
  now = Date.now()
): StrategyEvaluation {
  const rejected = (reason: string, state: StrategyEvaluation["state"] = "unmatched"): StrategyEvaluation => ({
    state,
    reason,
    strategy: null,
    decisionSource: "purchase_intent",
    maxSignalAgeSeconds: policy.maxSignalAgeSeconds,
    effectiveUnitCapCents: null,
    effectiveQuantity: 1,
    effectiveAction: "notify",
    sellerPolicy: "first_party_only",
    fulfillment: "unknown"
  });
  if (policy.decisionMode !== "purchase_intent") {
    return rejected("This purchase intent delegates signal decisions to the ordered strategy layer.");
  }
  const target = policy.targets.find((candidate) => candidate.listingId === listing.id);
  if (!target || !target.enabled || !mission.targetEnabled || mission.status !== "active") {
    return rejected("The exact retailer offer is not enabled in the current purchase plan.");
  }
  if (policy.expiresAt && new Date(policy.expiresAt).getTime() <= now) {
    return rejected("The reviewed purchase plan has expired.");
  }
  const observedAt = new Date(signal.observedAt).getTime();
  if (!Number.isFinite(observedAt)
    || now - observedAt > policy.maxSignalAgeSeconds * 1_000
    || observedAt > now + 30_000) {
    return rejected("The exact offer signal is older than this purchase plan allows.", "stale");
  }
  const sellerPolicy: SellerPolicy = target.sellerPolicy === "allow_third_party"
    ? "allow_third_party"
    : "first_party_only";
  if (sellerPolicy === "first_party_only" && signal.offer.sellerType !== "first_party") {
    return rejected("The exact purchase plan requires the retailer itself to be explicitly verified as seller.");
  }
  const fulfillment = target.fulfillment === "pickup"
    ? "pickup"
    : target.fulfillment === "manual" ? "manual" : "shipping";
  if (["shipping", "pickup"].includes(fulfillment) && signal.offer.fulfillment !== fulfillment) {
    return rejected("The observed fulfillment does not match the exact purchase plan.");
  }
  const unitCap = target.maxUnitPriceCents;
  const signalPrice = signal.offer.unitPriceCents;
  if (unitCap !== null && signalPrice !== null && signalPrice > unitCap) {
    return rejected("The observed item price is above the reviewed maximum.");
  }
  const effectiveUnitCapCents = unitCap === null
    ? signalPrice
    : signalPrice === null ? unitCap : Math.min(unitCap, signalPrice);
  if (signalPrice === null || (policy.actionCeiling !== "notify" && unitCap === null)) {
    return {
      state: "needs_price",
      reason: "The exact purchase plan matched, but the source did not provide a numeric price that can be verified against the reviewed maximum.",
      strategy: null,
      decisionSource: "purchase_intent",
      maxSignalAgeSeconds: policy.maxSignalAgeSeconds,
      effectiveUnitCapCents,
      effectiveQuantity: 1,
      effectiveAction: "notify",
      sellerPolicy,
      fulfillment
    };
  }
  return {
    state: "matched",
    reason: policy.actionCeiling === "notify"
      ? "The fresh exact offer matched the reviewed notification plan."
      : "The fresh exact offer matched the reviewed cart plan; live Chrome verification is still required.",
    strategy: null,
    decisionSource: "purchase_intent",
    maxSignalAgeSeconds: policy.maxSignalAgeSeconds,
    effectiveUnitCapCents,
    effectiveQuantity: 1,
    effectiveAction: policy.actionCeiling,
    sellerPolicy,
    fulfillment
  };
}
