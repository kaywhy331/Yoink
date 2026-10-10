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
import { GUARDED_CART_MAX_QUANTITY, MSRP_GUARDED_RETAILERS } from "../../contracts/src/official-msrp.js";
import { keywordRulesMatch } from "./keywords.js";
import { MAX_SIGNAL_FUTURE_SKEW_MS, normalizedKey } from "./normalize.js";

/**
 * Notification freshness bound. A cart add needs a signal inside the plan's
 * own `maxSignalAgeSeconds` (120 s by default), but a call is still worth
 * sending for a restock that arrived late (Chrome asleep, queued ingress
 * retry). When the effective action is `notify` the stale check uses
 * `max(maxSignalAgeSeconds, NOTIFY_SIGNAL_MAX_AGE_SECONDS)`; the cart window is
 * never lengthened. The PostgreSQL strategy-evaluation twin mirrors this.
 */
export const NOTIFY_SIGNAL_MAX_AGE_SECONDS = 1_800;
/** How far ahead of this host a source clock may be for a cart add. */
export const CART_SIGNAL_FUTURE_SKEW_MS = 30_000;
/** Shared prefix of the reason recorded when a cart match is downgraded to a call because the signal is too old for a cart add. */
export const STALE_FOR_CART_REASON_PREFIX = "The signal is too old for a cart add";
export const STALE_FOR_CART_INTENT_REASON =
  `${STALE_FOR_CART_REASON_PREFIX}, so the reviewed plan sent a notification instead.`;
export const CURRENCY_MISMATCH_REASON =
  "The signal price is in a different currency from the listing, so it cannot be checked against the reviewed maximum.";

/**
 * Rejection reasons a reviewed plan records when a call does not match it.
 * The shopper call log (call-result.ts) reads them back to explain why a call
 * did nothing, and the PostgreSQL strategy-evaluation twin writes the same
 * text, so keep the wording byte-identical.
 */
export const INTENT_TARGET_DISABLED_REASON = "The exact retailer offer is not enabled in the current purchase plan.";
export const INTENT_EXPIRED_REASON = "The reviewed purchase plan has expired.";
export const INTENT_STALE_REASON = "The exact offer signal is older than this purchase plan allows.";
export const INTENT_SELLER_REASON = "The exact purchase plan requires the retailer itself to be explicitly verified as seller.";
export const INTENT_FULFILLMENT_REASON = "The observed fulfillment does not match the exact purchase plan.";
export const INTENT_PRICE_ABOVE_MAX_REASON = "The observed item price is above the reviewed maximum.";
export const STRATEGY_NO_MATCH_REASON = "No enabled signal strategy matched the source, retailer, price, seller, and keyword criteria.";

export type SignalFreshness = "cart" | "notify" | "stale";

/**
 * Freshness of one signal against a configured cart bound:
 * - `stale`: unparseable, more than MAX_SIGNAL_FUTURE_SKEW_MS in the future, or
 *   older than max(maxSignalAgeSeconds, NOTIFY_SIGNAL_MAX_AGE_SECONDS);
 * - `notify`: fresh enough for a call but not for a cart add (older than
 *   maxSignalAgeSeconds, or more than CART_SIGNAL_FUTURE_SKEW_MS ahead);
 * - `cart`: inside the cart window.
 */
export function signalFreshness(observedAtIso: string, maxSignalAgeSeconds: number, now = Date.now()): SignalFreshness {
  const observedAt = new Date(observedAtIso).getTime();
  if (!Number.isFinite(observedAt) || observedAt > now + MAX_SIGNAL_FUTURE_SKEW_MS) return "stale";
  const ageMs = now - observedAt;
  if (ageMs > Math.max(maxSignalAgeSeconds, NOTIFY_SIGNAL_MAX_AGE_SECONDS) * 1_000) return "stale";
  if (ageMs > maxSignalAgeSeconds * 1_000 || observedAt > now + CART_SIGNAL_FUTURE_SKEW_MS) return "notify";
  return "cart";
}

/** A signal price is only comparable with a cap in the listing's own currency. */
function comparableSignalPrice(signal: NormalizedSignal, listing: ListingContext): number | null {
  if (listing.currency && signal.offer.currency !== listing.currency) return null;
  return signal.offer.unitPriceCents;
}

