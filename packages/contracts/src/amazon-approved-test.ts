/** Kevin's single, explicitly approved cart-only TEST. Not a general test mode. */
export const AMAZON_APPROVED_TEST = Object.freeze({
  id: "amazon_test_20261002_B0D9ZTW7PS",
  approvalId: "owner_approved_amazon_cart_test_20261002",
  deviceId: "device_4ff8c709625244a89427e8c170d6baa7",
  retailerId: "amazon", retailerSku: "B0D9ZTW7PS",
  canonicalUrl: "https://www.amazon.com/dp/B0D9ZTW7PS",
  title: 'Schylling NeeDoh Nice Ice Baby - 1.25" Cube - Color May Vary (Pack of 1)',
  desiredVariant: "1.25-inch single cube; pack of 1; color may vary",
  unitPriceCents: 699, quantity: 1, seller: "Amazon.com", shipper: "Amazon.com",
  sourceEventId: "signal_event_6b16d83b73f04df8a34bd0c7c0a722a3",
  sourceObservedAt: "2026-10-02T14:34:12.075Z",
  approvalExpiresAt: "2026-10-03T00:00:00.000Z",
  maxDurationMs: 300_000
} as const);

export interface AmazonApprovedTestAuthorization {
  version: 1; approvalId: typeof AMAZON_APPROVED_TEST.approvalId;
  jobId: typeof AMAZON_APPROVED_TEST.id; deviceId: typeof AMAZON_APPROVED_TEST.deviceId;
  desiredVariant: typeof AMAZON_APPROVED_TEST.desiredVariant;
  sourceEventId: typeof AMAZON_APPROVED_TEST.sourceEventId;
  sourceObservedAt: typeof AMAZON_APPROVED_TEST.sourceObservedAt;
  exceptions: readonly ["owner_approved_TEST_above_MSRP", "owner_approved_TEST_stale_signal"];
  issuedAt: string; expiresAt: string;
  noOrderAuthorization: true;
}

/** Shared server/runner validation. Unknown fields cannot widen this fixed grant. */
export function amazonApprovedTestReason(job: {
  approvedTest?: AmazonApprovedTestAuthorization; officialMsrp?: unknown;
  jobId: string; retailerId: string; retailerSku: string; canonicalUrl: string;
  action: string; quantity: number; maxUnitPriceCents: number; maxOrderTotalCents: number;
  currency: string; sellerPolicy: string; expectedSeller: string; fulfillment: string; expiresAt: string;
}, now: number): string {
  const a=job.approvedTest,s=AMAZON_APPROVED_TEST;
  if(!a)return "approved_amazon_test_missing";
  const issued=Date.parse(a.issuedAt),end=Date.parse(a.expiresAt);
  return a.version===1 && a.approvalId===s.approvalId && a.jobId===s.id && job.jobId===s.id
    && a.deviceId===s.deviceId && a.desiredVariant===s.desiredVariant
    && a.sourceEventId===s.sourceEventId && a.sourceObservedAt===s.sourceObservedAt
    && JSON.stringify(a.exceptions)===JSON.stringify(["owner_approved_TEST_above_MSRP","owner_approved_TEST_stale_signal"])
    && a.noOrderAuthorization===true && !job.officialMsrp
    && Number.isFinite(issued) && issued<=now && issued>=Date.parse(s.sourceObservedAt)
    && Number.isFinite(end) && end>now && end-issued<=s.maxDurationMs
    && end<=Date.parse(s.approvalExpiresAt) && job.expiresAt===a.expiresAt
    && job.retailerId===s.retailerId && job.retailerSku===s.retailerSku && job.canonicalUrl===s.canonicalUrl
    && job.action==="add_to_cart" && job.quantity===1 && job.maxUnitPriceCents===s.unitPriceCents
    && job.maxOrderTotalCents===s.unitPriceCents && job.currency==="USD"
    && job.sellerPolicy==="first_party_only" && job.expectedSeller===s.seller && job.fulfillment==="shipping"
    ? "" : "approved_amazon_test_invalid";
}
