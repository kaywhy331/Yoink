import type { Action, Availability, Fulfillment, SellerPolicy, SellerType } from "../../contracts/src/index.js";

export const BROWSER_SAFETY_CONTRACT_VERSION = 1;
export const LIVE_OFFER_MAX_AGE_MS = 30_000;
export const CART_PROOF_MAX_AGE_MS = 5 * 60_000;
export const CHECKOUT_EVIDENCE_MAX_AGE_MS = 2 * 60_000;

const RETAILER_DOMAINS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  target: ["target.com"],
  walmart: ["walmart.com"],
  amazon: ["amazon.com"],
  bestbuy: ["bestbuy.com"],
  disney: ["disneystore.com"],
  ravensburger: ["ravensburger.us"],
  riot: ["merch.riotgames.com"],
  booksamillion: ["booksamillion.com"],
  fanatics: ["fanatics.com"],
  kohls: ["kohls.com"],
  macys: ["macys.com"],
  pbandai: ["p-bandai.com"],
  pokemoncenter: ["pokemoncenter.com"]
});

export interface BrowserActionContract {
  contractVersion: typeof BROWSER_SAFETY_CONTRACT_VERSION;
  jobId: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  action: Action;
  quantity: number;
  maxUnitPriceCents: number;
  maxOrderTotalCents: number;
  currency: string;
  sellerPolicy: SellerPolicy;
  expectedSeller: string;
  fulfillment: Fulfillment;
  expiresAt: string;
  checkoutTrust?: CheckoutTrust;
}

export interface LiveOfferObservation {
  contractVersion: typeof BROWSER_SAFETY_CONTRACT_VERSION;
  observedAt: string;
  url: string;
  pageKind: "product" | "cart" | "checkout" | "confirmation" | "auth" | "queue" | "other";
  retailerId: string;
  retailerSku: string;
  availability: Availability;
  unitPriceCents: number | null;
  currency: string;
  sellerName: string;
  sellerType: SellerType;
  fulfillment: Fulfillment;
  addControlActionable: boolean;
  securityChallenge: boolean;
  interactiveBlock: "" | "auth" | "mfa" | "location" | "membership" | "queue" | "high_demand" | "unknown";
}

export interface LiveOfferProof {
  contractVersion: typeof BROWSER_SAFETY_CONTRACT_VERSION;
  jobId: string;
  retailerId: string;
  retailerSku: string;
  observedAt: string;
  unitPriceCents: number;
  currency: string;
  sellerName: string;
  sellerType: Exclude<SellerType, "unknown">;
  fulfillment: "shipping" | "pickup";
}

export interface CartLineEvidence {
  retailerSku: string;
  quantity: number | null;
  unitPriceCents: number | null;
  sellerName: string;
  sellerType: SellerType;
}

export interface CartInventoryEvidence {
  contractVersion: typeof BROWSER_SAFETY_CONTRACT_VERSION;
  observedAt: string;
  complete: boolean;
  independentlyCounted: boolean;
  independentLineCount: number;
  lines: CartLineEvidence[];
}

export interface CartProof {
  contractVersion: typeof BROWSER_SAFETY_CONTRACT_VERSION;
  jobId: string;
  retailerId: string;
  retailerSku: string;
  observedAt: string;
  quantity: number;
  unitPriceCents: number;
  sellerName: string;
  sellerType: Exclude<SellerType, "unknown">;
}

export interface CheckoutTrust {
  destinationFingerprint: string;
  pickupStoreFingerprint: string;
  paymentInstrumentSetFingerprint: string;
  paymentInstrumentCount: number;
}

export interface CheckoutEvidence {
  contractVersion: typeof BROWSER_SAFETY_CONTRACT_VERSION;
  source: "visible-checkout-dom";
  observedAt: string;
  retailerId: string;
  retailerSku: string;
  fulfillment: "shipping" | "pickup" | "unknown";
  destinationFingerprint: string;
  pickupStoreFingerprint: string;
  paymentInstrumentSetFingerprint: string;
  paymentInstrumentCount: number;
  substitutions: "disabled" | "not-applicable" | "enabled" | "unknown";
  substitutionSku: string;
  cartComplete: boolean;
  cartIndependentlyCounted: boolean;
  cartLineCount: number;
  cartSku: string;
  cartQuantity: number;
  orderTotalCents: number | null;
  unsafeChoices: string[];
  submitControlActionable: boolean;
}

export type VerificationResult<T> =
  | { ok: true; reason: "verified"; proof: T }
  | { ok: false; reason: string };

function rejected<T>(reason: string): VerificationResult<T> {
  return { ok: false, reason };
}

function timestampAge(value: string, now: number): number | null {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp > now + 5_000) return null;
  return now - timestamp;
}