function currencyMismatch(signal: NormalizedSignal, listing: ListingContext): boolean {
  return Boolean(listing.currency) && signal.offer.currency !== listing.currency;
}

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
    const freshness = signalFreshness(signal.observedAt, strategy.maxSignalAgeSeconds, now);
    if (freshness === "stale") {
      sawStaleCandidate = true;
      continue;
    }

    const strategyCap = pricePolicyCap(strategy.pricePolicy, listing.msrpCents);
    const signalPrice = comparableSignalPrice(signal, listing);
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
    const cappedAction = actionCappedByMission(strategy.action, mission);
    // Too old (or too far ahead) for a cart add, but fresh enough for a call:
    // downgrade to notify instead of dropping the restock.
    const staleForCart = freshness === "notify" && cappedAction !== "notify";
    const effectiveAction: Action = staleForCart ? "notify" : cappedAction;
    const purchaseRequested = ACTION_RANK[effectiveAction] > ACTION_RANK.notify;
    const trustedCaps = [strategyCap, mission.maxUnitPriceCents]
      .filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0);
    if (purchaseRequested && (!trustedCaps.length || signalPrice === null)) {
      return {
        state: "needs_price",
        reason: currencyMismatch(signal, listing)
          ? CURRENCY_MISMATCH_REASON
          : "The winning strategy requires a trusted numeric cap and a readable signal price.",
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
      reason: staleForCart
        ? `${STALE_FOR_CART_REASON_PREFIX} under signal strategy “${strategy.name}”, so it matched for notification.`
        : effectiveAction === "notify"
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
  return unmatched(STRATEGY_NO_MATCH_REASON);
}

export function evaluatePurchaseIntent(
  policy: PurchaseIntentPolicy,
  signal: NormalizedSignal,
  listing: ListingContext,
  mission: MissionContext,
  now = Date.now(),
  options: { allowDeferredLiveOfferVerification?: boolean; allowUnconfirmedOfferForAlerts?: boolean } = {}
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
    return rejected(INTENT_TARGET_DISABLED_REASON);
  }
  if (policy.expiresAt && new Date(policy.expiresAt).getTime() <= now) {
    return rejected(INTENT_EXPIRED_REASON);
  }
  const freshness = signalFreshness(signal.observedAt, policy.maxSignalAgeSeconds, now);
  if (freshness === "stale") {
    return rejected(INTENT_STALE_REASON, "stale");
  }
  if (freshness === "notify" && policy.actionCeiling !== "notify") {
    // Too old for the cart window but inside the notification bound: evaluate
    // the same reviewed plan as notify-only rather than dropping the call.
    const downgraded = evaluatePurchaseIntent({ ...policy, actionCeiling: "notify" }, signal, listing, mission, now, options);
    return downgraded.state === "matched" ? { ...downgraded, reason: STALE_FOR_CART_INTENT_REASON } : downgraded;
  }
  const sellerPolicy: SellerPolicy = target.sellerPolicy === "allow_third_party"
    ? "allow_third_party"
    : "first_party_only";
  // An alert needs no Chrome check, so an alerts-only plan accepts a trusted
  // exact call that doesn't say who sells it or how it ships (TrackaLacker
  // pushes never do). A known marketplace seller or a known mismatched
  // delivery option is still turned down below.
  const unconfirmedAlertAllowed = options.allowUnconfirmedOfferForAlerts === true && policy.actionCeiling === "notify";
  const sellerVerificationDeferred = (options.allowDeferredLiveOfferVerification === true || unconfirmedAlertAllowed)
    && sellerPolicy === "first_party_only"
    && signal.offer.sellerType === "unknown";
  if (sellerPolicy === "first_party_only"
    && signal.offer.sellerType !== "first_party"
    && !sellerVerificationDeferred) {
    return rejected(INTENT_SELLER_REASON);
  }
  const fulfillment = target.fulfillment === "pickup"
    ? "pickup"
    : target.fulfillment === "manual" ? "manual" : "shipping";
  const fulfillmentVerificationDeferred = (options.allowDeferredLiveOfferVerification === true || unconfirmedAlertAllowed)
    && ["shipping", "pickup"].includes(fulfillment)
    && signal.offer.fulfillment === "unknown";
  if (["shipping", "pickup"].includes(fulfillment)
    && signal.offer.fulfillment !== fulfillment
    && !fulfillmentVerificationDeferred) {
    return rejected(INTENT_FULFILLMENT_REASON);
  }
  const unitCap = target.maxUnitPriceCents;
  const signalPrice = comparableSignalPrice(signal, listing);
  const foreignCurrency = currencyMismatch(signal, listing);
  if (unitCap !== null && signalPrice !== null && signalPrice > unitCap) {
    return rejected(INTENT_PRICE_ABOVE_MAX_REASON);
  }
  const effectiveUnitCapCents = unitCap === null
    ? signalPrice
    : signalPrice === null ? unitCap : Math.min(unitCap, signalPrice);
  const priceVerificationDeferred = options.allowDeferredLiveOfferVerification === true
    && !foreignCurrency
    && policy.actionCeiling === "add_to_cart"
    && signalPrice === null
    && Number.isSafeInteger(unitCap)
    && Number(unitCap) > 0;
  if ((signalPrice === null && !priceVerificationDeferred)
    || (policy.actionCeiling !== "notify" && unitCap === null)) {
    return {
      state: "needs_price",
      reason: foreignCurrency
        ? CURRENCY_MISMATCH_REASON
        : "The exact purchase plan matched, but the source did not provide a numeric price that can be verified against the reviewed maximum.",
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
      : priceVerificationDeferred || sellerVerificationDeferred || fulfillmentVerificationDeferred
        ? "The fresh trusted exact signal matched the reviewed cart plan; Chrome must verify the current price, first-party seller, and exact fulfillment before Add."
      : "The fresh exact offer matched the reviewed cart plan; live Chrome verification is still required.",
    strategy: null,
    decisionSource: "purchase_intent",
    maxSignalAgeSeconds: policy.maxSignalAgeSeconds,
    effectiveUnitCapCents,
    effectiveQuantity: purchaseIntentQuantity(policy, signal, listing),
    effectiveAction: policy.actionCeiling,
    sellerPolicy,
    fulfillment
  };
}

/**
 * How many a matched cart plan asks Chrome to add (Kevin, 2026-10-10): the
 * plan's quantity, at most GUARDED_CART_MAX_QUANTITY, and no more than a store
 * limit the call itself reported. Chrome lowers it again to the limit it reads
 * on the store page. Only the four stores whose runners set a quantity take
 * more than one; every other store, and every alert, stays at one.
 */
export function purchaseIntentQuantity(policy: PurchaseIntentPolicy, signal: NormalizedSignal, listing: ListingContext): number {
  if (policy.actionCeiling !== "add_to_cart" || !MSRP_GUARDED_RETAILERS.includes(listing.retailerId)) return 1;
  const wanted = Number.isSafeInteger(policy.quantity)
    ? Math.max(1, Math.min(Number(policy.quantity), GUARDED_CART_MAX_QUANTITY)) : 1;
  const limit = signal.offer.orderLimit;
  return Number.isSafeInteger(limit) && Number(limit) > 0 ? Math.min(wanted, Number(limit)) : wanted;
}
