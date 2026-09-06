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
  bananarepublicOfferBinding,
  bananarepublicUrlSku,
  bananarepublicInteractiveBlock,
  bananarepublicPageKind,
  observeBananaRepublicCart,
  observeBananaRepublicOffer
} from "../../../packages/browser-adapters/src/bananarepublic.js";
import type { AdapterEnvironment } from "../../../packages/contracts/src/index.js";
import { BANANAREPUBLIC_ADD_ADAPTER_VERSION } from "../../../packages/browser-adapters/src/bananarepublic.js";

export interface BananaRepublicAddJob extends BrowserActionContract {
  adapterVersion: typeof BANANAREPUBLIC_ADD_ADAPTER_VERSION;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  proof: LiveOfferProof;
  document: Document;
  root: Element;
  fingerprint: string;
  jobSnapshot: string;
}

export type BananaRepublicAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type BananaRepublicAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type BananaRepublicAddCommit =
  | { ok: true; reason: "clicked"; clicked: true; proof: LiveOfferProof }
  | { ok: false; reason: string; clicked: false };

const AUTHORIZATION_MAX_AGE_MS = 10_000;
let sequence = 0;
let pending: PendingAuthorization | null = null;

function traceElement(environment: AdapterEnvironment | undefined, condition: "authorized" | "rebound", element: Element | null): void {
  if (!environment?.trace) return;
  const attributes = ["id", "name", "type", "role", "data-test", "data-testid", "data-test-id", "data-automation-id", "aria-label"]
    .map((name) => element?.hasAttribute(name) ? `${name}=${JSON.stringify(String(element.getAttribute(name)).slice(0, 80))}` : "")
    .filter(Boolean).join(" ");
  const content = String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  environment.trace.record({ step: "add_control", condition, actual: element ? `${element.tagName.toLowerCase()} ${attributes} ${content}`.trim() : "missing" });
}

function bananarepublicJobReason(job: BananaRepublicAddJob): string {
  if (job?.adapterVersion !== BANANAREPUBLIC_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "bananarepublic" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
  if (bananarepublicPageKind(job.canonicalUrl) !== "product"
    || bananarepublicUrlSku(job.canonicalUrl) !== job.retailerSku) return "listing_mismatch";
  if (job.currency !== "USD") return "currency_mismatch";
  if (job.expectedSeller && job.expectedSeller !== "Banana Republic") return "seller_unverified";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `bananarepublic_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonBananaRepublicAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareBananaRepublicAdd(
  documentValue: Document,
  urlValue: string,
  job: BananaRepublicAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): BananaRepublicAddPreparation {
  pending = null;
  const invalid = bananarepublicJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  if (bananarepublicUrlSku(job.canonicalUrl) !== bananarepublicUrlSku(urlValue)) return { ok: false, reason: "listing_mismatch" };
  const observation = observeBananaRepublicOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ok: false, reason: verified.reason === "out_of_stock" && observation.availability === "unknown"
    ? "add_control_unavailable" : verified.reason };
  if (verified.proof.unitPriceCents > job.maxOrderTotalCents) return { ok: false, reason: "over_total_cap" };
  const binding = bananarepublicOfferBinding(documentValue, urlValue, job.retailerSku, environment);
  const control = binding?.control;
  if (!control || !binding) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof,
    document: documentValue, root: binding.root, fingerprint: binding.fingerprint, jobSnapshot: JSON.stringify(job) };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseBananaRepublicAdd(
  documentValue: Document,
  urlValue: string,
  job: BananaRepublicAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): BananaRepublicAddRehearsal {
  const prepared = prepareBananaRepublicAdd(documentValue, urlValue, job, now, environment);
  if (!prepared.ok) return prepared;
  abandonBananaRepublicAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitBananaRepublicAdd(
  documentValue: Document,
  urlValue: string,
  job: BananaRepublicAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
): BananaRepublicAddCommit {
  const authorization = pending;
  pending = null;
  if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
    return { ok: false, reason: "authorization_missing", clicked: false };
  }
  if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
    return { ok: false, reason: "authorization_expired", clicked: false };
  }
  if (documentValue !== authorization.document || JSON.stringify(job) !== authorization.jobSnapshot) {
    return { ok: false, reason: "offer_binding_changed", clicked: false };
  }
  const invalid = bananarepublicJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  if (bananarepublicUrlSku(job.canonicalUrl) !== bananarepublicUrlSku(urlValue)) return { ok: false, reason: "listing_mismatch", clicked: false };
  const observation = observeBananaRepublicOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ok: false, clicked: false, reason: verified.reason === "out_of_stock" && observation.availability === "unknown"
    ? "add_control_unavailable" : verified.reason };
  if (verified.proof.unitPriceCents > job.maxOrderTotalCents) return { ok: false, reason: "over_total_cap", clicked: false };
  const binding = bananarepublicOfferBinding(documentValue, urlValue, job.retailerSku, environment);
  const control = binding?.control;
  if (!binding || !control || control !== authorization.control || binding.root !== authorization.root) {
    traceElement(environment, "authorized", authorization.control);
    traceElement(environment, "rebound", control ?? null);
    return { ok: false, reason: "add_control_changed", clicked: false };
  }
  if (binding.fingerprint !== authorization.fingerprint) return { ok: false, reason: "offer_binding_changed", clicked: false };
  try {
    (control as HTMLElement).click();
    return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
  } catch {
    return { ok: false, reason: "click_failed", clicked: false };
  }
}

function bananarepublicCartUrl(value: string): boolean {
  return bananarepublicPageKind(value) === "cart";
}

export function inspectBananaRepublicCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now(),
  environment?: AdapterEnvironment
) {
  if (!bananarepublicCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false as const, reason: "cart_page_unverified" };
  if (bananarepublicInteractiveBlock(documentValue, urlValue, environment)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "bananarepublic",
    observeBananaRepublicCart(documentValue, new Date(now).toISOString(), environment),
    now
  );
}

export function verifyBananaRepublicAddedCart(
  documentValue: Document,
  urlValue: string,
  job: BananaRepublicAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now(),
  environment?: AdapterEnvironment
): { ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string } {
  if (!bananarepublicCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
  if (bananarepublicInteractiveBlock(documentValue, urlValue, environment)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const invalid = bananarepublicJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const inventory = observeBananaRepublicCart(documentValue, new Date(now).toISOString(), environment);
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("bananarepublic", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkBananaRepublicAction", {
  value: Object.freeze({
    abandonBananaRepublicAdd,
    commitBananaRepublicAdd,
    inspectBananaRepublicCartBaseline,
    prepareBananaRepublicAdd,
    rehearseBananaRepublicAdd,
    verifyBananaRepublicAddedCart
  }),
  configurable: true
});
