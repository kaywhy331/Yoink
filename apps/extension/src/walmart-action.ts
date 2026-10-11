import {
  captureCartBaseline,
  verifyCartAddDelta,
  verifyLiveOffer,
  type BrowserActionContract,
  type CartBaselineProof,
  type CartProof,
  type LiveOfferObservation,
  type LiveOfferProof
} from "../../../packages/browser-safety/src/index.js";
import {
  observeWalmartCart,
  observeWalmartOffer,
  walmartAddControl,
  walmartFulfillmentTiles,
  walmartInteractiveBlock,
  walmartPageKind,
  walmartSecurityChallenge,
  type WalmartFulfillmentTile
} from "../../../packages/browser-adapters/src/walmart.js";
import { extractRetailerSku } from "../../../packages/browser-adapters/src/retailers.js";
import { WALMART_ADD_ADAPTER_VERSION, type AdapterEnvironment } from "../../../packages/contracts/src/index.js";

export interface WalmartAddJob extends BrowserActionContract {
  adapterVersion: typeof WALMART_ADD_ADAPTER_VERSION;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  proof: LiveOfferProof;
  document: Document;
  jobSnapshot: string;
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

function traceElement(environment: AdapterEnvironment | undefined, condition: "authorized" | "rebound", element: Element | null): void {
  if (!environment?.trace) return;
  const attributes = ["id", "name", "type", "role", "data-test", "data-testid", "data-test-id", "data-automation-id", "aria-label"]
    .map((name) => element?.hasAttribute(name) ? `${name}=${JSON.stringify(String(element.getAttribute(name)).slice(0, 80))}` : "")
    .filter(Boolean).join(" ");
  const content = String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  environment.trace.record({ step: "add_control", condition, actual: element ? `${element.tagName.toLowerCase()} ${attributes} ${content}`.trim() : "missing" });
}

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

export interface WalmartShippingResult {
  ok: boolean;
  /**
   * ok: "shipping_selected" (Shipping was clicked and now reads selected) or
   * "shipping_already_selected" (nothing clicked). Otherwise
   * "fulfillment_unverified" (no Shipping tile, or it says unavailable),
   * "fulfillment_selection_failed" (clicked, but it did not take),
   * "listing_mismatch" or "manual_action_required".
   */
  reason: string;
  selectionClicked: boolean;
}

function shippingOnly(tiles: WalmartFulfillmentTile[] | null): WalmartFulfillmentTile | null {
  const shipping = tiles?.find((tile) => tile.type === "SHIPPING") ?? null;
  return shipping?.selected && tiles?.every((tile) => tile === shipping || !tile.selected) ? shipping : null;
}

/**
 * Puts Walmart's buy box on Shipping before prepare (Walmart may preselect
 * Pickup for an item stocked nearby). It clicks the Shipping tile's label
 * once, and only when the page is the exact item, the tile is not already
 * selected and its intent line does not say Shipping is unavailable; then it
 * waits up to 3 seconds for the tile to read selected. It never clicks
 * anything else and never authorizes or clicks Add.
 */
export async function selectWalmartShipping(
  documentValue: Document,
  urlValue: string,
  retailerSku: string,
  timing: { timeoutMs?: number; pollMs?: number; settleMs?: number } = {}
): Promise<WalmartShippingResult> {
  pending = null;
  const timeoutMs = Math.min(4_000, Math.max(1, timing.timeoutMs ?? 3_000));
  const pollMs = Math.min(200, Math.max(1, timing.pollMs ?? 50));
  const settleMs = Math.min(500, Math.max(0, timing.settleMs ?? 150));
  const deadline = Date.now() + timeoutMs;
  const initialDocumentUrl = documentValue.URL;
  let selectionClicked = false;
  const result = (ok: boolean, reason: string): WalmartShippingResult => ({ ok, reason, selectionClicked });
  try {
    for (;;) {
      if (!/^\d{5,20}$/.test(String(retailerSku)) || documentValue.URL !== initialDocumentUrl
        || walmartPageKind(urlValue) !== "product"
        || extractRetailerSku("walmart", urlValue, documentValue) !== retailerSku) return result(false, "listing_mismatch");
      if (walmartSecurityChallenge(documentValue) || walmartInteractiveBlock(documentValue, urlValue)) {
        return result(false, "manual_action_required");
      }
      const tiles = walmartFulfillmentTiles(documentValue);
      if (shippingOnly(tiles)) {
        if (!selectionClicked) return result(true, "shipping_already_selected");
        // The store re-renders the buy box after a change; it must still read Shipping.
        await pause(Math.min(settleMs, Math.max(0, deadline - Date.now())));
        if (shippingOnly(walmartFulfillmentTiles(documentValue))) return result(true, "shipping_selected");
      } else if (!selectionClicked) {
        const shipping = tiles?.find((tile) => tile.type === "SHIPPING") ?? null;
        if (shipping?.unavailable) return result(false, "fulfillment_unverified");
        if (shipping?.available) {
          selectionClicked = true;
          try {
            (shipping.label as HTMLElement).click();
          } catch {
            return result(false, "fulfillment_selection_failed");
          }
        }
      }
      if (Date.now() >= deadline) return result(false, selectionClicked ? "fulfillment_selection_failed" : "fulfillment_unverified");
      await pause(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  } catch {
    return result(false, "fulfillment_selection_failed");
  }
}

// Browser safety reads every availability but in stock or preorder as
// "out_of_stock". A page whose offer or Add control could not be bound is not
// sold out: every Walmart call read "Sold out when Chrome checked" while the
// page's own state said in stock (2026-10-10). Only a page that shows the
// item unavailable stays "out_of_stock".
function honestOfferReason(reason: string, observation: LiveOfferObservation): string {
  return reason === "out_of_stock" && observation.availability === "unknown" ? "add_control_unavailable" : reason;
}

export function prepareWalmartAdd(
  documentValue: Document,
  urlValue: string,
  job: WalmartAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): WalmartAddPreparation {
  pending = null;
  const invalid = walmartJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeWalmartOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ok: false, reason: honestOfferReason(verified.reason, observation) };
  const control = walmartAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
  if (!control) return { ok: false, reason: "add_control_unavailable" };
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof,
    document: documentValue, jobSnapshot: JSON.stringify(job) };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
}

export function rehearseWalmartAdd(
  documentValue: Document,
  urlValue: string,
  job: WalmartAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): WalmartAddRehearsal {
  const prepared = prepareWalmartAdd(documentValue, urlValue, { ...job, validationMode: "rehearsal" }, now, environment);
  if (!prepared.ok) return prepared;
  abandonWalmartAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
}

export function commitWalmartAdd(
  documentValue: Document,
  urlValue: string,
  job: WalmartAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
): WalmartAddCommit {
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
  const invalid = walmartJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const observation = observeWalmartOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ok: false, reason: honestOfferReason(verified.reason, observation), clicked: false };
  const control = walmartAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
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

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, Math.max(0, milliseconds)); });
}

Object.defineProperty(globalThis, "YoinkWalmartAction", {
  value: Object.freeze({
    abandonWalmartAdd,
    commitWalmartAdd,
    inspectWalmartCartBaseline,
    prepareWalmartAdd,
    rehearseWalmartAdd,
    selectWalmartShipping,
    verifyWalmartAddedCart
  }),
  configurable: true
});
