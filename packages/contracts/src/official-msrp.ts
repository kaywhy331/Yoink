/** The four bounded cart lanes in the Trackalacker workflow. */
export const MSRP_GUARDED_RETAILERS: readonly string[] = Object.freeze(["amazon", "target", "walmart", "bestbuy"]);
export const OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS = 120_000;

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
