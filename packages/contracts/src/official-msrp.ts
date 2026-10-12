/** The four bounded cart lanes in the Trackalacker workflow. */
export const MSRP_GUARDED_RETAILERS: readonly string[] = Object.freeze(["amazon", "target", "walmart", "bestbuy"]);
export const OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS = 120_000;
/**
 * How many of one item a single cart add at these stores may ask for (Kevin,
 * 2026-10-10: a quantity per wanted item). Chrome reads the store's own
 * per-order limit on the page and adds that many instead when it is lower.
 */
export const GUARDED_CART_MAX_QUANTITY = 10;

/** A cart quantity these stores' runners accept: a whole number from 1 to the maximum. */
export function guardedCartQuantity(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= GUARDED_CART_MAX_QUANTITY;
}

/**
 * Retry when sold out (Kevin, 2026-10-09): items sold out at the first try
 * often come back as other shoppers' carts expire. With the shopper's retry
 * switch on, a cart add that found the item out of stock is tried again from
 * the same call, up to their number of tries within their window. Every try
 * re-checks the exact item, seller, price and stock on the live page; the
 * call itself only has to be fresh for the first try. The window never runs
 * longer than this after the call.
 */
export const RESTOCK_RETRY_MAX_WINDOW_MS = 70 * 60_000;
/**
 * Results that mean "not available from the store itself right now". When the
 * store's own stock runs out, its page often shows a marketplace seller instead
 * (Kevin, 2026-10-09), so a seller result is retried too: every try still
 * requires the store as the seller, so another seller is never added. A price
 * above the limit, a variant change, a sign-in or an uncertain click is not.
 */
export const RESTOCK_RETRY_REASONS: readonly string[] = Object.freeze([
  "out_of_stock", "stock_unverified", "add_control_unavailable", "price_unavailable",
  "third_party_seller", "seller_unverified", "signal_seller_mismatch", "no_featured_offer"
]);

/** A retry may rely on its call while the retry window is open and started from that call. */
export function restockRetryAuthorizes(signalObservedAt: string, retryUntil: string | undefined, now: number): boolean {
  const observed = Date.parse(String(signalObservedAt || ""));
  const until = Date.parse(String(retryUntil || ""));
  return Number.isFinite(observed) && Number.isFinite(until) && observed <= now && now <= until
    && until - observed <= RESTOCK_RETRY_MAX_WINDOW_MS;
}

/** Server-issued snapshot, never accepted as authority from an alert or shopper. */
export interface OfficialMsrpAuthorization {
  version: 1;
  evidenceId: string;
  evidenceHash: string;
  listingIdentityHash: string;
  retailerId: string;
  retailerSku: string;
  desiredVariant: string;
  variantAttributes: Record<string, string>;
  msrpCents: number;
  unitPriceCents: number;
  currency: "USD";
  signalObservedAt: string;
  expiresAt: string;
}
