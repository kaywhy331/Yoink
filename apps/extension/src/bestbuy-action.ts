import {
  verifyLiveOffer,
  verifySingleJobCart,
  type BrowserActionContract,
  type CartProof,
  type LiveOfferProof
} from "../../../packages/browser-safety/src/index.js";
import {
  bestBuyAddControl,
  bestBuyInteractiveBlock,
  bestBuyPageKind,
  bestBuySecurityChallenge,
  observeBestBuyCart,
  observeBestBuyOffer
} from "../../../packages/browser-adapters/src/bestbuy.js";
import { BESTBUY_ADD_ADAPTER_VERSION } from "../../../packages/contracts/src/index.js";

export interface BestBuyAddJob extends BrowserActionContract {
  adapterVersion: typeof BESTBUY_ADD_ADAPTER_VERSION;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  proof: LiveOfferProof;
}

export type BestBuyAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type BestBuyAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type BestBuyAddCommit =
  | { ok: true; reason: "clicked"; clicked: true; proof: LiveOfferProof }
  | { ok: false; reason: string; clicked: false };

const AUTHORIZATION_MAX_AGE_MS = 10_000;
let sequence = 0;
let pending: PendingAuthorization | null = null;

function bestBuyJobReason(job: BestBuyAddJob): string {
  if (job?.adapterVersion !== BESTBUY_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "bestbuy" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `bestbuy_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonBestBuyAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareBestBuyAdd(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  now = Date.now()
): BestBuyAddPreparation {
  pending = null;
  const invalid = bestBuyJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeBestBuyOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString()
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return verified;
  const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment);
  if (!control) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseBestBuyAdd(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  now = Date.now()
): BestBuyAddRehearsal {
  const prepared = prepareBestBuyAdd(documentValue, urlValue, job, now);
  if (!prepared.ok) return prepared;
  abandonBestBuyAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitBestBuyAdd(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  value: string,
  now = Date.now()
): BestBuyAddCommit {
  const authorization = pending;
  pending = null;
  if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
    return { ok: false, reason: "authorization_missing", clicked: false };
  }
  if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
    return { ok: false, reason: "authorization_expired", clicked: false };
  }
  const invalid = bestBuyJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const observation = observeBestBuyOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString()
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ...verified, clicked: false };
  const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment);
  if (!control || control !== authorization.control) return { ok: false, reason: "add_control_changed", clicked: false };
  try {
    (control as HTMLElement).click();
    return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
  } catch {
    return { ok: false, reason: "click_failed", clicked: false };
  }
}

function bestBuyCartUrl(value: string): boolean {
  return bestBuyPageKind(value) === "cart";
}

export function inspectBestBuyEmptyCart(documentValue: Document, urlValue: string): { ok: boolean; reason: string } {
  if (!bestBuyCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (bestBuySecurityChallenge(documentValue) || bestBuyInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const cart = observeBestBuyCart(documentValue);
  if (!cart.complete || !cart.independentlyCounted) return { ok: false, reason: "cart_unverified" };
  return cart.lines.length === 0
    ? { ok: true, reason: "verified_empty" }
    : { ok: false, reason: "foreign_cart_line" };
}

export function verifyBestBuyAddedCart(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  proof: LiveOfferProof,
  now = Date.now()
): { ok: true; reason: "verified"; proof: CartProof } | { ok: false; reason: string } {
  if (!bestBuyCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (bestBuySecurityChallenge(documentValue) || bestBuyInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  return verifySingleJobCart(job, observeBestBuyCart(documentValue, new Date(now).toISOString()), proof, now);
}

Object.defineProperty(globalThis, "YoinkBestBuyAction", {
  value: Object.freeze({
    abandonBestBuyAdd,
    commitBestBuyAdd,
    inspectBestBuyEmptyCart,
    prepareBestBuyAdd,
    rehearseBestBuyAdd,
    verifyBestBuyAddedCart
  }),
  configurable: true
});
