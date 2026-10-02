import type { BrowserActionContract } from "../../packages/browser-safety/src/index.js";

/** Synthetic authorization for isolated runner tests, never retailer MSRP evidence. */
export function reviewedBrowserJobFixture<T extends BrowserActionContract>(job: T, now: number): T {
  return { ...job, officialMsrp: {
    version: 1, evidenceId: `official_msrp_${"a".repeat(32)}`, evidenceHash: "b".repeat(64),
    listingIdentityHash: "c".repeat(64), retailerId: job.retailerId, retailerSku: job.retailerSku,
    desiredVariant: "Standard single item", variantAttributes: {}, msrpCents: job.maxUnitPriceCents,
    unitPriceCents: job.maxUnitPriceCents, currency: "USD", signalObservedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString()
  } };
}
