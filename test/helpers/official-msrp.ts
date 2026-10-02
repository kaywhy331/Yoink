import { OfficialMsrpRepository, type OfficialMsrpEvidenceInput } from "../../packages/database/src/official-msrp-repository.js";
import type { YoinkDatabase } from "../../packages/database/src/database.js";

/** Synthetic manufacturer evidence for isolated tests only; never real MSRP verification. */
export function officialMsrpFixture(db: YoinkDatabase, listingId: string, now: number, cents = 2999,
  overrides: Partial<OfficialMsrpEvidenceInput> = {}) {
  return new OfficialMsrpRepository(db).record(listingId, {
    confirmation: "RECORD_OFFICIAL_MSRP_FOR_EXACT_VARIANT", sourceKind: "manufacturer_msrp",
    sourceUrl: "https://maker.example/ordinary-product", manufacturerHost: "maker.example",
    manufacturerVerified: true, exactVariantVerified: true, desiredVariant: "Standard single item",
    variantAttributes: {}, msrpCents: cents, currency: "USD", sourceCheckedAt: new Date(now).toISOString(),
    sourceExcerpt: "Synthetic fixture MSRP evidence only.", classification: "ordinary_goods", restricted: false,
    ageGated: false, moneyProduct: false, ...overrides
  }, now);
}
