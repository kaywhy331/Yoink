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
  walmartCartLineQuantity,
  walmartFulfillmentTiles,
  walmartInteractiveBlock,
  walmartOrderLimit,
  walmartPageKind,
  walmartSecurityChallenge,
  type WalmartCartLineQuantity,
  type WalmartFulfillmentTile
} from "../../../packages/browser-adapters/src/walmart.js";
import { extractRetailerSku } from "../../../packages/browser-adapters/src/retailers.js";
import { WALMART_ADD_ADAPTER_VERSION, type AdapterEnvironment } from "../../../packages/contracts/src/index.js";
import { guardedCartQuantity } from "../../../packages/contracts/src/official-msrp.js";

export interface WalmartAddJob extends BrowserActionContract {
  adapterVersion: typeof WALMART_ADD_ADAPTER_VERSION;
}

/**
 * How a quantity above one reaches the cart. Walmart's product page has no
 * quantity picker before Add (Add turns into a +/- stepper afterwards), so
 * Add puts one in the cart and the line is raised there to `raiseTo` units
 * in total, never past the store's own per-order limit.
 */
export interface WalmartQuantityPlan {
  requested: number;
  storeLimit: number | null;
  add: 1;
  raiseTo: number;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  proof: LiveOfferProof;
  document: Document;
  jobSnapshot: string;
  add: 1;
}

export type WalmartAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof; quantity?: WalmartQuantityPlan }
  | { ok: false; reason: string };

export type WalmartAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true; quantity?: WalmartQuantityPlan }
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
  if (!guardedCartQuantity(job?.quantity)) return "quantity_not_supported";
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

function walmartQuantityPlan(documentValue: Document, job: WalmartAddJob, control: Element): WalmartQuantityPlan {
  const storeLimit = walmartOrderLimit(documentValue, job.retailerSku, job.fulfillment, control);
  return { requested: job.quantity, storeLimit, add: 1, raiseTo: Math.min(job.quantity, storeLimit ?? job.quantity) };
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
  // The product page still has to show one unit (the binder refuses any
  // other reading), because Add puts exactly one in the cart.
  const plan = job.quantity > 1 ? walmartQuantityPlan(documentValue, job, control) : null;
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof,
    document: documentValue, jobSnapshot: JSON.stringify(job), add: 1 };
  return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof, ...(plan ? { quantity: plan } : {}) };
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
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true,
    ...(prepared.quantity ? { quantity: prepared.quantity } : {}) };
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

/** Line quantities for the job's item: before the add, verified now, and wanted. */
export interface WalmartCartQuantityInput {
  baselineQuantity: number;
  currentQuantity: number;
  targetQuantity: number;
}

export type WalmartCartQuantityRaise =
  | { ok: true; reason: "quantity_set"; quantity: number; storeLimit: number | null }
  | { ok: false; reason: string; quantity?: number; storeLimit?: number | null };

/** Test seam: the waits are shorter in tests; the extension uses the defaults. */
export interface WalmartRaiseTiming {
  stepWaitMs?: number;
  totalMs?: number;
  pollMs?: number;
}

const RAISE_STEP_WAIT_MS = 2_500;
const RAISE_TOTAL_MS = 8_000;
const RAISE_POLL_MS = 50;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, Math.max(0, milliseconds)); });
}

async function waitForLine(
  documentValue: Document,
  retailerSku: string,
  settled: (line: WalmartCartLineQuantity) => boolean,
  timeoutMs: number,
  pollMs: number
): Promise<WalmartCartLineQuantity> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let line = walmartCartLineQuantity(documentValue, retailerSku);
  while (!settled(line) && Date.now() < deadline) {
    await pause(Math.min(pollMs, deadline - Date.now()));
    line = walmartCartLineQuantity(documentValue, retailerSku);
  }
  return line;
}

// A select or number input in the line is set the way a shopper's choice
// reaches the store's page: the native value, then input and change. This is
// the runner's only synthetic event, and only on the job's own cart line.
function setLineQuantityValue(control: Element, value: number): boolean {
  const view = control.ownerDocument.defaultView;
  if (!view) return false;
  const prototype = control.tagName === "SELECT" ? view.HTMLSelectElement.prototype : view.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) return false;
  (control as HTMLElement).focus();
  setter.call(control, String(value));
  for (const type of ["input", "change"] as const) control.dispatchEvent(new view.Event(type, { bubbles: true }));
  (control as HTMLElement).blur();
  return true;
}

/**
 * Raises the job's cart line from `currentQuantity` toward `targetQuantity`
 * on Walmart's cart page, never past the store's own limit: a select or input
 * is set once, a +/- stepper gets one "+" at a time, each waiting for the
 * line to show the next quantity. It touches only that line's quantity
 * control, never lowers or removes a line, never clicks more "+" than the
 * units still wanted, and finishes within about 8 seconds. The caller re-reads
 * the whole cart afterwards and checks the exact delta against the pre-add
 * baseline.
 */
