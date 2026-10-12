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
  bestBuyAddControl,
  bestBuyBoundProductCode,
  bestBuyCartLines,
  bestBuyFulfillmentLoading,
  bestBuyFulfillmentUnavailable,
  bestBuyInteractiveBlock,
  bestBuyLineQuantityState,
  bestBuyPageKind,
  bestBuyPurchaseLimit,
  bestBuySecurityChallenge,
  observeBestBuyCart,
  observeBestBuyOffer,
  observeBestBuyPostAdd,
  type BestBuyCartBinding,
  type BestBuyCartLine,
  type BestBuyLineQuantityState
} from "../../../packages/browser-adapters/src/bestbuy.js";
import { BESTBUY_ADD_ADAPTER_VERSION, type AdapterEnvironment } from "../../../packages/contracts/src/index.js";
import { guardedCartQuantity } from "../../../packages/contracts/src/official-msrp.js";
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
  timing: { timeoutMs?: number; quietMs?: number; loadingTimeoutMs?: number } = {}
): Promise<BestBuyShippingResult> {
  pending = null;
  const timeoutMs = Math.min(4_000, Math.max(1, Number.isFinite(timing.timeoutMs) ? timing.timeoutMs! : 3_000));
  const quietMs = Math.min(500, Math.max(0, Number.isFinite(timing.quietMs) ? timing.quietMs! : 200));
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  // Best Buy draws its Shipping/Pickup choices in the browser after the page
  // loads; until then the page shows a loading placeholder. Wait for it, up to
  // about 8 s in all, before calling Shipping unverified.
  const loadingDeadline = startedAt + Math.min(8_000, Math.max(timeoutMs,
    Number.isFinite(timing.loadingTimeoutMs) ? timing.loadingTimeoutMs! : 8_000));
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
      const now = Date.now();
      const limit = !selectionClicked && now < loadingDeadline && bestBuyFulfillmentLoading(documentValue, environment)
        ? loadingDeadline : deadline;
      if (now >= limit) return result(false, selectionClicked ? "fulfillment_selection_failed" : "fulfillment_unverified");
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, limit - now))));
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

/**
 * The live-offer proof plus, on product-code pages, the code that page bound
 * to the SKU. The cart check uses it to match lines that link only to
 * `/product/<slug>/<code>`; the server only ever receives the proof's
 * safe offer fields.
 */
export type BestBuyOfferProof = LiveOfferProof & { productCode?: string };

/**
 * Best Buy's product page has no quantity control, so the Add click always
 * adds one (`add`) and the rest is raised on the cart line (`raiseTo` is the
 * total wanted from this job, capped by the store's stated limit).
 */
export interface BestBuyQuantityPlan {
  requested: number;
  storeLimit: number | null;
  add: number;
  raiseTo: number;
}

interface PendingAuthorization {
  id: string;
  jobId: string;
  createdAt: number;
  control: Element;
  proof: BestBuyOfferProof;
  document: Document;
  jobSnapshot: string;
  add: number;
}

export type BestBuyAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: BestBuyOfferProof; quantity?: BestBuyQuantityPlan }
  | { ok: false; reason: string };

export type BestBuyAddRehearsal =
  | { ok: true; reason: "verified"; proof: BestBuyOfferProof; wouldClick: true; quantity?: BestBuyQuantityPlan }
  | { ok: false; reason: string };

export type BestBuyAddCommit =
  | { ok: true; reason: "clicked"; clicked: true; proof: BestBuyOfferProof }
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
  if (!guardedCartQuantity(job?.quantity)) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
  return "";
}

// "out_of_stock" is reported only when the page names the required
// fulfillment unavailable for this SKU. An offer the runner could not bind
// ("unknown" availability) is an Add-control problem, never a stock state.
function honestOfferReason(
  reason: string,
  observation: LiveOfferObservation,
  documentValue: Document,
  job: BestBuyAddJob,
  environment?: AdapterEnvironment
): string {
  if (reason !== "out_of_stock" || observation.availability !== "unknown") return reason;
  return bestBuyFulfillmentUnavailable(documentValue, job.retailerSku, job.fulfillment, environment)
    ? "out_of_stock" : "add_control_unavailable";
}

function boundProof(proof: LiveOfferProof, documentValue: Document, urlValue: string, sku: string): BestBuyOfferProof {
  const productCode = bestBuyBoundProductCode(documentValue, urlValue, sku);
  return productCode ? { ...proof, productCode } : proof;
}

