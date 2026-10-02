import { ADD_LANES } from "../../contracts/src/add-lanes.js";
import { canonicalRetailerUrl } from "./attribution.js";
import { sellerTypeForName } from "./catalog.js";

/** Offline, read-only evidence review. A pass is NEVER an Add authorization.
 * Product evidence must be independently reviewed by the operator; neither a
 * source alert nor a request body may promote itself into official evidence.
 */
export interface DropCartReviewInput {
  selection: {
    retailerId: string; retailerSku: string; canonicalUrl: string;
    variant: string; quantity: number; fulfillment: string;
    reviewedUnitPriceCents: number; action: string;
  };
  signal: {
    id: string; source: string; sourceUrl: string; trust: string; test: boolean;
    retailerId: string; retailerSku: string; variant: string;
    observedAt: string; receivedAt: string; unitPriceCents: number | null; currency: string;
  };
  productEvidence: {
    retailerId: string; retailerSku: string; canonicalUrl: string; variant: string;
    title: string; classification: string; restricted: boolean; ageGated: boolean; moneyProduct: boolean;
    reviewedAt: string;
    msrp: null | {
      kind: string; amountCents: number; currency: string; sourceUrl: string;
      publisherHost: string; reviewedAt: string; exactVariantVerified: boolean;
    };
  };
  observation: {
    retailerId: string; retailerSku: string; canonicalUrl: string; variant: string;
    unitPriceCents: number | null; currency: string; observedAt: string;
    sellerName: string; fulfillment: string; availability: string;
    quantity: number; gate: string; adapterVersion: string;
    shippingCents: number | null; taxCents: number | null; feesCents: number | null;
    baselineComplete: boolean; unresolvedMutation: boolean; sameBrowserSession: boolean;
  };
}

const STORES = new Set(["amazon", "target", "walmart", "bestbuy"]);
const MAX_SIGNAL_MS = 120_000;
const MAX_PAGE_MS = 30_000;
const MAX_PRODUCT_REVIEW_MS = 24 * 60 * 60_000;
const MAX_MSRP_REVIEW_MS = 30 * 24 * 60 * 60_000;

function fresh(value: unknown, ttl: number, now: number): boolean {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now && now - time <= ttl;
}

function cents(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 100_000_000;
}

function publicUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function reviewDropCart(input: unknown, now = Date.now()) {
  const blockers: string[] = [];
  const block = (condition: boolean, reason: string) => { if (condition) blockers.push(reason); };
  const result = (details: Record<string, unknown> = {}) => ({
    status: blockers.length ? "needs_review" : "ready_for_no_click_rehearsal",
    noCartAuthorization: true,
    realCartVerified: false,
    blockers,
    ...details
  });
  if (!Number.isFinite(now) || !record(input)
    || !record(input.selection) || !record(input.signal)
    || !record(input.productEvidence) || !record(input.observation)) {
    blockers.push("invalid_review_input");
    return result();
  }
  const { selection: selected, signal, productEvidence: evidence, observation: page } = input;
  if (typeof selected.retailerId !== "string" || !STORES.has(selected.retailerId)) {
    blockers.push("retailer_not_supported");
    return result();
  }
  const retailer = selected.retailerId as "amazon" | "target" | "walmart" | "bestbuy";
  const lane = ADD_LANES[retailer];
  const sku = typeof selected.retailerSku === "string" ? selected.retailerSku : "";
  const canonical = publicUrl(selected.canonicalUrl);
  const canonicalUrl = canonical ? canonicalRetailerUrl(canonical.href, retailer, sku) : "";
  block(!new RegExp(lane.skuPattern).test(sku) || !canonicalUrl, "retailer_identity_unverified");
  block(typeof selected.variant !== "string" || !selected.variant.trim() || selected.variant.length > 160,
    "desired_variant_required");
  block(selected.quantity !== 1 || page.quantity !== 1, "quantity_must_be_one");
  block(selected.action !== "add_to_cart", "cart_only_action_required");
  // This bounded review starts with shipping; pickup needs independently bound location evidence.
  block(selected.fulfillment !== "shipping" || page.fulfillment !== "shipping", "shipping_not_verified");
  for (const [name, item] of [["signal", signal], ["product", evidence], ["page", page]] as const) {
    block(item.retailerId !== retailer || item.retailerSku !== sku || item.variant !== selected.variant,
      `${name}_identity_changed`);
  }
  for (const [name, item] of [["product", evidence], ["page", page]] as const) {
    const url = publicUrl(item.canonicalUrl);
    block(!url || !canonicalUrl || canonicalRetailerUrl(url.href, retailer, sku) !== canonicalUrl,
      `${name}_url_unverified`);
  }
  const sourceUrl = publicUrl(signal.sourceUrl);
  block(signal.source !== "trackalacker" || signal.trust !== "trusted_exact"
    || typeof signal.id !== "string" || !signal.id.trim()
    || !sourceUrl || !["trackalacker.com", "www.trackalacker.com"].includes(sourceUrl.hostname)
    || !/^\/(?:listings\/\d+(?:\/[^/]+)?|products\/showcase\/[^/]+)\/?$/.test(sourceUrl.pathname),
  "trusted_trackalacker_signal_required");
  block(signal.test !== false, "fixture_signal_not_live");
  block(!fresh(signal.observedAt, MAX_SIGNAL_MS, now) || !fresh(signal.receivedAt, MAX_SIGNAL_MS, now), "signal_stale");
  block(!fresh(page.observedAt, MAX_PAGE_MS, now), "page_price_stale");
  block(!fresh(evidence.reviewedAt, MAX_PRODUCT_REVIEW_MS, now), "product_review_stale");
  block(evidence.classification !== "ordinary_goods" || evidence.restricted !== false
    || evidence.ageGated !== false || evidence.moneyProduct !== false,
  "product_eligibility_unverified");
  block(typeof evidence.title !== "string" || !evidence.title.trim()
    || /\b(?:gift\s*card|prepaid|stored[- ]value|lottery|tobacco|nicotine|vape|ammunition|firearm|alcohol|cannabis)\b/i.test(String(evidence.title)),
  "product_restricted_or_unclassified");
  const msrp = record(evidence.msrp) ? evidence.msrp : null;
  const officialUrl = publicUrl(msrp?.sourceUrl);
  // The publisher host and exact-product attestation come from independent
  // reviewed evidence, never from Trackalacker, a strike-through or a sale label.
  block(!msrp || msrp.kind !== "manufacturer_msrp" || !cents(msrp.amountCents)
    || msrp.currency !== "USD" || msrp.exactVariantVerified !== true
    || !officialUrl || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(String(msrp.publisherHost))
    || officialUrl.hostname !== msrp.publisherHost
    || ["trackalacker.com", "www.trackalacker.com", "amazon.com", "www.amazon.com", "target.com", "www.target.com",
      "walmart.com", "www.walmart.com", "bestbuy.com", "www.bestbuy.com"].includes(officialUrl?.hostname ?? "")
    || !fresh(msrp.reviewedAt, MAX_MSRP_REVIEW_MS, now), "official_msrp_unverified");
  block(signal.currency !== "USD" || page.currency !== "USD", "currency_not_supported");
  block(!cents(selected.reviewedUnitPriceCents) || !cents(signal.unitPriceCents) || !cents(page.unitPriceCents), "listed_price_unknown");
  block(signal.unitPriceCents !== selected.reviewedUnitPriceCents || page.unitPriceCents !== selected.reviewedUnitPriceCents,
    "listed_price_changed");
  block(cents(page.unitPriceCents) && !!msrp && cents(msrp.amountCents) && page.unitPriceCents > msrp.amountCents,
    "listed_price_above_msrp");
  block(sellerTypeForName(retailer, page.sellerName) !== "first_party", "first_party_seller_unverified");
  block(page.availability !== "in_stock", "stock_unverified");
  block(page.gate !== "none", "manual_store_step_required");
  block(page.adapterVersion !== lane.contractVersion, "adapter_version_mismatch");
  block(page.baselineComplete !== true || page.sameBrowserSession !== true, "cart_baseline_unverified");
  block(page.unresolvedMutation !== false, "previous_cart_mutation_unresolved");
  for (const name of ["shippingCents", "taxCents", "feesCents"] as const) {
    const value = page[name];
    block(value !== null && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000),
      `${name}_invalid`);
  }
  return result({
    retailerId: retailer, retailerSku: sku, variant: selected.variant,
    costs: { listedUnitPriceCents: page.unitPriceCents, msrpCents: msrp?.amountCents ?? null,
      shippingCents: page.shippingCents, taxCents: page.taxCents, feesCents: page.feesCents,
      allInTotalCents: null, currency: "USD" },
    // Deliberately not a purchase-intent API payload or a reusable authorization.
    rehearsal: blockers.length ? null : { canonicalUrl, quantity: 1, fulfillment: "shipping",
      desiredVariant: selected.variant, maxUnitPriceCents: selected.reviewedUnitPriceCents,
      sellerPolicy: "first_party_only", substitutionPolicy: "exact_only", adapterVersion: lane.contractVersion,
      nextStep: "Run the installed companion's existing no-click rehearsal in the same browser session." }
  });
}