export async function raiseWalmartCartQuantity(
  documentValue: Document,
  urlValue: string,
  job: WalmartAddJob,
  input: WalmartCartQuantityInput,
  timing: WalmartRaiseTiming = {}
): Promise<WalmartCartQuantityRaise> {
  const startedAt = Date.now();
  const stepWaitMs = timing.stepWaitMs ?? RAISE_STEP_WAIT_MS;
  const pollMs = timing.pollMs ?? RAISE_POLL_MS;
  const deadline = startedAt + (timing.totalMs ?? RAISE_TOTAL_MS);
  const remaining = () => Math.min(stepWaitMs, Math.max(0, deadline - Date.now()));
  if (!walmartCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (walmartSecurityChallenge(documentValue) || walmartInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const invalid = walmartJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const baseline = input?.baselineQuantity;
  const current = input?.currentQuantity;
  const target = input?.targetQuantity;
  if (!Number.isSafeInteger(baseline) || !Number.isSafeInteger(current) || !Number.isSafeInteger(target)
    || baseline < 0 || current <= baseline || target < current || target > 99
    || target - baseline > job.quantity) return { ok: false, reason: "quantity_invalid" };

  const first = walmartCartLineQuantity(documentValue, job.retailerSku);
  if (!first.ok) return { ok: false, reason: first.reason };
  if (first.quantity === null) return { ok: false, reason: "quantity_unavailable" };
  if (first.quantity !== current) return { ok: false, reason: "cart_unverified", quantity: first.quantity };
  if (target === current) return { ok: true, reason: "quantity_set", quantity: current, storeLimit: first.control?.storeLimit ?? null };
  const control = first.control;
  if (!control) return { ok: false, reason: "quantity_control_unavailable", quantity: current };
  let storeLimit = control.storeLimit;
  let goal = Math.min(target, storeLimit ?? target);

  if (control.kind !== "stepper") {
    if (control.kind === "select") {
      const options = [...(control.element as HTMLSelectElement).options]
        .map((option) => /^\s*\d{1,2}\s*$/.test(option.value) ? Number(option.value) : 0)
        .filter((value) => value > current && value <= goal);
      goal = options.length ? Math.max(...options) : current;
    }
    if (control.limitReached || goal <= current) {
      return { ok: false, reason: "quantity_limit_reached", quantity: current, storeLimit: storeLimit ?? current };
    }
    if (control.disabled || !setLineQuantityValue(control.element, goal)) {
      return { ok: false, reason: "quantity_control_unavailable", quantity: current, storeLimit };
    }
    const settled = await waitForLine(documentValue, job.retailerSku, (line) => !line.ok || line.quantity !== current, remaining(), pollMs);
    if (!settled.ok) return { ok: false, reason: settled.reason, storeLimit };
    if (settled.quantity === goal) return { ok: true, reason: "quantity_set", quantity: goal, storeLimit };
    if (settled.quantity === current) return { ok: false, reason: "quantity_unchanged", quantity: current, storeLimit };
    return settled.quantity === null
      ? { ok: false, reason: "quantity_unavailable", storeLimit }
      : { ok: false, reason: "cart_unverified", quantity: settled.quantity, storeLimit };
  }

  let shown = current;
  let limitReached = false;
  // One "+" per unit still wanted, at most.
  for (let clicks = 0; clicks < target - current && shown < goal && Date.now() < deadline; clicks += 1) {
    // "+" can stay disabled while the last change is saved. One that stays
    // disabled for a whole step, or a line that says its limit is reached,
    // is the store's limit; one still disabled when the run's time is up is not.
    const budget = remaining();
    const ready = await waitForLine(documentValue, job.retailerSku, (line) => !line.ok || line.quantity !== shown
      || line.control?.kind !== "stepper" || !line.control.disabled || line.control.limitReached, budget, pollMs);
    if (!ready.ok) return { ok: false, reason: ready.reason, quantity: shown, storeLimit };
    if (ready.quantity !== shown) {
      return ready.quantity === null
        ? { ok: false, reason: "quantity_unavailable", storeLimit }
        : { ok: false, reason: "cart_unverified", quantity: ready.quantity, storeLimit };
    }
    if (ready.control?.kind !== "stepper") return { ok: false, reason: "quantity_control_unavailable", quantity: shown, storeLimit };
    if (ready.control.limitReached || (ready.control.disabled && budget >= stepWaitMs)) {
      limitReached = true;
      break;
    }
    if (ready.control.disabled) break;
    if (ready.control.storeLimit !== null) {
      storeLimit = Math.min(storeLimit ?? ready.control.storeLimit, ready.control.storeLimit);
      goal = Math.min(target, storeLimit);
      if (shown >= goal) {
        limitReached = true;
        break;
      }
    }
    try {
      (ready.control.element as HTMLElement).click();
    } catch {
      return { ok: false, reason: "click_failed", quantity: shown, storeLimit };
    }
    const after = await waitForLine(documentValue, job.retailerSku, (line) => !line.ok || line.quantity !== shown, remaining(), pollMs);
    if (!after.ok) return { ok: false, reason: after.reason, quantity: shown, storeLimit };
    if (after.quantity === null) return { ok: false, reason: "quantity_unavailable", storeLimit };
    if (after.quantity === shown) {
      // The store kept the line as it was. Only a limit the line names is
      // the store's limit; otherwise the change did not land in time.
      if (after.control?.limitReached) limitReached = true;
      break;
    }
    if (after.quantity !== shown + 1 || after.quantity > goal) {
      return { ok: false, reason: "cart_unverified", quantity: after.quantity, storeLimit };
    }
    shown = after.quantity;
  }
  if (limitReached) storeLimit = Math.min(storeLimit ?? shown, shown);
  if (shown > current && (shown === target || (storeLimit !== null && shown === storeLimit))) {
    return { ok: true, reason: "quantity_set", quantity: shown, storeLimit };
  }
  if (shown === current && limitReached) return { ok: false, reason: "quantity_limit_reached", quantity: shown, storeLimit };
  return { ok: false, reason: "quantity_unchanged", quantity: shown, storeLimit };
}

Object.defineProperty(globalThis, "YoinkWalmartAction", {
  value: Object.freeze({
    abandonWalmartAdd,
    commitWalmartAdd,
    inspectWalmartCartBaseline,
    prepareWalmartAdd,
    raiseWalmartCartQuantity,
    rehearseWalmartAdd,
    selectWalmartShipping,
    verifyWalmartAddedCart
  }),
  configurable: true
});