function cleanSeller(value: string): string {
  return String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function sellerIdentity(value: string): string {
  return cleanSeller(value)
    .toLocaleLowerCase("en-US")
    .replace(/^(?:sold\s+(?:and\s+shipped\s+)?by|seller\s*:?|merchant\s*:?)\s*/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function retailerUrlAllowed(retailerId: string, value: string): boolean {
  const domains = RETAILER_DOMAINS[retailerId] ?? [];
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    return url.protocol === "https:" && !url.username && !url.password
      && domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function sellerAllowed(job: BrowserActionContract, sellerName: string, sellerType: SellerType): string {
  const seller = cleanSeller(sellerName);
  if (sellerType === "unknown") return "seller_unverified";
  if (job.sellerPolicy === "first_party_only" && sellerType !== "first_party") return "third_party_seller";
  if (sellerType === "third_party") {
    if (!seller) return "seller_unverified";
    const expected = sellerIdentity(job.expectedSeller);
    if (expected && sellerIdentity(seller) !== expected) return "signal_seller_mismatch";
  }
  return "";
}

function fulfillmentAllowed(required: Fulfillment, observed: Fulfillment): observed is "shipping" | "pickup" {
  if (!(["shipping", "pickup"] as Fulfillment[]).includes(observed)) return false;
  return required === "either" || required === observed;
}

function validJob(job: BrowserActionContract, now: number): string {
  if (job.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return "contract_version_mismatch";
  if (!job.jobId || !job.retailerId || !job.retailerSku) return "job_identity_invalid";
  if (!retailerUrlAllowed(job.retailerId, job.canonicalUrl)) return "canonical_url_invalid";
  if (!Number.isInteger(job.quantity) || job.quantity < 1 || job.quantity > 99) return "quantity_invalid";
  if (!Number.isSafeInteger(job.maxUnitPriceCents) || job.maxUnitPriceCents <= 0) return "unit_cap_invalid";
  if (!Number.isSafeInteger(job.maxOrderTotalCents) || job.maxOrderTotalCents <= 0) return "total_cap_invalid";
  const expiresAt = new Date(job.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return "job_expired";
  return "";
}

export function verifyLiveOffer(job: BrowserActionContract, observation: LiveOfferObservation, now = Date.now()): VerificationResult<LiveOfferProof> {
  const invalidJob = validJob(job, now);
  if (invalidJob) return rejected(invalidJob);
  if (observation.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return rejected("contract_version_mismatch");
  const age = timestampAge(observation.observedAt, now);
  if (age === null || age > LIVE_OFFER_MAX_AGE_MS) return rejected("offer_stale");
  if (observation.retailerId !== job.retailerId || observation.retailerSku !== job.retailerSku) return rejected("listing_mismatch");
  if (!retailerUrlAllowed(job.retailerId, observation.url) || observation.pageKind !== "product") return rejected("product_page_unverified");
  if (observation.securityChallenge || observation.interactiveBlock) return rejected("manual_action_required");
  if (!["in_stock", "preorder"].includes(observation.availability)) return rejected("out_of_stock");
  if (!observation.addControlActionable) return rejected("add_control_unavailable");
  if (observation.currency !== job.currency) return rejected("currency_mismatch");
  const sellerReason = sellerAllowed(job, observation.sellerName, observation.sellerType);
  if (sellerReason) return rejected(sellerReason);
  if (!Number.isSafeInteger(observation.unitPriceCents) || Number(observation.unitPriceCents) <= 0) return rejected("price_unavailable");
  if (Number(observation.unitPriceCents) > job.maxUnitPriceCents) return rejected("over_unit_cap");
  if (!fulfillmentAllowed(job.fulfillment, observation.fulfillment)) return rejected("fulfillment_unverified");
  return {
    ok: true,
    reason: "verified",
    proof: {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      jobId: job.jobId,
      retailerId: job.retailerId,
      retailerSku: job.retailerSku,
      observedAt: observation.observedAt,
      unitPriceCents: Number(observation.unitPriceCents),
      currency: observation.currency,
      sellerName: cleanSeller(observation.sellerName),
      sellerType: observation.sellerType as Exclude<SellerType, "unknown">,
      fulfillment: observation.fulfillment as "shipping" | "pickup"
    }
  };
}

export function verifySingleJobCart(
  job: BrowserActionContract,
  inventory: CartInventoryEvidence,
  offerProof: LiveOfferProof,
  now = Date.now()
): VerificationResult<CartProof> {
  const invalidJob = validJob(job, now);
  if (invalidJob) return rejected(invalidJob);
  if (inventory.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return rejected("contract_version_mismatch");
  const cartAge = timestampAge(inventory.observedAt, now);
  const offerAge = timestampAge(offerProof.observedAt, now);
  if (cartAge === null || cartAge > LIVE_OFFER_MAX_AGE_MS || offerAge === null || offerAge > CART_PROOF_MAX_AGE_MS) return rejected("cart_evidence_stale");
  if (offerProof.jobId !== job.jobId || offerProof.retailerId !== job.retailerId || offerProof.retailerSku !== job.retailerSku) return rejected("offer_proof_mismatch");
  if (!inventory.complete || !inventory.independentlyCounted || inventory.independentLineCount !== inventory.lines.length) return rejected("cart_unverified");
  if (inventory.lines.length !== 1 || inventory.lines[0]?.retailerSku !== job.retailerSku) return rejected("foreign_cart_line");
  const line = inventory.lines[0];
  if (!line || line.quantity !== job.quantity) return rejected("quantity_unavailable");
  const unitPriceCents = line.unitPriceCents ?? offerProof.unitPriceCents;
  const sellerName = line.sellerName || offerProof.sellerName;
  const sellerType = line.sellerType === "unknown" ? offerProof.sellerType : line.sellerType;
  const sellerReason = sellerAllowed(job, sellerName, sellerType);
  if (sellerReason) return rejected(sellerReason);
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) return rejected("price_unavailable");
  if (unitPriceCents > job.maxUnitPriceCents) return rejected("over_unit_cap");
  return {
    ok: true,
    reason: "verified",
    proof: {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      jobId: job.jobId,
      retailerId: job.retailerId,
      retailerSku: job.retailerSku,
      observedAt: inventory.observedAt,
      quantity: job.quantity,
      unitPriceCents,
      sellerName: cleanSeller(sellerName),
      sellerType: sellerType as Exclude<SellerType, "unknown">
    }
  };
}

function fingerprint(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export function verifyCheckoutEvidence(
  job: BrowserActionContract,
  cartProof: CartProof,
  evidence: CheckoutEvidence,
  now = Date.now()
): VerificationResult<CheckoutEvidence> {
  const invalidJob = validJob(job, now);
  if (invalidJob) return rejected(invalidJob);
  if (evidence.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION || evidence.source !== "visible-checkout-dom") return rejected("checkout_contract_invalid");
  const evidenceAge = timestampAge(evidence.observedAt, now);
  const cartAge = timestampAge(cartProof.observedAt, now);
  if (evidenceAge === null || evidenceAge > CHECKOUT_EVIDENCE_MAX_AGE_MS || cartAge === null || cartAge > CART_PROOF_MAX_AGE_MS) return rejected("checkout_evidence_stale");
  if (cartProof.jobId !== job.jobId || evidence.retailerId !== job.retailerId || evidence.retailerSku !== job.retailerSku) return rejected("checkout_identity_mismatch");
  if (evidence.unsafeChoices.length) return rejected("manual_action_required");
  if (!fulfillmentAllowed(job.fulfillment, evidence.fulfillment)) return rejected("fulfillment_unverified");
  if (evidence.fulfillment === "shipping" && (!fingerprint(evidence.destinationFingerprint) || evidence.pickupStoreFingerprint)) return rejected("destination_unverified");
  if (evidence.fulfillment === "pickup" && (!fingerprint(evidence.pickupStoreFingerprint) || evidence.destinationFingerprint)) return rejected("pickup_store_unverified");
  if (!fingerprint(evidence.paymentInstrumentSetFingerprint) || !Number.isInteger(evidence.paymentInstrumentCount) || evidence.paymentInstrumentCount < 1) return rejected("payment_unverified");
  if (!["disabled", "not-applicable"].includes(evidence.substitutions) || evidence.substitutionSku !== job.retailerSku) return rejected("substitution_unverified");
  if (!evidence.cartComplete || !evidence.cartIndependentlyCounted || evidence.cartLineCount !== 1 || evidence.cartSku !== job.retailerSku || evidence.cartQuantity !== job.quantity) return rejected("cart_unverified");
  if (!Number.isSafeInteger(evidence.orderTotalCents) || Number(evidence.orderTotalCents) <= 0) return rejected("total_unavailable");
  if (Number(evidence.orderTotalCents) > job.maxOrderTotalCents) return rejected("over_total_cap");
  if (job.action === "submit_order") {
    if (!evidence.submitControlActionable) return rejected("submit_control_unavailable");
    const trust = job.checkoutTrust;
    if (!trust) return rejected("checkout_trust_required");
    if (
      trust.destinationFingerprint !== evidence.destinationFingerprint
      || trust.pickupStoreFingerprint !== evidence.pickupStoreFingerprint
      || trust.paymentInstrumentSetFingerprint !== evidence.paymentInstrumentSetFingerprint
      || trust.paymentInstrumentCount !== evidence.paymentInstrumentCount
    ) return rejected("checkout_trust_changed");
  }
  return { ok: true, reason: "verified", proof: evidence };
}
