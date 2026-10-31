import { PLAN_DELETED_DECISION_OUTCOME, PLAN_PAUSED_DECISION_OUTCOME } from "./plan-status-decisions.js";
import {
  INTENT_EXPIRED_REASON,
  INTENT_FULFILLMENT_REASON,
  INTENT_PRICE_ABOVE_MAX_REASON,
  INTENT_SELLER_REASON,
  INTENT_TARGET_DISABLED_REASON,
  STRATEGY_NO_MATCH_REASON
} from "./strategies.js";

/**
 * The shopper's call log: one plain-language line per call saying what Yoink
 * did with it and, when it did not add to cart, why.
 *
 * Nothing here re-evaluates a call. It reads back what the engine already
 * recorded (the decision outcome and reason, the call's job and its events)
 * plus the item's plan as it stands now, so "your max is $49.99" is the
 * current max, and the store's latest Chrome sign-in state.
 */

export type CallResultKind =
  | "added"
  | "adding"
  | "needs_you"
  | "alert"
  | "not_added"
  | "no_action"
  | "repeat"
  | "checked"
  | "test";

export type CallResultTone = "good" | "info" | "warn" | "muted";

/** The one next step the dashboard offers beside a result. */
export type CallResultFix =
  | "want_it"
  | "edit_want"
  | "store_setup"
  | "resume_actions"
  | "open_cart"
  | "spending_limits"
  | "link_product"
  | "";

export interface CallResult {
  kind: CallResultKind;
  label: string;
  reason: string;
  detail: string;
  tone: CallResultTone;
  fix: CallResultFix;
  priceVsMax: "over" | "within" | "";
  priceVsMsrp: "above" | "at_or_below" | "";
}

export interface CallResultPlan {
  status: string;
  actionCeiling: string;
  /** `signal:<source>` when a call created the plan rather than the shopper. */
  origin: string;
  /** This store's listing in the plan: null when the plan has no row for it. */
  targetEnabled: boolean | null;
  targetMaxCents: number | null;
}

export interface CallResultJob {
  action: string;
  state: string;
  /** State of the job's first event: `shadow_ready` means test mode. */
  firstState: string;
  /** Reason code of the job's latest event. */
  reasonCode: string;
  notificationState: string;
  notificationFailureCode: string;
  userReportOutcome: string;
  /** How many the job asked for, how many Chrome added (cart delta) and the store's per-order limit, when known. */
  quantity?: number;
  addedQuantity?: number | null;
  storeLimit?: number | null;
  /** Why the cart line couldn't be raised to the plan's quantity after the add, when it couldn't. */
  quantityRaiseReason?: string;
  /** How many the cart already held before the add: a call only tops the cart up to the plan's quantity. */
  cartQuantityBefore?: number | null;
}

export interface CallResultInput {
  test: boolean;
  outcome: string;
  reason: string;
  storeName: string;
  /** The store is turned on for cart adds. */
  storeOn: boolean;
  priceCents: number | null;
  currency: string;
  msrpCents: number | null;
  /** The source's own MSRP verdict (TrackaLacker: above_msrp, surge, at_msrp, near_msrp, below_msrp). */
  sourceMsrpStatus: string;
  sellerType: string;
  observedAt: string;
  receivedAt: string;
  plan: CallResultPlan | null;
  job: CallResultJob | null;
  /** Latest Chrome sign-in state for the store: ready, signed_out, challenged or unknown. */
  signedInState: string;
  /** Where the call came from ("trackalacker", "discord"); "" for older rows. */
  source?: string;
  /** A Discord message read from Windows notifications on the shopper's PC. */
  discordNotification?: boolean;
  /** The source channel's trust: "informational" channels log calls without adding. */
  sourceTrustLevel?: string;
  /** How Yoink traced a Discord message to its product, in one sentence. */
  traceExplanation?: string;
  /** A Discord message that is no item call: "notice", or a time ("drawing", "drop", "queue"). */
  discordKind?: string;
  /** The drop, drawing or queue time a Discord message gave (ISO). */
  discordDropAt?: string;
  /** For a time given only as a day ("tonight"): when its window ends (ISO). */
  discordDropUntil?: string;
}

/** "Oct 14, 2:00 PM PDT", in this install's time zone unless one is given. */
export function formatDropTime(iso: string, timeZone?: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(timeZone ? { timeZone } : {})
  }).format(new Date(time));
}

const LABELS: Readonly<Record<CallResultKind, { label: string; tone: CallResultTone }>> = Object.freeze({
  added: { label: "Added to cart", tone: "good" },
  adding: { label: "Adding to cart", tone: "info" },
  needs_you: { label: "Needs you", tone: "warn" },
  alert: { label: "Skipped", tone: "info" },
  not_added: { label: "Not added", tone: "warn" },
  no_action: { label: "No action", tone: "muted" },
  repeat: { label: "Repeat call", tone: "muted" },
  checked: { label: "Checked only", tone: "muted" },
  test: { label: "Test call", tone: "muted" }
});

