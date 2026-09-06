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
  athletaOfferBinding,
  athletaUrlSku,
  athletaInteractiveBlock,
  athletaPageKind,
  observeAthletaCart,
  observeAthletaOffer
} from "../../../packages/browser-adapters/src/athleta.js";
import type { AdapterEnvironment } from "../../../packages/contracts/src/index.js";
import { ATHLETA_ADD_ADAPTER_VERSION } from "../../../packages/browser-adapters/src/athleta.js";

export interface AthletaAddJob extends BrowserActionContract {
  adapterVersion: typeof ATHLETA_ADD_ADAPTER_VERSION;
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

export type AthletaAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type AthletaAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type AthletaAddCommit =
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

function athletaJobReason(job: AthletaAddJob): string {
  if (job?.adapterVersion !== ATHLETA_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "athleta" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
  if (athletaPageKind(job.canonicalUrl) !== "product"
    || athletaUrlSku(job.canonicalUrl) !== job.retailerSku) return "listing_mismatch";
  if (job.currency !== "USD") return "currency_mismatch";
  if (job.expectedSeller && job.expectedSeller !== "Athleta") return "seller_unverified";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `athleta_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonAthletaAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareAthletaAdd(
  documentValue: Document,
  urlValue: string,
  job: AthletaAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): AthletaAddPreparation {
  pending = null;
  const invalid = athletaJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  if (athletaUrlSku(job.canonicalUrl) !== athletaUrlSku(urlValue)) return { ok: false, reason: "listing_mismatch" };
  const observation = observeAthletaOffer(
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
  const binding = athletaOfferBinding(documentValue, urlValue, job.retailerSku, environment);
  const control = binding?.control;
  if (!control || !binding) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof,
    document: documentValue, root: binding.root, fingerprint: binding.fingerprint, jobSnapshot: JSON.stringify(job) };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseAthletaAdd(
  documentValue: Document,
  urlValue: string,
  job: AthletaAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): AthletaAddRehearsal {
  const prepared = prepareAthletaAdd(documentValue, urlValue, job, now, environment);
  if (!prepared.ok) return prepared;
  abandonAthletaAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitAthletaAdd(
  documentValue: Document,
  urlValue: string,
  job: AthletaAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
): AthletaAddCommit {
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
  const invalid = athletaJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  if (athletaUrlSku(job.canonicalUrl) !== athletaUrlSku(urlValue)) return { ok: false, reason: "listing_mismatch", clicked: false };
  const observation = observeAthletaOffer(
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
  const binding = athletaOfferBinding(documentValue, urlValue, job.retailerSku, environment);
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

function athletaCartUrl(value: string): boolean {
  return athletaPageKind(value) === "cart";
}

export function inspectAthletaCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now(),
  environment?: AdapterEnvironment
) {
  if (!athletaCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false as const, reason: "cart_page_unverified" };
  if (athletaInteractiveBlock(documentValue, urlValue, environment)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "athleta",
    observeAthletaCart(documentValue, new Date(now).toISOString(), environment),
    now
  );
}

export function verifyAthletaAddedCart(
  documentValue: Document,
  urlValue: string,
  job: AthletaAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now(),
  environment?: AdapterEnvironment
): { ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string } {
  if (!athletaCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
  if (athletaInteractiveBlock(documentValue, urlValue, environment)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const invalid = athletaJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const inventory = observeAthletaCart(documentValue, new Date(now).toISOString(), environment);
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("athleta", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkAthletaAction", {
  value: Object.freeze({
    abandonAthletaAdd,
    commitAthletaAdd,
    inspectAthletaCartBaseline,
    prepareAthletaAdd,
    rehearseAthletaAdd,
    verifyAthletaAddedCart
  }),
  configurable: true
});