function quantityPlan(requested: number, storeLimit: number | null): BestBuyQuantityPlan {
  return { requested, storeLimit, add: 1, raiseTo: Math.min(requested, storeLimit ?? requested) };
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
  if (!verified.ok) return { ok: false, reason: honestOfferReason(verified.reason, observation, documentValue, job, environment) };
  const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
  if (!control) return { ok: false, reason: "add_control_unavailable" };
  // The bound offer only verifies with no quantity control or one reading 1,
  // so the Add click adds exactly one; a larger quantity is raised in the cart.
  const quantity = job.quantity > 1 ? quantityPlan(job.quantity, bestBuyPurchaseLimit(control, environment)) : null;
  const proof = boundProof(verified.proof, documentValue, urlValue, job.retailerSku);
  const id = authorizationId(now);
  pending = { id, jobId: job.jobId, createdAt: now, control, proof,
    document: documentValue, jobSnapshot: JSON.stringify(job), add: 1 };
  return { ok: true, reason: "verified", authorizationId: id, proof, ...(quantity ? { quantity } : {}) };
}

export function rehearseBestBuyAdd(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): BestBuyAddRehearsal {
  const prepared = prepareBestBuyAdd(documentValue, urlValue, { ...job, validationMode: "rehearsal" }, now, environment);
  if (!prepared.ok) return prepared;
  abandonBestBuyAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true,
    ...(prepared.quantity ? { quantity: prepared.quantity } : {}) };
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
  if (!verified.ok) {
    return { ok: false, reason: honestOfferReason(verified.reason, observation, documentValue, job, environment), clicked: false };
  }
  const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
  if (!control || control !== authorization.control) {
    traceElement(environment, "authorized", authorization.control);
    traceElement(environment, "rebound", control);
    return { ok: false, reason: "add_control_changed", clicked: false };
  }
  // The binding above re-proved that any quantity control reads exactly
  // `authorization.add` (always 1 here); otherwise there is no bound control.
  if (authorization.add !== 1) return { ok: false, reason: "quantity_not_supported", clicked: false };
  const proof = boundProof(verified.proof, documentValue, urlValue, job.retailerSku);
  try {
    (control as HTMLElement).click();
    return { ok: true, reason: "clicked", clicked: true, proof };
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

// The product code the add proof carries binds cart lines that link only to
// that code to this job's SKU. Without a valid one nothing is bound.
function cartBinding(job: BestBuyAddJob, proof: BestBuyOfferProof | null | undefined): BestBuyCartBinding | null {
  const productCode = String(proof?.productCode || "").toUpperCase();
  const retailerSku = String(job?.retailerSku || "");
  if (!/^(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}$/.test(productCode) || !/^\d{5,20}$/.test(retailerSku)
    || proof?.retailerSku !== retailerSku) return null;
  return { productCode, retailerSku };
}

// A baseline read before the product page was seen keys this job's line by
// its product code. Apply the same binding to it as to the current cart, so
// both sides of the delta name the line the same way. Two lines that would
// both become this SKU stay as they are and fail the delta.
function boundBaseline(baseline: CartBaselineProof, binding: BestBuyCartBinding | null): CartBaselineProof {
  if (!binding || !Array.isArray(baseline?.lines)) return baseline;
  const key = (value: unknown) => String(value || "").toUpperCase();
  if (!baseline.lines.some((line) => key(line?.retailerSku) === binding.productCode)
    || baseline.lines.some((line) => key(line?.retailerSku) === binding.retailerSku)) return baseline;
  return {
    ...baseline,
    lines: baseline.lines.map((line) => key(line.retailerSku) === binding.productCode
      ? { ...line, retailerSku: binding.retailerSku } : line)
  };
}

export function verifyBestBuyAddedCart(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  proof: BestBuyOfferProof,
  baseline: CartBaselineProof,
  now = Date.now()
): { ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string; pending?: boolean } {
  if (!bestBuyCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (bestBuySecurityChallenge(documentValue) || bestBuyInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const observedAt = new Date(now).toISOString();
  const binding = cartBinding(job, proof);
  const inventory = observeBestBuyCart(documentValue, observedAt, binding);
  const before = boundBaseline(baseline, binding);
  const verified = verifyCartAddDelta(job, before, inventory, proof, now);
  if (!verified.ok) {
    const unchanged = verified.reason === "cart_delta_unverified" && inventory.complete && inventory.independentlyCounted
      && inventory.lines.length === before.lines.length
      && inventory.lines.every(line => before.lines.some(prior => prior.retailerSku === line.retailerSku && prior.quantity === line.quantity));
    return unchanged ? { ...verified, pending: true } : verified;
  }
  // The next job reuses this baseline with its own binding, so it is read
  // without this job's binding, exactly as a fresh baseline read would be.
  const nextBaseline = captureCartBaseline("bestbuy", binding ? observeBestBuyCart(documentValue, observedAt) : inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

export interface BestBuyCartQuantityInput {
  /** The job's line quantity before its Add (0 when the line was not in the cart). */
  baselineQuantity: number;
  /** The line quantity verified after the Add. */
  currentQuantity: number;
  /** baselineQuantity + the plan's raiseTo. */
  targetQuantity: number;
}

export type BestBuyCartQuantityRaise =
  | { ok: true; reason: "quantity_set"; quantity: number; storeLimit: number | null }
  | { ok: false; reason: string; quantity?: number; storeLimit?: number | null };

const RAISE_MAX_MS = 8_000;

function bounded(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, milliseconds)));
}

// Set a form control's value through the native setter so the store's own
// change handlers see a real value change, then announce it with bubbling
// events. Only quantity controls of the job's own cart line come here.
function setQuantityControl(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  const view = control.ownerDocument.defaultView;
  const prototype = control.tagName === "SELECT" ? view?.HTMLSelectElement?.prototype : view?.HTMLInputElement?.prototype;
  const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, "value")?.set : undefined;
  if (setter) setter.call(control, value);
  else control.value = value;
  const EventType = view?.Event ?? Event;
  for (const type of control.tagName === "SELECT" ? ["change"] : ["input", "change"]) {
    control.dispatchEvent(new EventType(type, { bubbles: true }));
  }
}

// The highest enabled option above the current quantity and within the target.
function selectStep(select: HTMLSelectElement, current: number, desired: number): HTMLOptionElement | null {
  let chosen: HTMLOptionElement | null = null;
  let chosenValue = 0;
  for (const option of select.options) {
    if (option.disabled) continue;
    const value = /^\d{1,2}$/.test(option.value.trim()) ? Number(option.value.trim()) : Number(String(option.textContent || "").trim());
    if (Number.isInteger(value) && value > current && value <= desired && value > chosenValue) {
      chosen = option;
      chosenValue = value;
    }
  }
  return chosen;
}

function busyLine(line: Element): boolean {
  return line.getAttribute("aria-busy") === "true" || Boolean(line.querySelector("[aria-busy='true']"));
}

/**
 * Raises the job's own cart line toward `targetQuantity` on the Best Buy cart
 * page, never above it or the store's limit, and never touching another line,
 * removal or checkout. A select or number input is set once; a +/- stepper is
 * clicked one step at a time, each step confirmed before the next. The caller
 * re-reads the whole cart afterwards and verifies the delta against the
 * pre-Add baseline. `proof` is the add proof: it binds lines that link only
 * to the product page's code. `job.quantity` must be the job's requested
 * quantity: the raise never adds more than that over `baselineQuantity`.
 */
export async function raiseBestBuyCartQuantity(
  documentValue: Document,
  urlValue: string,
  job: BestBuyAddJob,
  input: BestBuyCartQuantityInput,
  proof?: BestBuyOfferProof | null,
  timing: { timeoutMs?: number; stepTimeoutMs?: number; quietMs?: number } = {}
): Promise<BestBuyCartQuantityRaise> {
  const deadline = Date.now() + bounded(timing.timeoutMs, 1, RAISE_MAX_MS, 7_500);
  const stepTimeoutMs = bounded(timing.stepTimeoutMs, 1, 2_500, 2_500);
  const quietMs = bounded(timing.quietMs, 0, 1_000, 600);
  const invalid = bestBuyJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const baselineQuantity = Number(input?.baselineQuantity);
  const currentQuantity = Number(input?.currentQuantity);
  const targetQuantity = Number(input?.targetQuantity);
  if (!Number.isInteger(baselineQuantity) || !Number.isInteger(currentQuantity) || !Number.isInteger(targetQuantity)
    || baselineQuantity < 0 || currentQuantity <= baselineQuantity || targetQuantity < currentQuantity
    || targetQuantity > 99 || targetQuantity - baselineQuantity > job.quantity) {
    return { ok: false, reason: "quantity_target_invalid" };
  }
  const binding = cartBinding(job, proof);
  // The whole-page probe (gates, queues, dialogs) runs before every change and
  // at the end; polling between them only re-reads the job's line.
  const locate = (fullPage = false): { line: BestBuyCartLine; state: BestBuyLineQuantityState } | { reason: string } => {
    if (documentValue.URL !== urlValue) return { reason: "cart_page_unverified" };
    if (fullPage) {
      const page = observeBestBuyPostAdd(documentValue, urlValue, job.retailerSku, job.fulfillment);
      if (page.state !== "cart") {
        return { reason: ["queue", "user_action"].includes(page.state) && page.reason !== "page_changed"
          ? "manual_action_required" : "cart_page_unverified" };
      }
    }
    const cart = bestBuyCartLines(documentValue, binding);
    // Any unidentifiable line could be this item: never guess which to raise.
    if (!cart.independentlyCounted || cart.lines.some((line) => !line.retailerSku)) return { reason: "cart_unverified" };
    const mine = cart.lines.filter((line) => line.retailerSku === job.retailerSku);
    if (mine.length > 1) return { reason: "quantity_line_ambiguous" };
    const line = mine[0];
    if (!line) return { reason: "quantity_line_missing" };
    return { line, state: bestBuyLineQuantityState(line.element) };
  };

  const first = locate(true);
  if ("reason" in first) return { ok: false, reason: first.reason };
  const before = first.state;
  if (first.line.sellerType === "third_party") return { ok: false, reason: "third_party_seller" };
  if (before.quantity === null) return { ok: false, reason: "quantity_control_unavailable" };
  if (before.quantity !== currentQuantity) return { ok: false, reason: "quantity_line_changed", quantity: before.quantity };
  const storeLimit = before.storeLimit;
  if (currentQuantity >= targetQuantity) return { ok: true, reason: "quantity_set", quantity: currentQuantity, storeLimit };
  const desired = Math.min(targetQuantity, storeLimit ?? targetQuantity);
  if (desired <= currentQuantity) return { ok: false, reason: "quantity_limit_reached", quantity: currentQuantity, storeLimit };
  const unitPriceCents = first.line.unitPriceCents;
  if (unitPriceCents !== null && unitPriceCents > job.maxUnitPriceCents) {
    return { ok: false, reason: "over_unit_cap", quantity: currentQuantity, storeLimit };
  }
  if (unitPriceCents !== null && unitPriceCents * (desired - baselineQuantity) > job.maxOrderTotalCents) {
    return { ok: false, reason: "over_total_cap", quantity: currentQuantity, storeLimit };
  }
  if (!before.control || before.disabled) return { ok: false, reason: "quantity_control_unavailable", quantity: currentQuantity, storeLimit };

  const newLimitMessage = (state: BestBuyLineQuantityState) => state.limitMessage && !before.limitMessage;
  let failure = "";
  let limitSeen = false;
  if (before.kind === "select" || before.kind === "input") {
    const option = before.kind === "select" ? selectStep(before.control as HTMLSelectElement, currentQuantity, desired) : null;
    if (before.kind === "select" && !option) return { ok: false, reason: "quantity_limit_reached", quantity: currentQuantity, storeLimit };
    const expected = option ? Number(/^\d{1,2}$/.test(option.value.trim()) ? option.value.trim() : String(option.textContent || "").trim()) : desired;
    try {
      const control = before.control as HTMLInputElement | HTMLSelectElement;
      if (before.kind === "input") (control as HTMLInputElement).focus?.();
      setQuantityControl(control, option ? option.value : String(desired));
      if (before.kind === "input") (control as HTMLInputElement).blur?.();
    } catch {
      return { ok: false, reason: "quantity_control_unavailable", quantity: currentQuantity, storeLimit };
    }
    // Let the store save and re-render: wait for the line to show the value,
    // quietly, or for a limit message.
    const settleBy = Math.min(deadline, Date.now() + stepTimeoutMs + quietMs);
    let last: number | null = expected;
    let since = Date.now();
    for (;;) {
      const now = locate();
      const value = "reason" in now ? null : now.state.quantity;
      if (!("reason" in now) && newLimitMessage(now.state)) limitSeen = true;
      if (value !== last || ("reason" in now ? false : busyLine(now.line.element))) {
        last = value;
        since = Date.now();
      }
      if ((value === expected || limitSeen) && Date.now() - since >= quietMs) break;
      if (Date.now() >= settleBy) break;
      await pause(Math.min(100, settleBy - Date.now()));
    }
  } else if (before.increase) {
    let reading = currentQuantity;
    let clicks = 0;
    while (reading < desired && Date.now() < deadline) {
      let now = locate();
      // After a click the store may hold "+" disabled while it saves.
      const readyBy = Math.min(deadline, Date.now() + stepTimeoutMs);
      while (clicks > 0 && !("reason" in now) && now.state.quantity === reading && !newLimitMessage(now.state)
        && (!now.state.increaseEnabled || busyLine(now.line.element)) && Date.now() < readyBy) {
        await pause(100);
        now = locate();
      }
      if (!("reason" in now)) now = locate(true);
      if ("reason" in now) { failure = now.reason; break; }
      if (now.state.quantity !== reading) break;
      if (newLimitMessage(now.state) || !now.state.increase || !now.state.increaseEnabled
        || (now.state.storeLimit !== null && reading >= now.state.storeLimit)) {
        limitSeen = true;
        break;
      }
      try {
        (now.state.increase as HTMLElement).click();
      } catch {
        failure = "quantity_control_unavailable";
        break;
      }
      clicks += 1;
      const changeBy = Math.min(deadline, Date.now() + stepTimeoutMs);
      let next: number | null = reading;
      for (;;) {
        const after = locate();
        next = "reason" in after ? null : after.state.quantity;
        if ((next !== null && next !== reading) || Date.now() >= changeBy) break;
        await pause(Math.min(100, changeBy - Date.now()));
      }
      if (next === null || next === reading) break;
      const previous = reading;
      reading = next;
      if (next !== previous + 1) break;
      // Let the store finish saving this step before the next one.
      if (reading < desired) await pause(Math.min(200, Math.max(1, quietMs)));
    }
  } else {
    return { ok: false, reason: "quantity_control_unavailable", quantity: currentQuantity, storeLimit };
  }

  const after = locate(true);
  if ("reason" in after) return { ok: false, reason: failure || after.reason };
  const shown = after.state.quantity;
  if (shown === null) return { ok: false, reason: "quantity_unconfirmed" };
  const knownLimits = [after.state.storeLimit, storeLimit].filter((value): value is number => value !== null);
  const reportedLimit = knownLimits.length ? Math.min(...knownLimits) : null;
  if (failure) return { ok: false, reason: failure, quantity: shown, storeLimit: reportedLimit };
  if (shown === desired) return { ok: true, reason: "quantity_set", quantity: shown, storeLimit: reportedLimit };
  if (shown < currentQuantity) return { ok: false, reason: "quantity_line_changed", quantity: shown, storeLimit: reportedLimit };
  if (shown > desired) return { ok: false, reason: "quantity_exceeded", quantity: shown, storeLimit: reportedLimit };
  // Below the target: a limit message, a "+" the store disabled, or a stated
  // limit already met means the store stopped the line at `shown`.
  const plusBlocked = before.kind !== "select" && before.kind !== "input"
    && Boolean(after.state.increase) && !after.state.increaseEnabled;
  if (limitSeen || plusBlocked || newLimitMessage(after.state) || (reportedLimit !== null && shown >= reportedLimit)) {
    return { ok: false, reason: "quantity_limit_reached", quantity: shown, storeLimit: Math.min(reportedLimit ?? shown, shown) };
  }
  return { ok: false, reason: shown === currentQuantity ? "quantity_unchanged" : "quantity_unconfirmed", quantity: shown, storeLimit: reportedLimit };
}

export function inspectBestBuyPostAdd(
  document: Document,
  url: string,
  job: BestBuyAddJob,
  environment?: AdapterEnvironment
) {
  return observeBestBuyPostAdd(document, url, job.retailerSku, job.fulfillment, environment);
}

Object.defineProperty(globalThis, "YoinkBestBuyAction", {
  value: Object.freeze({
    inspectBestBuyPostAdd,
    selectBestBuyShipping,
    abandonBestBuyAdd,
    commitBestBuyAdd,
    inspectBestBuyCartBaseline,
    prepareBestBuyAdd,
    raiseBestBuyCartQuantity,
    rehearseBestBuyAdd,
    verifyBestBuyAddedCart
  }),
  configurable: true
});