/** Outcomes that create no job and send nothing; a job on the same restock belongs to another call. */
export const CALL_OUTCOMES_WITHOUT_ACTION: ReadonlySet<string> = new Set([
  "test_signal",
  "ambiguous_identity",
  "unresolved_identity",
  "non_actionable_event",
  PLAN_PAUSED_DECISION_OUTCOME,
  PLAN_DELETED_DECISION_OUTCOME,
  "no_mission",
  "unmatched",
  "stale",
  "quantity_limited",
  "sibling_store_claimed"
]);

/** Why a call waited (sibling_store_claimed) when the plan's claim is an add that needs the shopper. */
export const CLAIMED_BY_NEEDS_YOU_REASON =
  "An earlier add for this plan needs the shopper to check the store cart; this signal remains recorded and the plan acts again once that add is closed.";

const ADDING_STATES = new Set([
  "awaiting_executor",
  "leased",
  "navigating",
  "verifying_listing",
  "offer_verified",
  "add_authorized",
  "adding",
  "cart_verified"
]);
const NEEDS_YOU_STATES = new Set([
  "checkout_review",
  "manual_review",
  "submit_authorized",
  "submitting",
  "submission_uncertain"
]);
const CART_CHECK_CODES = new Set([
  "cart_page_unverified",
  "cart_unverified",
  "cart_evidence_stale",
  "cart_baseline_stale",
  "cart_baseline_invalid",
  "manual_action_required",
  "retailer_not_supported"
]);
const COMPANION_UPDATE_CODES = new Set([
  "contract_version_mismatch",
  "job_identity_invalid",
  "canonical_url_invalid",
  "quantity_invalid",
  "unit_cap_invalid",
  "total_cap_invalid",
  "fulfillment_not_supported",
  "adapter_version_mismatch",
  "unsupported_action",
  "quantity_not_supported",
  "seller_policy_not_supported"
]);

