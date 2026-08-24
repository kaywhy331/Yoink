import {
  verifyLiveOffer,
  verifySingleJobCart,
  type BrowserActionContract,
  type CartProof,
  type LiveOfferProof
} from "../../../packages/browser-safety/src/index.js";
import {
  observeTargetCart,
  observeTargetOffer,
  targetAddControl,
  targetInteractiveBlock,
  targetPageKind,
  targetSecurityChallenge
} from "../../../packages/browser-adapters/src/target.js";
import { TARGET_ADD_ADAPTER_VERSION } from "../../../packages/contracts/src/index.js";

export interface TargetAddJob extends BrowserActionContract {
  adapterVersion: typeof TARGET_ADD_ADAPTER_VERSION;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  proof: LiveOfferProof;
}

export type TargetAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type TargetAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type TargetAddCommit =
  | { ok: true; reason: "clicked"; clicked: true; proof: LiveOfferProof }
  | { ok: false; reason: string; clicked: false };

const AUTHORIZATION_MAX_AGE_MS = 10_000;
let sequence = 0;
let pending: PendingAuthorization | null = null;

function targetJobReason(job: TargetAddJob): string {
  if (job?.adapterVersion !== TARGET_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "target" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `target_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonTargetAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareTargetAdd(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  now = Date.now()
): TargetAddPreparation {
  pending = null;
  const invalid = targetJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeTargetOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString()
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return verified;
  const control = targetAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment);
  if (!control) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseTargetAdd(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  now = Date.now()
): TargetAddRehearsal {
  const prepared = prepareTargetAdd(documentValue, urlValue, job, now);
  if (!prepared.ok) return prepared;
  abandonTargetAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitTargetAdd(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  value: string,
  now = Date.now()
): TargetAddCommit {
  const authorization = pending;
  pending = null;
  if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
    return { ok: false, reason: "authorization_missing", clicked: false };
  }
  if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
    return { ok: false, reason: "authorization_expired", clicked: false };
  }
  const invalid = targetJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const observation = observeTargetOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString()
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ...verified, clicked: false };
  const control = targetAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment);
  if (!control || control !== authorization.control) return { ok: false, reason: "add_control_changed", clicked: false };
  try {
    (control as HTMLElement).click();
    return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
  } catch {
    return { ok: false, reason: "click_failed", clicked: false };
  }
}

function targetCartUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && (url.hostname === "target.com" || url.hostname.endsWith(".target.com"))
      && targetPageKind(value) === "cart";
  } catch {
    return false;
  }
}

export function inspectTargetEmptyCart(documentValue: Document, urlValue: string): { ok: boolean; reason: string } {
  if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const cart = observeTargetCart(documentValue);
  if (!cart.complete || !cart.independentlyCounted) return { ok: false, reason: "cart_unverified" };
  return cart.lines.length === 0
    ? { ok: true, reason: "verified_empty" }
    : { ok: false, reason: "foreign_cart_line" };
}

export function verifyTargetAddedCart(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  proof: LiveOfferProof,
  now = Date.now()
): { ok: true; reason: "verified"; proof: CartProof } | { ok: false; reason: string } {
  if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  return verifySingleJobCart(job, observeTargetCart(documentValue, new Date(now).toISOString()), proof, now);
}

Object.defineProperty(globalThis, "YoinkTargetAction", {
  value: Object.freeze({
    abandonTargetAdd,
    commitTargetAdd,
    inspectTargetEmptyCart,
    prepareTargetAdd,
    rehearseTargetAdd,
    verifyTargetAddedCart
  }),
  configurable: true
});
