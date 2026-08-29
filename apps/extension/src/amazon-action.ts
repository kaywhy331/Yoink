import {
  verifyLiveOffer,
  verifySingleJobCart,
  type BrowserActionContract,
  type CartProof,
  type LiveOfferProof
} from "../../../packages/browser-safety/src/index.js";
import {
  amazonAddBinding,
  amazonInteractiveBlock,
  amazonPageKind,
  amazonSecurityChallenge,
  observeAmazonCart,
  observeAmazonOffer
} from "../../../packages/browser-adapters/src/amazon.js";
import { AMAZON_ADD_ADAPTER_VERSION } from "../../../packages/contracts/src/index.js";

export interface AmazonAddJob extends BrowserActionContract {
  adapterVersion: typeof AMAZON_ADD_ADAPTER_VERSION;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  offerListingId: string;
  proof: LiveOfferProof;
}

export type AmazonAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type AmazonAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type AmazonAddCommit =
  | { ok: true; reason: "clicked"; clicked: true; proof: LiveOfferProof }
  | { ok: false; reason: string; clicked: false };

const AUTHORIZATION_MAX_AGE_MS = 10_000;
let sequence = 0;
let pending: PendingAuthorization | null = null;

function amazonJobReason(job: AmazonAddJob): string {
  if (job?.adapterVersion !== AMAZON_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "amazon" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `amazon_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonAmazonAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareAmazonAdd(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  now = Date.now()
): AmazonAddPreparation {
  pending = null;
  const invalid = amazonJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeAmazonOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString()
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return verified;
  const binding = amazonAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment);
  if (!binding?.offerListingId) return { ok: false, reason: "offer_id_missing_or_ambiguous" };
  const id = authorizationId(now);
  pending = {
    id,
    jobId: job.jobId,
    createdAt: now,
    control: binding.control,
    offerListingId: binding.offerListingId,
    proof: verified.proof
  };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseAmazonAdd(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  now = Date.now()
): AmazonAddRehearsal {
  const prepared = prepareAmazonAdd(documentValue, urlValue, job, now);
  if (!prepared.ok) return prepared;
  abandonAmazonAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitAmazonAdd(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  value: string,
  now = Date.now()
): AmazonAddCommit {
  const authorization = pending;
  pending = null;
  if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
    return { ok: false, reason: "authorization_missing", clicked: false };
  }
  if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
    return { ok: false, reason: "authorization_expired", clicked: false };
  }
  const invalid = amazonJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const observation = observeAmazonOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString()
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ...verified, clicked: false };
  const binding = amazonAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment);
  if (!binding || binding.control !== authorization.control) {
    return { ok: false, reason: "add_control_changed", clicked: false };
  }
  if (binding.offerListingId !== authorization.offerListingId) {
    return { ok: false, reason: "offer_binding_changed", clicked: false };
  }
  try {
    (binding.control as HTMLElement).click();
    return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
  } catch {
    return { ok: false, reason: "click_failed", clicked: false };
  }
}

function amazonCartUrl(value: string): boolean {
  return amazonPageKind(value) === "cart";
}

export function inspectAmazonEmptyCart(documentValue: Document, urlValue: string): { ok: boolean; reason: string } {
  if (!amazonCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (amazonSecurityChallenge(documentValue) || amazonInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const cart = observeAmazonCart(documentValue);
  if (!cart.complete || !cart.independentlyCounted) return { ok: false, reason: "cart_unverified" };
  return cart.lines.length === 0
    ? { ok: true, reason: "verified_empty" }
    : { ok: false, reason: "foreign_cart_line" };
}

export function verifyAmazonAddedCart(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  proof: LiveOfferProof,
  now = Date.now()
): { ok: true; reason: "verified"; proof: CartProof } | { ok: false; reason: string } {
  if (!amazonCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (amazonSecurityChallenge(documentValue) || amazonInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  return verifySingleJobCart(job, observeAmazonCart(documentValue, new Date(now).toISOString()), proof, now);
}

Object.defineProperty(globalThis, "YoinkAmazonAction", {
  value: Object.freeze({
    abandonAmazonAdd,
    commitAmazonAdd,
    inspectAmazonEmptyCart,
    prepareAmazonAdd,
    rehearseAmazonAdd,
    verifyAmazonAddedCart
  }),
  configurable: true
});
