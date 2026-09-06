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
  audioAdviceOfferBinding,
  audioAdviceInteractiveBlock,
  audioAdvicePageKind,
  audioAdviceUrlSku,
  audioAdviceCartInventory,
  AUDIOADVICE_ADD_ADAPTER_VERSION,
  observeAudioAdviceOffer
} from "../../../packages/browser-adapters/src/audioadvice.js";
import { type AdapterEnvironment } from "../../../packages/contracts/src/index.js";

export interface AudioAdviceAddJob extends BrowserActionContract {
  adapterVersion: typeof AUDIOADVICE_ADD_ADAPTER_VERSION;
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

export type AudioAdviceAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof }
  | { ok: false; reason: string };

export type AudioAdviceAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true }
  | { ok: false; reason: string };

export type AudioAdviceAddCommit =
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

function audioAdviceJobReason(job: AudioAdviceAddJob): string {
  if (job?.adapterVersion !== AUDIOADVICE_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "audioadvice" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
  if (audioAdvicePageKind(job.canonicalUrl) !== "product"
    || audioAdviceUrlSku(job.canonicalUrl) !== job.retailerSku) return "listing_mismatch";
  if (job.currency !== "USD") return "currency_mismatch";
  if (job.expectedSeller && job.expectedSeller !== "Audio Advice") return "seller_unverified";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `audioadvice_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonAudioAdviceAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

export function prepareAudioAdviceAdd(
  documentValue: Document,
  urlValue: string,
  job: AudioAdviceAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): AudioAdviceAddPreparation {
  pending = null;
  const invalid = audioAdviceJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeAudioAdviceOffer(
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
  const binding = audioAdviceOfferBinding(documentValue, urlValue, job.retailerSku, environment);
  const control = binding?.control;
  if (!control || !binding) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof,
    document: documentValue, root: binding.root, fingerprint: binding.fingerprint, jobSnapshot: JSON.stringify(job) };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseAudioAdviceAdd(
  documentValue: Document,
  urlValue: string,
  job: AudioAdviceAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): AudioAdviceAddRehearsal {
  const prepared = prepareAudioAdviceAdd(documentValue, urlValue, job, now, environment);
  if (!prepared.ok) return prepared;
  abandonAudioAdviceAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitAudioAdviceAdd(
  documentValue: Document,
  urlValue: string,
  job: AudioAdviceAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
): AudioAdviceAddCommit {
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
  const invalid = audioAdviceJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const observation = observeAudioAdviceOffer(
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
  const binding = audioAdviceOfferBinding(documentValue, urlValue, job.retailerSku, environment);
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

async function readAudioAdviceCart(document: Document, now: number) {
  try {
    const response = await document.defaultView!.fetch(new URL("/cart.js", document.URL).href, {
      credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3_000)
    });
    // Shopify serves JSON from /cart.js with text/javascript on this storefront.
    // Parse it only as data; never execute the response body.
    if (!response.ok || !/^(?:application\/json|text\/javascript)(?:;|$)/i.test(response.headers.get("content-type") || "")) {
      throw new Error("Cart response unavailable");
    }
    return audioAdviceCartInventory(await response.json(), new Date(now).toISOString());
  } catch { return audioAdviceCartInventory(null, new Date(now).toISOString()); }
}

function audioAdviceCartUrl(value: string): boolean {
  return audioAdvicePageKind(value) === "cart";
}

export async function inspectAudioAdviceCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now()
) {
  if (!audioAdviceCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false as const, reason: "cart_page_unverified" };
  if (audioAdviceInteractiveBlock(documentValue, urlValue)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "audioadvice",
    await readAudioAdviceCart(documentValue, now),
    now
  );
}

export async function verifyAudioAdviceAddedCart(
  documentValue: Document,
  urlValue: string,
  job: AudioAdviceAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now()
): Promise<{ ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string }> {
  if (!audioAdviceCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
  if (audioAdviceInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const invalid = audioAdviceJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const inventory = await readAudioAdviceCart(documentValue, now);
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("audioadvice", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkAudioAdviceAction", {
  value: Object.freeze({
    abandonAudioAdviceAdd,
    commitAudioAdviceAdd,
    inspectAudioAdviceCartBaseline,
    prepareAudioAdviceAdd,
    rehearseAudioAdviceAdd,
    verifyAudioAdviceAddedCart
  }),
  configurable: true
});