export function formatCallMoney(cents: number | null, currency = "USD"): string {
  if (cents === null || !Number.isFinite(cents)) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function positiveCents(value: number | null | undefined): number | null {
  const cents = Number(value);
  return value !== null && value !== undefined && Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function durationWords(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

interface Explanation {
  reason: string;
  detail: string;
  fix?: CallResultFix | undefined;
}

export function describeCallResult(input: CallResultInput): CallResult {
  const store = input.storeName.trim() || "the store";
  const price = positiveCents(input.priceCents);
  const msrp = positiveCents(input.msrpCents);
  const max = positiveCents(input.plan?.targetMaxCents);
  const priceText = formatCallMoney(price, input.currency);
  const msrpText = formatCallMoney(msrp, input.currency);
  const maxText = formatCallMoney(max, input.currency);
  const priceVsMax: CallResult["priceVsMax"] = price !== null && max !== null ? price > max ? "over" : "within" : "";
  const sourceAbove = ["above_msrp", "surge"].includes(input.sourceMsrpStatus);
  const sourceAtOrBelow = ["at_msrp", "near_msrp", "below_msrp"].includes(input.sourceMsrpStatus);
  const priceVsMsrp: CallResult["priceVsMsrp"] = price !== null && msrp !== null ? price > msrp ? "above" : "at_or_below"
    : sourceAbove ? "above" : sourceAtOrBelow ? "at_or_below" : "";
  // "Walmart listed it at $64.99, above its $49.99 MSRP." A Discord call's price is the message's.
  const said = input.discordNotification === true;
  const listed = price === null ? ""
    : said ? msrp !== null
      ? `The message said ${priceText}${priceVsMsrp === "above" ? `, above the ${msrpText} MSRP` : ` (MSRP ${msrpText})`}.`
      : `The message said ${priceText}.`
    : msrp !== null ? priceVsMsrp === "above"
      ? `${store} listed it at ${priceText}, above its ${msrpText} MSRP.`
      : `${store} listed it at ${priceText} (MSRP ${msrpText}).`
      : input.sourceMsrpStatus === "surge" ? `${store} listed it at ${priceText}, a price surge over MSRP.`
        : sourceAbove ? `${store} listed it at ${priceText}, above MSRP.`
          : `${store} listed it at ${priceText}.`;

  const build = (kind: CallResultKind, explanation: Explanation, label = LABELS[kind].label, tone = LABELS[kind].tone): CallResult => ({
    kind,
    label,
    reason: explanation.reason,
    detail: explanation.detail.trim(),
    tone,
    fix: explanation.fix ?? "",
    priceVsMax,
    priceVsMsrp
  });

  if (input.test || input.outcome === "test_signal") {
    return build("test", { reason: "Test from the source", detail: "Yoink records test calls but never acts on them." });
  }
  // Setup › Discord: a channel set to Log only keeps its calls without adding.
  if (input.discordNotification === true && input.sourceTrustLevel === "informational"
    && ["untrusted_source", "unmatched", "needs_price", "intent_price_required"].includes(input.outcome)) {
    return build("no_action", {
      reason: "Log only channel",
      detail: `You set this Discord channel to Log only, so Yoink didn't add it. ${listed}`.trim()
    });
  }
  // Discord messages that are no item call (Kevin, 2026-10-13): a notice, or a time an item drops.
  if (input.discordNotification === true && (input.discordKind === "notice" || input.discordKind === "message")) {
    return build("no_action", {
      reason: input.discordKind === "message" ? "Discord message" : "Notice, not a product",
      detail: input.traceExplanation || "The message names no product, so Yoink didn't act on it."
    });
  }
  if (input.discordNotification === true && input.discordKind === "no_store" && input.outcome === "unresolved_identity") {
    return build("no_action", {
      reason: "No store named",
      detail: `${input.traceExplanation || "Yoink found the product, but the message names no store."} Want it at the stores you choose, and a message like this is checked there.`.trim()
    });
  }
  if (input.discordNotification === true && ["drawing", "drop", "queue"].includes(input.discordKind ?? "")
    && ["non_actionable_event", "unresolved_identity"].includes(input.outcome)) {
    const until = formatDropTime(input.discordDropUntil ?? "");
    const when = until ? `between ${formatDropTime(input.discordDropAt ?? "")} and ${until}` : formatDropTime(input.discordDropAt ?? "");
    const unmatched = input.outcome === "unresolved_identity";
    return build("no_action", {
      reason: input.discordKind === "drawing" ? `Drawing starts ${when}` : input.discordKind === "queue" ? `Queue opens ${when}` : `Drops ${when}`,
      detail: `${input.traceExplanation || ""}${unmatched ? " Link it to a product and Yoink matches it next time." : ""}`.trim(),
      ...(unmatched ? { fix: "link_product" } : {})
    });
  }
  if (CALL_OUTCOMES_WITHOUT_ACTION.has(input.outcome)) {
    return build("no_action", noActionExplanation(input, store, { listed, priceText, maxText, msrpText, priceVsMax, priceVsMsrp }));
  }
  if (input.outcome === "corroborated") {
    return build("repeat", {
      reason: "Same restock as an earlier call",
      detail: "Yoink already acted on this restock with an earlier call, so this one changed nothing."
    });
  }
  const job = input.job;
  if (!job) {
    return build("no_action", {
      reason: input.outcome ? "Nothing was started" : "Not decided",
      detail: input.outcome
        ? "Yoink matched this call but has no record of a cart add for it."
        : "Yoink recorded this call without a decision."
    });
  }
  if (job.action === "notify") return alertResult(input, job, store, { listed, priceText, maxText }, build);
  return cartResult(input, job, store, build);
}

interface PriceWords {
  listed: string;
  priceText: string;
  maxText: string;
  msrpText?: string;
  priceVsMax?: CallResult["priceVsMax"];
  priceVsMsrp?: CallResult["priceVsMsrp"];
}

function noActionExplanation(input: CallResultInput, store: string, words: PriceWords): Explanation {
  const plan = input.plan;
  switch (input.outcome) {
    case "ambiguous_identity":
      return { reason: "Couldn't tell which item", detail: `The call matched more than one ${store} item, so Yoink didn't act.` };
    case "unresolved_identity":
      if (input.discordNotification === true) {
        return {
          reason: "Not matched to a product",
          detail: `${input.traceExplanation || "Yoink couldn't match this Discord message to a product."} Link it to a product and Yoink matches it next time.`,
          fix: "link_product"
        };
      }
      return { reason: "Item not recognized", detail: "Yoink couldn't match this call to an exact store item, so it didn't act." };
    case "non_actionable_event":
      return { reason: "Not a restock", detail: "The call reported something other than a restock, such as a sellout or a price change." };
    case PLAN_PAUSED_DECISION_OUTCOME:
      return { reason: "Paused", detail: `You paused this item, so Yoink didn't act. ${words.listed}`, fix: "edit_want" };
    case PLAN_DELETED_DECISION_OUTCOME:
      return { reason: "Removed from your list", detail: `You removed this item, so Yoink didn't act. ${words.listed}`, fix: "want_it" };
    case "no_mission":
      return {
        reason: "Not on your Want list",
        // A Discord message says how it reached this item, e.g. a store link Yoink linked to a product just now.
        detail: `${input.discordNotification === true && input.traceExplanation ? `${input.traceExplanation} ` : ""}${words.listed} Tap Want it to have Yoink add it to your cart next time.`,
        fix: "want_it"
      };
    case "stale": {
      const age = Date.parse(input.receivedAt) - Date.parse(input.observedAt);
      return {
        reason: "Arrived too late",
        detail: Number.isFinite(age) && age > 0
          ? `The call reached Yoink ${durationWords(age)} after the restock, too late to act on.`
          : "The call reached Yoink too late to act on."
      };
    }
    case "quantity_limited":
      return { reason: "Store limit too low", detail: `${store} limits this item below the quantity you want.`, fix: "edit_want" };
    case "sibling_store_claimed":
      return input.reason === CLAIMED_BY_NEEDS_YOU_REASON
        ? {
          reason: "Waiting on you",
          detail: "An earlier add of this item needs you to check its cart. Mark it Got it or Missed it in Activity, and Yoink acts on this item's next call."
        }
        : { reason: "Adding from another store", detail: "Yoink is already adding this item from another store." };
    default:
      break;
  }
  // A plan a call created by itself only watches; it was never the shopper's
  // choice, so its unconfirmed-seller and delivery turn-downs read as "not wanted".
  if (plan?.origin.startsWith("signal:") && plan.actionCeiling !== "add_to_cart"
    && [INTENT_SELLER_REASON, INTENT_FULFILLMENT_REASON].includes(input.reason)) {
    return {
      reason: "Not on your Want list",
      detail: `${words.listed} Yoink only watches this item because a call mentioned it. Tap Want it to have Yoink add it to your cart next time.`,
      fix: "want_it"
    };
  }
  // unmatched: the reviewed plan (or legacy rules) turned the call down.
  if (input.reason === INTENT_PRICE_ABOVE_MAX_REASON
    || (input.reason === STRATEGY_NO_MATCH_REASON && words.priceVsMax === "over")) {
    const over = words.priceText && words.maxText
      ? `${store} listed it at ${words.priceText}, over your ${words.maxText} max.`
      : "The price was over your max.";
    const msrp = words.priceVsMsrp === "above" && words.msrpText ? ` That's above its ${words.msrpText} MSRP too.` : "";
    return { reason: "Over your max price", detail: `${over}${msrp}`, fix: "edit_want" };
  }
  if (input.reason === INTENT_TARGET_DISABLED_REASON) {
    if (plan && plan.status !== "active") {
      return { reason: "Paused", detail: `You paused this item, so Yoink didn't act. ${words.listed}`, fix: "edit_want" };
    }
    if (plan?.actionCeiling === "add_to_cart" && !input.storeOn) {
      return {
        reason: `${store} is off for cart adds`,
        detail: `This item adds to cart only at stores that are turned on, so ${store} isn't watched for it. Turn ${store} on to have Yoink add it there.`,
        fix: "store_setup"
      };
    }
    return {
      reason: `Not watching ${store}`,
      detail: `Your plan for this item doesn't include ${store}. Edit it to watch ${store} too. ${words.listed}`,
      fix: "edit_want"
    };
  }
  if (input.reason === INTENT_EXPIRED_REASON) {
    return { reason: "Plan ended", detail: "Your plan for this item expired. Edit it to start watching again.", fix: "edit_want" };
  }
  if (input.reason === INTENT_SELLER_REASON) {
    return input.sellerType === "third_party"
      ? { reason: "Sold by another seller", detail: `Yoink only adds items sold by ${store} itself, and this call was for a marketplace seller.` }
      : { reason: "Seller not confirmed", detail: `The call didn't confirm ${store} itself as the seller, which Yoink needs before it acts.` };
  }
  if (input.reason === INTENT_FULFILLMENT_REASON) {
    return { reason: "Delivery didn't match", detail: "The call's delivery option (shipping or pickup) didn't match your plan." };
  }
  if (input.reason === STRATEGY_NO_MATCH_REASON) {
    return {
      reason: "Didn't match your rules",
      detail: `No rule matched this store, price and seller. ${words.listed}`,
      fix: "edit_want"
    };
  }
  return { reason: "Didn't match your plan", detail: `The call didn't match your plan for this item. ${words.listed}`, fix: "edit_want" };
}

/** Why a matched call was skipped instead of added to the cart, keyed by decision outcome or policy code. */
function alertExplanation(code: string, store: string): Explanation | null {
  switch (code) {
    case "actions_paused":
      return { reason: "Cart adds paused", detail: "Cart adds are paused, so Yoink didn't add it. Resume them to add to cart.", fix: "resume_actions" };
    case "unsupported_retailer":
      return { reason: `${store} can't add to cart yet`, detail: `Yoink can't add to cart at ${store} yet, so it didn't add it.` };
    case "guarded_add_lane_not_qualified":
      return { reason: `${store} is off for cart adds`, detail: `${store} isn't turned on for cart adds, so Yoink didn't add it. Turn ${store} on to add to cart next time.`, fix: "store_setup" };
    case "guarded_add_quantity_not_supported":
      return { reason: "Adds one at a time", detail: "Cart adds are one item per restock and this plan asked for more, so Yoink didn't add it." };
    // Amazon, Target, Walmart and Best Buy add only under a saved price rule: an MSRP, or any price up to the max.
    case "official_msrp_review_required":
    case "official_msrp_plan_review_required":
      return { reason: "No price limit saved", detail: `This item had no saved price limit for ${store} (an MSRP, or Any price up to my max), so Yoink didn't add it. Open Want it and save it to add to cart next time.`, fix: "edit_want" };
    case "official_msrp_signal_price_unverified":
      return { reason: "Above your price limit", detail: `The ${store} price was above the MSRP or max you saved, so Yoink didn't add it.`, fix: "edit_want" };
    case "official_msrp_signal_price_missing":
      return { reason: "No price to check", detail: "The call didn't say a price Yoink could check against your MSRP and max, so it didn't add it." };
    case "official_msrp_fresh_signal_required":
      return { reason: "Too late to add", detail: "The call was more than 2 minutes old by the time Yoink checked it, so it didn't add it." };
    case "official_msrp_cart_policy_invalid":
      return { reason: "Plan needs a check", detail: `Cart adds at ${store} need Shipping, the store itself as seller and a quantity from 1 to 10, so Yoink didn't add it. Open Want it and save it.`, fix: "edit_want" };
    case "untrusted_source":
      return { reason: "This source can't add", detail: "Calls from this source are logged but can't start a cart add." };
    case "needs_price":
    case "intent_price_required":
      return { reason: "No price to check", detail: "The call didn't include a price Yoink could check against your max, so it didn't add it." };
    case "intent_currency_mismatch":
      return { reason: "Different currency", detail: "The call's price was in another currency, so Yoink couldn't check it against your max and didn't add it." };
    case "stale_for_cart":
      return { reason: "Too late to add", detail: "The call arrived too late for a cart add, so Yoink didn't add it." };
    case "affiliate_route_unavailable":
      return { reason: "Store link unavailable", detail: "The store link Yoink needed was unavailable, so it didn't add it." };
    case "intent_target_disabled":
      return { reason: `Not watching ${store}`, detail: `Your plan for this item doesn't include ${store}, so Yoink didn't add it.`, fix: "edit_want" };
    case "intent_expired":
      return { reason: "Plan ended", detail: "Your plan for this item expired, so Yoink didn't add it.", fix: "edit_want" };
    case "intent_action_ceiling":
      return { reason: "Notify only", detail: "This item is set to Notify only, so Yoink didn't add it. Switch it to Add to cart to have Yoink add it.", fix: "edit_want" };
    case "intent_quantity_exceeded":
      return { reason: "You have enough", detail: "You already have the quantity you wanted, so Yoink didn't add it." };
    case "intent_quantity_in_cart":
    case "reserved_quantity_exceeded":
      return { reason: "Already in your cart", detail: "An earlier add for this item is still in your cart or in progress, so Yoink didn't add it.", fix: "open_cart" };
    case "intent_unit_cap_exceeded":
      return { reason: "Over your max price", detail: `The ${store} price was over your max, so Yoink didn't add it.`, fix: "edit_want" };
    case "intent_all_in_cap_exceeded":
      return { reason: "Over your max total", detail: "With tax and store fees the order could go over your max total, so Yoink didn't add it.", fix: "edit_want" };
    case "intent_seller_unverified":
      return { reason: "Seller not confirmed", detail: `The call didn't confirm ${store} itself as the seller, so Yoink didn't add it.` };
    case "intent_fulfillment_unverified":
      return { reason: "Delivery didn't match", detail: "The call's delivery option didn't match your plan, so Yoink didn't add it." };
    case "intent_cooldown_active":
      return { reason: "Waiting between adds", detail: "Your plan waits between cart adds and that wait wasn't over, so Yoink didn't add it." };
    case "per_order_cap_exceeded":
      return { reason: "Over your per-order limit", detail: "This item's max total is above your per-order spending limit, so Yoink didn't add it.", fix: "spending_limits" };
    case "daily_spend_cap_exceeded":
      return { reason: "Daily limit reached", detail: "Today's spending limit didn't have room for this item, so Yoink didn't add it.", fix: "spending_limits" };
    case "monthly_spend_cap_exceeded":
      return { reason: "Monthly limit reached", detail: "This month's spending limit didn't have room for this item, so Yoink didn't add it.", fix: "spending_limits" };
    case "reservation_amount_invalid":
    case "reservation_quantity_invalid":
      return { reason: "Max total not set", detail: "The plan needs a valid max total before Yoink can add to cart, so it didn't add it.", fix: "edit_want" };
    case "reservation_intent_stale":
      return { reason: "Plan just changed", detail: "Your plan changed while the call was checked, so Yoink didn't add it." };
    case "purchase_policy_blocked":
      return { reason: "Plan limits", detail: "Your plan or spending limits didn't allow a cart add, so Yoink didn't add it.", fix: "edit_want" };
    default:
      return null;
  }
}

function alertResult(
  input: CallResultInput,
  job: CallResultJob,
  store: string,
  words: PriceWords,
  build: (kind: CallResultKind, explanation: Explanation, label?: string, tone?: CallResultTone) => CallResult
): CallResult {
  // A matched call is skipped as Notify only when the plan said so at the time,
  // so say so even if the item has been switched to Add to cart since. Chrome
  // raises no alert for a skipped call (Kevin, 2026-10-13); the call log shows it.
  const why = alertExplanation(input.outcome, store)
    ?? (job.reasonCode ? alertExplanation(job.reasonCode, store) : null)
    ?? (input.plan?.actionCeiling === "add_to_cart"
      ? { reason: "Notify only", detail: `The item was set to Notify only when this call came in, so Yoink didn't add it. ${words.listed} It's set to Add to cart now.` }
      : { reason: "Notify only", detail: `This item is set to Notify only, so Yoink didn't add it. ${words.listed} Switch it to Add to cart to have Yoink add it.`, fix: "edit_want" as const });
  return build("alert", why);
}

function cartResult(
  input: CallResultInput,
  job: CallResultJob,
  store: string,
  build: (kind: CallResultKind, explanation: Explanation, label?: string, tone?: CallResultTone) => CallResult
): CallResult {
  if (job.userReportOutcome === "got_it") {
    return build("added", { reason: "You checked out", detail: `Yoink added it to your ${store} cart and you reported the order.` }, "Got it");
  }
  if (job.userReportOutcome === "missed_it") {
    return build("not_added", { reason: "Checkout missed", detail: `Yoink added it to your ${store} cart, and you reported that checkout didn't go through.` }, "Missed it", "muted");
  }
  const state = job.state;
  if (state === "confirmed") {
    const wanted = Number(job.quantity) > 1 ? Number(job.quantity) : 1;
    const before = Number(job.cartQuantityBefore) >= 1 ? Number(job.cartQuantityBefore) : 0;
    const added = Number(job.addedQuantity) >= 1 ? Number(job.addedQuantity) : Math.max(1, wanted - before);
    const total = before + added;
    const limited = total >= wanted ? ""
      : Number(job.storeLimit) >= 1 && total >= Number(job.storeLimit)
        ? ` ${store} allows ${Number(job.storeLimit)} per order, so that's the most ${before ? "your cart can hold" : "it could add"} (you wanted ${wanted}).`
        : ` You wanted ${wanted}; ${store}'s cart didn't take more${job.quantityRaiseReason ? ` (${job.quantityRaiseReason.replace(/_/g, " ")})` : ""}, so raise it there if you still want them.`;
    const what = before
      ? `Chrome added ${added === 1 ? "one more" : `${added} more`} to the ${before} already in your ${store} cart, ${total} in all, and confirmed it.`
      : `${added > 1 ? `Chrome added ${added}` : "Chrome added it"} and confirmed your ${store} cart.`;
    return build("added", {
      reason: `In your ${store} cart`,
      detail: `${what}${limited} Check out there before it sells out.`,
      fix: "open_cart"
    });
  }
  // Kevin, 2026-10-12: a call for an item the cart already holds (all the
  // plan's quantity, or all the store allows) adds nothing; checkout opens.
  if (state === "cancelled" && job.reasonCode === "already_in_cart") {
    const wanted = Number(job.quantity) > 1 ? Number(job.quantity) : 1;
    const before = Number(job.cartQuantityBefore) >= 1 ? Number(job.cartQuantityBefore) : wanted;
    const limit = Number(job.storeLimit) >= 1 ? Number(job.storeLimit) : 0;
    const had = before < wanted && limit && before >= limit
      ? `already had ${before}, ${store}'s limit per order (you wanted ${wanted})`
      : before === wanted ? (wanted === 1 ? "already had it" : `already had the ${wanted} you wanted`)
        : `already had ${before} (you wanted ${wanted})`;
    return build("added", {
      reason: `Already in your ${store} cart`,
      detail: `Your ${store} cart ${had}, so Chrome didn't add more and opened checkout. Check out there before it sells out.`,
      fix: "open_cart"
    }, "Already in cart");
  }
  if (state === "shadow_ready" || (state === "expired" && job.firstState === "shadow_ready")) {
    return build("checked", {
      reason: "Test mode",
      detail: "Yoink is in test mode, so it checked this call without adding to cart."
    });
  }
  if (ADDING_STATES.has(state)) {
    return build("adding", state === "awaiting_executor"
      // Retry when sold out (Setup › Stores): the job waits for its next try.
      ? job.reasonCode === "restock_retry_scheduled"
        ? { reason: "Sold out, trying again", detail: `${store} itself didn't have it (sold out, or only another seller had it). Yoink reloads the page and tries again shortly, as set in Retry when sold out.` }
        : { reason: "Waiting for Chrome", detail: "Yoink queued the cart add and is waiting for the Chrome companion to pick it up." }
      : { reason: "Chrome is adding it", detail: `Chrome is checking the ${store} page and adding the item to your cart.` });
  }
  if (NEEDS_YOU_STATES.has(state)) {
    return build("needs_you", {
      reason: `Check your ${store} cart`,
      detail: `Chrome may have added it but couldn't confirm your ${store} cart. Check the cart yourself.`,
      fix: "open_cart"
    });
  }
  if (state === "expired") {
    return build("not_added", {
      reason: "Chrome didn't get to it in time",
      detail: "The cart add window closed before Chrome picked it up. Keep Chrome open with the companion running."
    });
  }
  if (state === "offer_rejected") return build("not_added", offerRejection(job.reasonCode, store, input.signedInState));
  if (state === "cancelled") return build("not_added", cancellation(job.reasonCode, store, input.signedInState));
  return build("not_added", { reason: "Stopped before adding", detail: `The cart add at ${store} ended without adding the item.` });
}

// A store's robot check (Walmart's Press & Hold) stops the add whether or not
// the shopper is signed in; the tab stays open for them to finish it.
function storeCheckExplanation(store: string): Explanation {
  return { reason: `${store} wanted a robot check`, detail: `${store} showed its robot or security check, so Chrome stopped before adding. Finish it in the open ${store} tab, then try again.`, fix: "store_setup" };
}

function signInExplanation(store: string, signedInState: string): Explanation | null {
  if (signedInState === "signed_out") {
    return { reason: `Signed out of ${store}`, detail: `Chrome was signed out of ${store}, so it stopped before adding. Sign in to ${store} in Chrome.`, fix: "store_setup" };
  }
  if (signedInState === "challenged") {
    return { reason: `${store} wanted a security check`, detail: `${store} showed a sign-in or security check, so Chrome stopped before adding. Finish it in Chrome.`, fix: "store_setup" };
  }
  return null;
}

function offerRejection(code: string, store: string, signedInState: string): Explanation {
  if (COMPANION_UPDATE_CODES.has(code)) {
    return { reason: "Update the Chrome companion", detail: "The Chrome companion is out of date for this cart add. Update it in Settings › Chrome." };
  }
  switch (code) {
    case "out_of_stock":
      return { reason: "Sold out when Chrome checked", detail: `${store} reported the item out of stock during the page or checkout check. No checkout-ready alert was sent.` };
    case "add_control_unavailable":
      return { reason: "No Add to cart button", detail: `Chrome couldn't find ${store}'s Add to cart button for this item.` };
    // Amazon's page said "No featured offers available" (Kevin's NeeDoh, 2026-10-12).
    case "no_featured_offer":
      return { reason: `${store} wasn't selling it`, detail: `When Chrome checked, ${store}'s page said "No featured offers available": no Add to cart button, only other sellers under See All Buying Options. Yoink adds only what ${store} sells itself.` };
    case "over_unit_cap":
      return { reason: "Price went over your max", detail: `When Chrome checked ${store}, the price was over your max, so it didn't add.`, fix: "edit_want" };
    case "over_total_cap":
      return { reason: "Over your max total", detail: "With tax and fees the order would have gone over your max total, so Chrome didn't add.", fix: "edit_want" };
    case "third_party_seller":
    case "signal_seller_mismatch":
      return { reason: "Sold by another seller", detail: `When Chrome checked, the item was sold by a marketplace seller, not ${store}.` };
    case "seller_unverified":
      return { reason: "Seller not confirmed", detail: `Chrome couldn't confirm that ${store} itself was the seller.` };
    case "price_unavailable":
      return { reason: "Couldn't read the price", detail: `Chrome couldn't read the price on ${store}'s page, so it didn't add.` };
    case "currency_mismatch":
      return { reason: "Different currency", detail: `${store}'s page showed a price in another currency.` };
    case "fulfillment_unverified":
    case "fulfillment_selection_failed":
      return { reason: "Shipping not available", detail: `Chrome couldn't choose the delivery option your plan needs at ${store}.` };
    case "listing_mismatch":
    case "product_page_unverified":
    case "offer_binding_changed":
    case "offer_id_missing_or_ambiguous":
      return { reason: "Store page didn't match", detail: `${store}'s page didn't match the exact item, so Chrome didn't add.` };
    case "security_challenge":
      return storeCheckExplanation(store);
    case "manual_action_required":
      return signInExplanation(store, signedInState === "ready" ? "challenged" : signedInState)
        ?? { reason: `${store} wanted a security check`, detail: `${store} showed a sign-in or security check, so Chrome stopped before adding.`, fix: "store_setup" };
    case "offer_stale":
    case "job_expired":
      return { reason: "Ran out of time", detail: "The cart add window closed while Chrome was checking the item." };
    default:
      return { reason: "Didn't pass Chrome's check", detail: `Chrome checked ${store}'s live page and it didn't pass every check in your plan.` };
  }
}

function cancellation(code: string, store: string, signedInState: string): Explanation {
  if (CART_CHECK_CODES.has(code)) {
    return signInExplanation(store, signedInState) ?? {
      reason: `Couldn't read your ${store} cart`,
      detail: `Chrome checks your ${store} cart before adding, and it couldn't read it this time. Make sure you're signed in to ${store} in Chrome.`,
      fix: "store_setup"
    };
  }
  // extension_error_<step>_<kind> (the companion names where it stopped) reads like extension_error.
  if (code.startsWith("extension_error_")) {
    return { reason: "Chrome stopped before adding", detail: "The Chrome companion stopped before it clicked Add to cart. Nothing was added." };
  }
  switch (code) {
    case "security_challenge":
      return storeCheckExplanation(store);
    case "listing_mismatch":
      return { reason: "Store page didn't match", detail: `${store}'s link opened a different item than the call named, so Chrome didn't add.` };
    case "retailer_access_missing":
      return { reason: `Chrome can't open ${store}`, detail: `The Chrome companion doesn't have access to ${store}. Allow it in the companion's settings.`, fix: "store_setup" };
    case "worker_restarted_before_add":
    case "extension_error":
    case "lease_contract_rejected":
    case "runner_unavailable":
    case "runner_failed":
    case "runner_no_result":
      return { reason: "Chrome stopped before adding", detail: "The Chrome companion stopped before it clicked Add to cart. Nothing was added." };
    case "lease_expired_before_mutation":
      return { reason: "Ran out of time", detail: "The cart add window closed before Chrome could add the item." };
    case "intent_revision_superseded":
      return { reason: "You changed the plan", detail: "You changed this item's plan before Chrome started, so Yoink dropped the old cart add." };
    case "plan_paused":
      return { reason: "You paused it", detail: "You paused this item before Chrome started, so Yoink dropped the cart add." };
    case "purchase_plan_deleted":
      return { reason: "You removed it", detail: "You removed this item before Chrome started, so Yoink dropped the cart add." };
    case "user_verified_no_purchase":
    case "user_reviewed_no_order":
      return { reason: "You said it wasn't added", detail: "You reported that the item didn't reach your cart." };
    case "checkout_outcome_corrected":
      return { reason: "Report corrected", detail: "You corrected the checkout report for this cart add." };
    default:
      return { reason: "Stopped before adding", detail: `The cart add at ${store} stopped before Chrome clicked Add to cart. Nothing was added.` };
  }
}

export interface CallResultSummary {
  total: number;
  added: number;
  adding: number;
  needsYou: number;
  alerts: number;
  notAdded: number;
  noAction: number;
}

export function summarizeCallResults(results: CallResult[]): CallResultSummary {
  const summary: CallResultSummary = { total: 0, added: 0, adding: 0, needsYou: 0, alerts: 0, notAdded: 0, noAction: 0 };
  for (const result of results) {
    summary.total += 1;
    if (result.kind === "added") summary.added += 1;
    else if (result.kind === "adding") summary.adding += 1;
    else if (result.kind === "needs_you") summary.needsYou += 1;
    else if (result.kind === "alert") summary.alerts += 1;
    else if (result.kind === "not_added") summary.notAdded += 1;
    else summary.noAction += 1;
  }
  return summary;
}

function optionalCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const cents = Number(value);
  return Number.isFinite(cents) ? cents : null;
}

function storeNameFromId(retailerId: string): string {
  const value = retailerId.trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

/** Reads one SignalRepository call row (listSignals / callRowsSince) into the classifier's input. */
export function callResultInputFromRow(row: Record<string, unknown>): CallResultInput {
  const jobId = String(row.actionJobId ?? "");
  return {
    test: Number(row.test) === 1 || row.test === true,
    outcome: String(row.missionDecision ?? ""),
    reason: String(row.missionReason ?? ""),
    storeName: String(row.retailerName ?? "") || storeNameFromId(String(row.retailerId ?? "")),
    storeOn: Number(row.executionSupported) === 1,
    priceCents: optionalCents(row.unitPriceCents),
    currency: String(row.currency || "USD"),
    msrpCents: optionalCents(row.msrpCents),
    sourceMsrpStatus: String(row.sourceMsrpStatus ?? ""),
    sellerType: String(row.sellerType || "unknown"),
    observedAt: String(row.observedAt ?? ""),
    receivedAt: String(row.receivedAt ?? ""),
    plan: row.planId ? {
      status: String(row.planStatus ?? ""),
      actionCeiling: String(row.planActionCeiling ?? "notify"),
      origin: String(row.planOrigin ?? ""),
      targetEnabled: row.planTargetEnabled === null || row.planTargetEnabled === undefined ? null : Number(row.planTargetEnabled) === 1,
      targetMaxCents: optionalCents(row.planTargetMaxCents)
    } : null,
    job: jobId ? {
      action: String(row.actionJobAction ?? ""),
      state: String(row.actionJobState ?? ""),
      firstState: String(row.actionJobFirstState ?? ""),
      reasonCode: String(row.actionJobReasonCode ?? ""),
      notificationState: String(row.actionJobNotificationState ?? ""),
      notificationFailureCode: String(row.actionJobNotificationFailureCode ?? ""),
      userReportOutcome: String(row.actionJobUserReportOutcome ?? ""),
      quantity: Number(row.actionJobQuantity) >= 1 ? Number(row.actionJobQuantity) : 1,
      addedQuantity: optionalCents(row.actionJobAddedQuantity),
      storeLimit: optionalCents(row.actionJobStoreLimit),
      quantityRaiseReason: String(row.actionJobQuantityRaiseReason ?? ""),
      cartQuantityBefore: optionalCents(row.actionJobCartQuantityBefore)
    } : null,
    signedInState: String(row.signedInState ?? "unknown"),
    source: String(row.source ?? ""),
    discordNotification: String(row.parserVersion ?? "") === "discord-notification-v1",
    sourceTrustLevel: String(row.sourceTrustLevel ?? ""),
    traceExplanation: String(row.parserVersion ?? "") === "discord-notification-v1" ? String(row.evidenceBody ?? "") : "",
    discordKind: String(row.discordKind ?? ""),
    discordDropAt: String(row.discordDropAt ?? ""),
    discordDropUntil: String(row.discordDropUntil ?? "")
  };
}

export function describeCallRow(row: Record<string, unknown>): CallResult {
  return describeCallResult(callResultInputFromRow(row));
}
