import {
  captureCartBaseline,
  verifyCartAddDelta,
  verifyLiveOffer,
  type BrowserActionContract,
  type CartBaselineProof,
  type CartProof,
  type LiveOfferProof
} from "../../../packages/browser-safety/src/index.js";
import {
  observeWalmartCart,
  observeWalmartOffer,
  walmartAddControl,
  walmartInteractiveBlock,
  walmartPageKind,
  walmartSecurityChallenge
} from "../../../packages/browser-adapters/src/walmart.js";
import { WALMART_ADD_ADAPTER_VERSION } from "../../../packages/contracts/src/index.js";

export interface WalmartAddJob extends BrowserActionContract {
  adapterVersion: typeof WALMART_ADD_ADAPTER_VERSION;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  proof: LiveOfferProof;
}

export type WalmartAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type WalmartAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type WalmartAddCommit =
  | { ok: true; reason: "clicked"; clicked: true; proof: LiveOfferProof }
  | { ok: false; reason: string; clicked: false };

const AUTHORIZATION_MAX_AGE_MS = 10_000;
let sequence = 0;
let pending: PendingAuthorization | null = null;

function walmartJobReason(job: WalmartAddJob): string {
  if (job?.adapterVersion !== WALMART_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "walmart" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `walmart_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonWalmartAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareWalmartAdd(
  documentValue: Document,
  urlValue: string,
  job: WalmartAddJob,
  now = Date.now()
): WalmartAddPreparation {
  pending = null;
  const invalid = walmartJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeWalmartOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString()
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return verified;
  const control = walmartAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment);
  if (!control) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseWalmartAdd(
  documentValue: Document,
  urlValue: string,
  job: WalmartAddJob,
  now = Date.now()
): WalmartAddRehearsal {
  const prepared = prepareWalmartAdd(documentValue, urlValue, job, now);
  if (!prepared.ok) return prepared;
  abandonWalmartAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitWalmartAdd(
  documentValue: Document,
  urlValue: string,
  job: WalmartAddJob,
  value: string,
  now = Date.now()
): WalmartAddCommit {
  const authorization = pending;
  pending = null;
  if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
    return { ok: false, reason: "authorization_missing", clicked: false };
  }
  if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
    return { ok: false, reason: "authorization_expired", clicked: false };
  }
  const invalid = walmartJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const observation = observeWalmartOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString()
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ...verified, clicked: false };
  const control = walmartAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment);
  if (!control || control !== authorization.control) return { ok: false, reason: "add_control_changed", clicked: false };
  try {
    (control as HTMLElement).click();
    return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
  } catch {
    return { ok: false, reason: "click_failed", clicked: false };
  }
}

function walmartCartUrl(value: string): boolean {
  return walmartPageKind(value) === "cart";
}

export function inspectWalmartCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now()
) {
  if (!walmartCartUrl(urlValue)) return { ok: false as const, reason: "cart_page_unverified" };
  if (walmartSecurityChallenge(documentValue) || walmartInteractiveBlock(documentValue, urlValue)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "walmart",
    observeWalmartCart(documentValue, new Date(now).toISOString()),
    now
  );
}

export function verifyWalmartAddedCart(
  documentValue: Document,
  urlValue: string,
  job: WalmartAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now()
): { ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string } {
  if (!walmartCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (walmartSecurityChallenge(documentValue) || walmartInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const inventory = observeWalmartCart(documentValue, new Date(now).toISOString());
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("walmart", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkWalmartAction", {
  value: Object.freeze({
    abandonWalmartAdd,
    commitWalmartAdd,
    inspectWalmartCartBaseline,
    prepareWalmartAdd,
    rehearseWalmartAdd,
    verifyWalmartAddedCart
  }),
  configurable: true
});
