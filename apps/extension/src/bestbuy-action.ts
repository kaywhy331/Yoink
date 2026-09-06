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
  bestBuyAddControl,
  bestBuyInteractiveBlock,
  bestBuyPageKind,
  bestBuySecurityChallenge,
  observeBestBuyCart,
  observeBestBuyOffer
} from "../../../packages/browser-adapters/src/bestbuy.js";
import { BESTBUY_ADD_ADAPTER_VERSION, type AdapterEnvironment } from "../../../packages/contracts/src/index.js";
import { bestBuyShippingBinding, extractRetailerSku, retailerInteractiveBlock } from "../../../packages/browser-adapters/src/retailers.js";

export interface BestBuyShippingResult {
  ok: boolean;
  reason: string;
  selectionClicked: boolean;
}

// This operation may click Shipping, but cannot authorize or click Add. Keep
// the observer and saved-page capture passive; callers explicitly request it.
export async function selectBestBuyShipping(
  documentValue: Document,
  urlValue: string,
  expectedSku: string,
  environment?: AdapterEnvironment,
  timing: { timeoutMs?: number; quietMs?: number } = {}
): Promise<BestBuyShippingResult> {
  pending = null;
  const timeoutMs = Math.min(4_000, Math.max(1, Number.isFinite(timing.timeoutMs) ? timing.timeoutMs! : 3_000));
  const quietMs = Math.min(500, Math.max(0, Number.isFinite(timing.quietMs) ? timing.quietMs! : 200));
  const deadline = Date.now() + timeoutMs;
  const initialDocumentUrl = documentValue.URL;
  let selectionClicked = false;
  let lastMutation = Date.now();
  let watchedRoot: Element | null = null;
  let mutationObserver: MutationObserver | undefined;
  const result = (ok: boolean, reason: string) => ({ ok, reason, selectionClicked });
  try {
    while (true) {
      if (!/^\d{5,20}$/.test(expectedSku) || documentValue.URL !== initialDocumentUrl
        || extractRetailerSku("bestbuy", urlValue, documentValue) !== expectedSku) return result(false, "listing_mismatch");
      if (retailerInteractiveBlock(documentValue, urlValue, environment)) {
        return result(false, "manual_action_required");
      }
      const binding = bestBuyShippingBinding(documentValue, urlValue, expectedSku, environment);
      if (binding) {
        if (binding.offerRoot !== watchedRoot) {
          mutationObserver?.disconnect();
          watchedRoot = binding.offerRoot;
          lastMutation = Date.now();
          const Observer = documentValue.defaultView?.MutationObserver;
          if (Observer) {
            mutationObserver = new Observer(() => { lastMutation = Date.now(); });
            mutationObserver.observe(watchedRoot, { subtree: true, childList: true, attributes: true, characterData: true });
          }
        }
        if (binding.selected && (!selectionClicked || Date.now() - lastMutation >= quietMs)) {
          return result(true, "verified");
        }
        if (!binding.selected && !selectionClicked) {
          selectionClicked = true;
          lastMutation = Date.now();
          try { (binding.control as HTMLElement).click(); }
          catch { return result(false, "fulfillment_selection_failed"); }
          // Let the store's event/render queue apply its selection before
          // rebinding. A tight synchronous loop can starve that update.
          await new Promise((resolve) => setTimeout(resolve, Math.min(100, timeoutMs)));
          continue;
        }
      }
      if (Date.now() >= deadline) return result(false, selectionClicked ? "fulfillment_selection_failed" : "fulfillment_unverified");
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
  } catch {
    return result(false, "fulfillment_selection_failed");
  } finally {
    mutationObserver?.disconnect();
  }
}

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

function traceElement(environment: AdapterEnvironment | undefined, condition: "authorized" | "rebound", element: Element | null): void {
  if (!environment?.trace) return;
  const attributes = ["id", "name", "type", "role", "data-test", "data-testid", "data-test-id", "data-automation-id", "aria-label"]
    .map((name) => element?.hasAttribute(name) ? `${name}=${JSON.stringify(String(element.getAttribute(name)).slice(0, 80))}` : "")
    .filter(Boolean).join(" ");
  const content = String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  environment.trace.record({ step: "add_control", condition, actual: element ? `${element.tagName.toLowerCase()} ${attributes} ${content}`.trim() : "missing" });
}

function bestBuyJobReason(job: BestBuyAddJob): string {
  if (job?.adapterVersion !== BESTBUY_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "bestbuy" || job?.action !== "add_to_cart") return "unsupported_action";
  if (job?.quantity !== 1) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
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
  now = Date.now(),
  environment?: AdapterEnvironment
): BestBuyAddPreparation {
  pending = null;
  const invalid = bestBuyJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeBestBuyOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return verified;
  const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
  if (!control) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseBestBuyAdd(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): BestBuyAddRehearsal {
  const prepared = prepareBestBuyAdd(documentValue, urlValue, job, now, environment);
  if (!prepared.ok) return prepared;
  abandonBestBuyAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitBestBuyAdd(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
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
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ...verified, clicked: false };
  const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
  if (!control || control !== authorization.control) {
    traceElement(environment, "authorized", authorization.control);
    traceElement(environment, "rebound", control);
    return { ok: false, reason: "add_control_changed", clicked: false };
  }
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

export function inspectBestBuyCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now()
) {
  if (!bestBuyCartUrl(urlValue)) return { ok: false as const, reason: "cart_page_unverified" };
  if (bestBuySecurityChallenge(documentValue) || bestBuyInteractiveBlock(documentValue, urlValue)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "bestbuy",
    observeBestBuyCart(documentValue, new Date(now).toISOString()),
    now
  );
}

export function verifyBestBuyAddedCart(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now()
): { ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string } {
  if (!bestBuyCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (bestBuySecurityChallenge(documentValue) || bestBuyInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const inventory = observeBestBuyCart(documentValue, new Date(now).toISOString());
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("bestbuy", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkBestBuyAction", {
  value: Object.freeze({
    selectBestBuyShipping,
    abandonBestBuyAdd,
    commitBestBuyAdd,
    inspectBestBuyCartBaseline,
    prepareBestBuyAdd,
    rehearseBestBuyAdd,
    verifyBestBuyAddedCart
  }),
  configurable: true
});
