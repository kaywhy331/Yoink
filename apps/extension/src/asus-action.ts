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
  asusOfferBinding,
  asusUrlSku,
  asusInteractiveBlock,
  asusPageKind,
  asusCartInventory,
  ASUS_ADD_ADAPTER_VERSION,
  observeAsusOffer
} from "../../../packages/browser-adapters/src/asus.js";
import { type AdapterEnvironment } from "../../../packages/contracts/src/index.js";

export interface AsusAddJob extends BrowserActionContract {
  adapterVersion: typeof ASUS_ADD_ADAPTER_VERSION;
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

export type AsusAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type AsusAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type AsusAddCommit =
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

function asusJobReason(job: AsusAddJob): string {
  if (job?.adapterVersion !== ASUS_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "asus" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
  if (asusPageKind(job.canonicalUrl) !== "product"
    || asusUrlSku(job.canonicalUrl) !== job.retailerSku) return "listing_mismatch";
  if (job.currency !== "USD") return "currency_mismatch";
  if (job.expectedSeller && job.expectedSeller !== "ASUS") return "seller_unverified";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `asus_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonAsusAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareAsusAdd(
  documentValue: Document,
  urlValue: string,
  job: AsusAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): AsusAddPreparation {
  pending = null;
  const invalid = asusJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeAsusOffer(
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
  const binding = asusOfferBinding(documentValue, urlValue, job.retailerSku, environment);
  const control = binding?.control;
  if (!control || !binding) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof,
    document: documentValue, root: binding.root, fingerprint: binding.fingerprint, jobSnapshot: JSON.stringify(job) };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseAsusAdd(
  documentValue: Document,
  urlValue: string,
  job: AsusAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): AsusAddRehearsal {
  const prepared = prepareAsusAdd(documentValue, urlValue, job, now, environment);
  if (!prepared.ok) return prepared;
  abandonAsusAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitAsusAdd(
  documentValue: Document,
  urlValue: string,
  job: AsusAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
): AsusAddCommit {
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
  const invalid = asusJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const observation = observeAsusOffer(
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
  const binding = asusOfferBinding(documentValue, urlValue, job.retailerSku, environment);
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

async function readAsusCart(document: Document, now: number) {
  try {
    const response = await document.defaultView!.fetch(new URL("/us/customer/section/load/?sections=cart&force_new_section_timestamp=true", document.URL).href, {
      credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3_000)
    });
    // Read only the same-origin cart section; customer/profile sections are not requested.
    if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "")) {
      throw new Error("Cart response unavailable");
    }
    return asusCartInventory((await response.json())?.cart, new Date(now).toISOString());
  } catch { return asusCartInventory(null, new Date(now).toISOString()); }
}

function asusCartUrl(value: string): boolean {
  return asusPageKind(value) === "cart";
}

export async function inspectAsusCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now()
) {
  if (!asusCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false as const, reason: "cart_page_unverified" };
  if (asusInteractiveBlock(documentValue, urlValue)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "asus",
    await readAsusCart(documentValue, now),
    now
  );
}

export async function verifyAsusAddedCart(
  documentValue: Document,
  urlValue: string,
  job: AsusAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now()
): Promise<{ ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string }> {
  if (!asusCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
  if (asusInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const invalid = asusJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const inventory = await readAsusCart(documentValue, now);
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("asus", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkAsusAction", {
  value: Object.freeze({
    abandonAsusAdd,
    commitAsusAdd,
    inspectAsusCartBaseline,
    prepareAsusAdd,
    rehearseAsusAdd,
    verifyAsusAddedCart
  }),
  configurable: true
});
