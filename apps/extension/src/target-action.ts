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
  observeTargetCart,
  observeTargetOffer,
  targetAddBinding,
  targetInteractiveBlock,
  targetOfferOwnsControl,
  targetPageKind,
  targetSecurityChallenge
} from "../../../packages/browser-adapters/src/target.js";
import { TARGET_ADD_ADAPTER_VERSION, type AdapterEnvironment } from "../../../packages/contracts/src/index.js";

export interface TargetAddJob extends BrowserActionContract {
  adapterVersion: typeof TARGET_ADD_ADAPTER_VERSION;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  fulfillmentControl: Element | null;
  selectionRequired: boolean;
  offerRoot: Element | null;
  proof: LiveOfferProof;
  document: Document;
  jobSnapshot: string;
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
const FULFILLMENT_SELECTION_MAX_WAIT_MS = 5_000;
let sequence = 0;
let pending: PendingAuthorization | null = null;

function traceElement(environment: AdapterEnvironment | undefined, condition: "authorized" | "rebound", element: Element | null): void {
  if (!environment?.trace) return;
  const attributes = ["id", "name", "type", "role", "data-test", "data-testid", "data-test-id", "data-automation-id", "aria-label"]
    .map((name) => element?.hasAttribute(name) ? `${name}=${JSON.stringify(String(element.getAttribute(name)).slice(0, 80))}` : "")
    .filter(Boolean)
    .join(" ");
  const content = String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  environment.trace.record({
    step: "add_control",
    condition,
    actual: element ? `${element.tagName.toLocaleLowerCase("en-US")} ${attributes} ${content}`.trim() : "missing"
  });
}

function targetJobReason(job: TargetAddJob): string {
  if (job?.adapterVersion !== TARGET_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "target" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
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
  now = Date.now(),
  environment?: AdapterEnvironment
): TargetAddPreparation {
  pending = null;
  const invalid = targetJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeTargetOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return verified;
  const binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
  if (!binding.control || binding.fulfillment !== job.fulfillment
    || (binding.selectionRequired && !binding.fulfillmentControl)) {
    return { ok: false, reason: "add_control_unavailable" };
  }
  const id = authorizationId(now);
  pending = {
    id,
    jobId: job.jobId,
    createdAt: now,
    control: binding.control,
    fulfillmentControl: binding.fulfillmentControl,
    selectionRequired: binding.selectionRequired,
    offerRoot: binding.offerRoot,
    proof: verified.proof,
    document: documentValue,
    jobSnapshot: JSON.stringify(job)
  };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseTargetAdd(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): TargetAddRehearsal {
  const prepared = prepareTargetAdd(documentValue, urlValue, { ...job, validationMode: "rehearsal" }, now, environment);
  if (!prepared.ok) return prepared;
  abandonTargetAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

async function waitForSelectedFulfillmentBinding(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  environment?: AdapterEnvironment
) {
  const deadline = Date.now() + FULFILLMENT_SELECTION_MAX_WAIT_MS;
  while (Date.now() <= deadline) {
    if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue, environment)) return null;
    const binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
    if (binding.control && binding.fulfillment === job.fulfillment && !binding.selectionRequired) return binding;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

export async function commitTargetAdd(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
): Promise<TargetAddCommit> {
  const startedAt = Date.now();
  const authorization = pending;
  pending = null;
  if (job.validationMode === "rehearsal" || !job.officialMsrp) {
    return { ok: false, reason: "official_msrp_authorization_missing", clicked: false };
  }
  if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
    return { ok: false, reason: "authorization_missing", clicked: false };
  }
  if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
    return { ok: false, reason: "authorization_expired", clicked: false };
  }
  // The click must happen on the document and job that were prepared: the
  // same jobId with different caps or fulfillment is a different job.
  if (documentValue !== authorization.document || JSON.stringify(job) !== authorization.jobSnapshot) {
    return { ok: false, reason: "offer_binding_changed", clicked: false };
  }
  const invalid = targetJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const beforeSelection = observeTargetOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString(),
    environment
  );
  const initiallyVerified = verifyLiveOffer(job, beforeSelection, now);
  if (!initiallyVerified.ok) return { ...initiallyVerified, clicked: false };
  let binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
  if (!binding.control || binding.control !== authorization.control
    || binding.fulfillmentControl !== authorization.fulfillmentControl
    || binding.selectionRequired !== authorization.selectionRequired
    || binding.offerRoot !== authorization.offerRoot) {
    traceElement(environment, "authorized", authorization.control);
    traceElement(environment, "rebound", binding.control);
    return { ok: false, reason: "add_control_changed", clicked: false };
  }
  if (binding.selectionRequired) {
    try {
      (binding.fulfillmentControl as HTMLElement).click();
    } catch {
      return { ok: false, reason: "fulfillment_selection_failed", clicked: false };
    }
    const selected = await waitForSelectedFulfillmentBinding(documentValue, urlValue, job, environment);
    if (!selected) return { ok: false, reason: "fulfillment_selection_failed", clicked: false };
    // Selecting fulfillment re-renders the buy box. The Add control may be a
    // new node, but it must still live in the offer root that was prepared.
    if (!selected.offerRoot || selected.offerRoot !== authorization.offerRoot
      || !selected.control || !targetOfferOwnsControl(authorization.offerRoot, selected.control, job.retailerSku)) {
      traceElement(environment, "authorized", authorization.control);
      traceElement(environment, "rebound", selected.control);
      return { ok: false, reason: "add_control_changed", clicked: false };
    }
    binding = selected;
  }
  // Selecting fulfillment can await a new DOM for several seconds. Preserve
  // the supplied clock origin, but charge elapsed time before the Add click.
  const finalNow = now + Math.max(0, Date.now() - startedAt);
  if (finalNow - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
    return { ok: false, reason: "authorization_expired", clicked: false };
  }
  const observation = observeTargetOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(finalNow).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, finalNow);
  if (!verified.ok) return { ...verified, clicked: false };
  const control = binding.control;
  if (!control) return { ok: false, reason: "add_control_unavailable", clicked: false };
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

export function inspectTargetCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now()
) {
  if (!targetCartUrl(urlValue)) return { ok: false as const, reason: "cart_page_unverified" };
  if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "target",
    observeTargetCart(documentValue, new Date(now).toISOString()),
    now
  );
}

export function verifyTargetAddedCart(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now()
): { ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string } {
  if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const inventory = observeTargetCart(documentValue, new Date(now).toISOString());
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("target", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkTargetAction", {
  value: Object.freeze({
    abandonTargetAdd,
    commitTargetAdd,
    inspectTargetCartBaseline,
    prepareTargetAdd,
    rehearseTargetAdd,
    verifyTargetAddedCart
  }),
  configurable: true
});
