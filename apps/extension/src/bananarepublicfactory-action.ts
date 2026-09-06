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
  bananarepublicfactoryOfferBinding,
  bananarepublicfactoryUrlSku,
  bananarepublicfactoryInteractiveBlock,
  bananarepublicfactoryPageKind,
  observeBananaRepublicFactoryCart,
  observeBananaRepublicFactoryOffer
} from "../../../packages/browser-adapters/src/bananarepublicfactory.js";
import type { AdapterEnvironment } from "../../../packages/contracts/src/index.js";
import { BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION } from "../../../packages/browser-adapters/src/bananarepublicfactory.js";

export interface BananaRepublicFactoryAddJob extends BrowserActionContract {
  adapterVersion: typeof BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION;
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

export type BananaRepublicFactoryAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type BananaRepublicFactoryAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type BananaRepublicFactoryAddCommit =
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

function bananarepublicfactoryJobReason(job: BananaRepublicFactoryAddJob): string {
  if (job?.adapterVersion !== BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "bananarepublicfactory" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
  if (bananarepublicfactoryPageKind(job.canonicalUrl) !== "product"
    || bananarepublicfactoryUrlSku(job.canonicalUrl) !== job.retailerSku) return "listing_mismatch";
  if (job.currency !== "USD") return "currency_mismatch";
  if (job.expectedSeller && job.expectedSeller !== "Banana Republic Factory") return "seller_unverified";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `bananarepublicfactory_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonBananaRepublicFactoryAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareBananaRepublicFactoryAdd(
  documentValue: Document,
  urlValue: string,
  job: BananaRepublicFactoryAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): BananaRepublicFactoryAddPreparation {
  pending = null;
  const invalid = bananarepublicfactoryJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  if (bananarepublicfactoryUrlSku(job.canonicalUrl) !== bananarepublicfactoryUrlSku(urlValue)) return { ok: false, reason: "listing_mismatch" };
  const observation = observeBananaRepublicFactoryOffer(
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
  const binding = bananarepublicfactoryOfferBinding(documentValue, urlValue, job.retailerSku, environment);
  const control = binding?.control;
  if (!control || !binding) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof,
    document: documentValue, root: binding.root, fingerprint: binding.fingerprint, jobSnapshot: JSON.stringify(job) };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseBananaRepublicFactoryAdd(
  documentValue: Document,
  urlValue: string,
  job: BananaRepublicFactoryAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): BananaRepublicFactoryAddRehearsal {
  const prepared = prepareBananaRepublicFactoryAdd(documentValue, urlValue, job, now, environment);
  if (!prepared.ok) return prepared;
  abandonBananaRepublicFactoryAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitBananaRepublicFactoryAdd(
  documentValue: Document,
  urlValue: string,
  job: BananaRepublicFactoryAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
): BananaRepublicFactoryAddCommit {
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
  const invalid = bananarepublicfactoryJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  if (bananarepublicfactoryUrlSku(job.canonicalUrl) !== bananarepublicfactoryUrlSku(urlValue)) return { ok: false, reason: "listing_mismatch", clicked: false };
  const observation = observeBananaRepublicFactoryOffer(
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
  const binding = bananarepublicfactoryOfferBinding(documentValue, urlValue, job.retailerSku, environment);
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

function bananarepublicfactoryCartUrl(value: string): boolean {
  return bananarepublicfactoryPageKind(value) === "cart";
}

export function inspectBananaRepublicFactoryCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now(),
  environment?: AdapterEnvironment
) {
  if (!bananarepublicfactoryCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false as const, reason: "cart_page_unverified" };
  if (bananarepublicfactoryInteractiveBlock(documentValue, urlValue, environment)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "bananarepublicfactory",
    observeBananaRepublicFactoryCart(documentValue, new Date(now).toISOString(), environment),
    now
  );
}

export function verifyBananaRepublicFactoryAddedCart(
  documentValue: Document,
  urlValue: string,
  job: BananaRepublicFactoryAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now(),
  environment?: AdapterEnvironment
): { ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string } {
  if (!bananarepublicfactoryCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
  if (bananarepublicfactoryInteractiveBlock(documentValue, urlValue, environment)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const invalid = bananarepublicfactoryJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const inventory = observeBananaRepublicFactoryCart(documentValue, new Date(now).toISOString(), environment);
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("bananarepublicfactory", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkBananaRepublicFactoryAction", {
  value: Object.freeze({
    abandonBananaRepublicFactoryAdd,
    commitBananaRepublicFactoryAdd,
    inspectBananaRepublicFactoryCartBaseline,
    prepareBananaRepublicFactoryAdd,
    rehearseBananaRepublicFactoryAdd,
    verifyBananaRepublicFactoryAddedCart
  }),
  configurable: true
});
