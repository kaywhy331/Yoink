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
  observeTargetCart,
  observeTargetOffer,
  targetAddBinding,
  targetCartLines,
  targetCartOptionQuantity,
  targetCartQuantityControl,
  targetElementVisible,
  targetInteractiveBlock,
  targetOfferOwnsControl,
  targetPageKind,
  targetPurchaseLimit,
  targetSecurityChallenge,
  type TargetCartQuantityControl
} from "../../../packages/browser-adapters/src/target.js";
import { TARGET_ADD_ADAPTER_VERSION, type AdapterEnvironment } from "../../../packages/contracts/src/index.js";
import { guardedCartQuantity } from "../../../packages/contracts/src/official-msrp.js";

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

/**
 * A plan for several (Kevin, 2026-10-10). Target's product page has no
 * quantity picker before the first add (its Add button only turns into a
 * stepper afterwards), so the Add puts one unit in the cart (`add`) and the
 * cart line is raised to `raiseTo` in total, never past the store's own
 * per-order limit (`storeLimit`, null when the page shows none).
 */
export interface TargetQuantityPlan {
  requested: number;
  storeLimit: number | null;
  add: 1;
  raiseTo: number;
}

export type TargetAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof; quantity?: TargetQuantityPlan }
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
  if (!guardedCartQuantity(job?.quantity)) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `target_add_${now.toString(36)}_${sequence.toString(36)}`;
}

// A page whose Add control or offer could not be bound is not sold out. Only
// Target's own unavailable state for the exact item (availability
// "out_of_stock") is reported as out_of_stock.
function targetOfferReason(reason: string, observation: LiveOfferObservation): string {
  return reason === "out_of_stock" && observation.availability === "unknown" ? "add_control_unavailable" : reason;
}

function targetQuantityPlan(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  environment?: AdapterEnvironment
): TargetQuantityPlan {
  const storeLimit = targetPurchaseLimit(documentValue, urlValue, job.retailerSku, environment);
  return { requested: job.quantity, storeLimit, add: 1, raiseTo: Math.min(job.quantity, storeLimit ?? job.quantity) };
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
  if (!verified.ok) return { ok: false, reason: targetOfferReason(verified.reason, observation) };
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
  // One unit is clicked whatever the plan: the product-page quantity check
  // above still requires "1". Only a plan for several reports its plan.
  return {
    ok: true,
    reason: "verified",
    authorizationId: id,
    proof: verified.proof,
    ...(job.quantity > 1 ? { quantity: targetQuantityPlan(documentValue, urlValue, job, environment) } : {})
  };
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
  if (!initiallyVerified.ok) {
    return { ok: false, reason: targetOfferReason(initiallyVerified.reason, beforeSelection), clicked: false };
  }
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
  if (!verified.ok) return { ok: false, reason: targetOfferReason(verified.reason, observation), clicked: false };
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

// ---- Raising the cart line to a plan for several (Kevin, 2026-10-10) ----

export interface TargetCartQuantityInput {
  /** The item's line quantity before the add (0 when it wasn't in the cart). */
  baselineQuantity: number;
  /** The line quantity just verified after the add. */
  currentQuantity: number;
  /** baseline + the plan's raiseTo: the most the line may show. */
  targetQuantity: number;
}

export type TargetCartQuantityRaise =
  | { ok: true; reason: "quantity_set"; quantity: number; storeLimit: number | null }
  | { ok: false; reason: string; quantity?: number; storeLimit?: number | null };

/** Test seams: each bound can only be shortened. */
export interface TargetCartQuantityTiming {
  maxMs?: number;
  stepWaitMs?: number;
  settleMs?: number;
  pollMs?: number;
}

const RAISE_MAX_MS = 7_500;
const RAISE_LINE_WAIT_MS = 1_500;
const RAISE_LISTBOX_WAIT_MS = 1_500;
const RAISE_STEP_WAIT_MS = 2_500;
const RAISE_SETTLE_MS = 800;
const RAISE_POLL_MS = 50;
// A raise touches only the exact line's own quantity control (or the listbox
// that control names): never a link, checkout, removal or save-for-later. A
// label is judged by its leading verb, since it often carries the product's
// name ("Increase quantity of Pay Day Bar").
const RAISE_FORBIDDEN_ATTRIBUTE = /check\s*out|place\s*order|buy\s*now|remove|delete|save\s*for\s*later|empty\s*cart/i;
const RAISE_FORBIDDEN_LABEL = /^\s*(?:check\s*out|place\s+(?:your\s+)?order|buy\s+now|pay|remove|delete|save\s+for\s+later|move\s+to|empty)\b/i;

interface RaiseContext {
  documentValue: Document;
  sku: string;
  line: Element;
  control: TargetCartQuantityControl;
  start: number;
  desired: number;
  target: number;
  deadline: number;
  pollMs: number;
  stepWaitMs: number;
  settleMs: number;
}

interface LineState {
  line: Element;
  control: TargetCartQuantityControl | null;
  quantity: number | null;
}

function boundedMs(value: unknown, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, maximum) : maximum;
}

function lowerLimit(...limits: (number | null | undefined)[]): number | null {
  const known = limits.filter((limit): limit is number => typeof limit === "number");
  return known.length ? Math.min(...known) : null;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
}

/** The one cart line that names the SKU, and names nothing else. */
function exactCartLine(documentValue: Document, sku: string): Element | null {
  const lines = targetCartLines(documentValue).filter((line) => line.tcins.includes(sku));
  return lines.length === 1 && lines[0]?.sku === sku ? lines[0].element : null;
}

function lineState(documentValue: Document, sku: string): LineState | null {
  const line = exactCartLine(documentValue, sku);
  if (!line) return null;
  const control = targetCartQuantityControl(line);
  return { line, control, quantity: control?.quantity ?? null };
}

async function waitForLine(
  context: Pick<RaiseContext, "documentValue" | "sku" | "pollMs">,
  until: number,
  done: (state: LineState | null) => boolean
): Promise<LineState | null> {
  let state = lineState(context.documentValue, context.sku);
  while (!done(state) && Date.now() < until) {
    await pause(Math.min(context.pollMs, until - Date.now()));
    state = lineState(context.documentValue, context.sku);
  }
  return state;
}

function controlBusy(state: LineState | null): boolean {
  const element = state?.control?.control;
  return Boolean(element && (element.hasAttribute("disabled") || element.getAttribute("aria-busy") === "true"
    || state?.line.getAttribute("aria-busy") === "true"));
}

/** The line's quantity once it has shown `expected`, not busy, for the settle time; else what it shows at the deadline. */
async function settledQuantity(context: RaiseContext, expected: number): Promise<number | null> {
  let last: number | null | undefined;
  let since = Date.now();
  for (;;) {
    const state = lineState(context.documentValue, context.sku);
    const quantity = state?.quantity ?? null;
    const busy = controlBusy(state);
    if (quantity !== last || busy) {
      last = quantity;
      since = Date.now();
    }
    if (quantity === expected && !busy && Date.now() - since >= context.settleMs) return quantity;
    if (Date.now() >= context.deadline) return quantity;
    await pause(Math.min(context.pollMs, context.deadline - Date.now()));
  }
}

function raiseClickAllowed(element: Element | null, scope: Element): element is HTMLElement {
  if (!element || !scope.contains(element) || element.closest("a[href]")
    || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
  if (["id", "name", "data-test", "data-testid"].some((name) => RAISE_FORBIDDEN_ATTRIBUTE.test(element.getAttribute(name) || ""))) return false;
  return ![element.getAttribute("aria-label"), element.getAttribute("title"), String(element.textContent || "").slice(0, 200)]
    .some((label) => RAISE_FORBIDDEN_LABEL.test(String(label || "")));
}

function raiseOutcome(context: RaiseContext, reached: number | null, limitHit: boolean, storeLimit: number | null): TargetCartQuantityRaise {
  if (reached === null) return { ok: false, reason: "cart_unverified", storeLimit };
  // A limit the line shows now (a "Limit N" message, a disabled "+") explains a stop.
  const shown = lineState(context.documentValue, context.sku)?.control?.storeLimit ?? null;
  if (shown !== null && shown <= reached) {
    limitHit = true;
    storeLimit = lowerLimit(storeLimit, shown);
  }
  if (reached > context.target || reached < context.start) return { ok: false, reason: "cart_delta_unverified", quantity: reached, storeLimit };
  if (reached === context.desired || reached === context.target || (limitHit && reached > context.start)) {
    return { ok: true, reason: "quantity_set", quantity: reached, storeLimit };
  }
  return { ok: false, reason: limitHit ? "quantity_limit_reached" : "quantity_unchanged", quantity: reached, storeLimit };
}

function unavailable(context: RaiseContext, storeLimit = context.control.storeLimit): TargetCartQuantityRaise {
  return { ok: false, reason: "quantity_control_unavailable", quantity: context.start, storeLimit };
}

// The only synthetic events this runner dispatches (Kevin, 2026-10-10):
// input/change on the exact cart line's own native quantity <select> or
// <input> right after its value was set, which is how the store's page reads
// a new value. Never on any other element, never any other event.
function notifyQuantityControl(control: HTMLSelectElement | HTMLInputElement, type: "input" | "change"): void {
  const view = control.ownerDocument.defaultView;
  if (view) control.dispatchEvent(new view.Event(type, { bubbles: true }));
}

function setNativeValue(control: HTMLSelectElement | HTMLInputElement, value: string): boolean {
  const view = control.ownerDocument.defaultView;
  const prototype = control.tagName === "SELECT" ? view?.HTMLSelectElement.prototype
    : control.tagName === "INPUT" ? view?.HTMLInputElement.prototype : undefined;
  const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, "value")?.set : undefined;
  if (!setter) return false;
  setter.call(control, value);
  return control.value === value;
}

async function raiseNativeControl(context: RaiseContext): Promise<TargetCartQuantityRaise> {
  const element = context.control.control;
  if (!["SELECT", "INPUT"].includes(element.tagName) || !context.line.contains(element)
    || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true"
    || element.hasAttribute("readonly")) return unavailable(context);
  const field = element as HTMLSelectElement | HTMLInputElement;
  let value = String(context.desired);
  if (field.tagName === "SELECT") {
    const options = [...(field as HTMLSelectElement).options]
      .filter((option) => !option.disabled && targetCartOptionQuantity(option) === context.desired);
    if (options.length !== 1 || !options[0]) return unavailable(context);
    value = options[0].value;
  } else {
    field.focus();
  }
  if (!setNativeValue(field, value)) return unavailable(context);
  notifyQuantityControl(field, "input");
  notifyQuantityControl(field, "change");
  if (field.tagName === "INPUT") field.blur();
  return raiseOutcome(context, await settledQuantity(context, context.desired), false, context.control.storeLimit);
}

/** The listbox a quantity dropdown opened: one it names (aria-controls/aria-owns), one labelled by it, or one inside the line. */
function linkedListbox(trigger: Element, line: Element): Element | null {
  const documentValue = trigger.ownerDocument;
  const named = `${trigger.getAttribute("aria-controls") || ""} ${trigger.getAttribute("aria-owns") || ""}`
    .split(/\s+/).filter(Boolean)
    .map((id) => documentValue.getElementById(id))
    .map((element) => element?.getAttribute("role") === "listbox" ? element
      : element?.querySelectorAll("[role='listbox']").length === 1 ? element.querySelector("[role='listbox']") : null);
  const id = trigger.getAttribute("id");
  const labelled = id ? [...documentValue.querySelectorAll("[role='listbox'][aria-labelledby]")]
    .filter((listbox) => String(listbox.getAttribute("aria-labelledby")).split(/\s+/).includes(id)) : [];
  const candidates = [...new Set([...named, ...labelled, ...line.querySelectorAll("[role='listbox']")])]
    .filter((listbox): listbox is Element => Boolean(listbox) && targetElementVisible(listbox));
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

async function raiseDropdown(context: RaiseContext): Promise<TargetCartQuantityRaise> {
  const trigger = context.control.control;
  if (!raiseClickAllowed(trigger, context.line)) return unavailable(context);
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  const close = (): void => {
    if (trigger.isConnected && trigger.getAttribute("aria-expanded") === "true" && raiseClickAllowed(trigger, context.line)) trigger.click();
  };
  const until = Math.min(context.deadline, Date.now() + RAISE_LISTBOX_WAIT_MS);
  let listbox = linkedListbox(trigger, context.line);
  while (!listbox && Date.now() < until) {
    await pause(Math.min(context.pollMs, until - Date.now()));
    listbox = linkedListbox(trigger, context.line);
  }
  if (!listbox) {
    close();
    return unavailable(context);
  }
  const options = [...listbox.querySelectorAll("[role='option']")]
    .filter((option) => targetElementVisible(option))
    .map((option) => ({ option, quantity: targetCartOptionQuantity(option) }))
    .filter((entry): entry is { option: Element; quantity: number } => entry.quantity !== null);
  if (!options.length) {
    close();
    return unavailable(context);
  }
  // The dropdown's highest number is the most the store lets this line hold.
  const storeLimit = lowerLimit(context.control.storeLimit, Math.max(...options.map((entry) => entry.quantity)));
  const desired = Math.min(context.target, storeLimit ?? context.target);
  if (desired <= context.start) {
    close();
    return { ok: false, reason: "quantity_limit_reached", quantity: context.start, storeLimit };
  }
  const choices = options.filter((entry) => entry.quantity === desired);
  const choice = choices.length === 1 ? choices[0]?.option ?? null : null;
  if (!raiseClickAllowed(choice, listbox)) {
    close();
    return unavailable(context, storeLimit);
  }
  choice.click();
  const raised = { ...context, desired };
  return raiseOutcome(raised, await settledQuantity(raised, desired), false, storeLimit);
}

async function raiseStepper(context: RaiseContext): Promise<TargetCartQuantityRaise> {
  let reached = context.start;
  let storeLimit = context.control.storeLimit;
  let limitHit = false;
  while (reached < context.desired && Date.now() < context.deadline) {
    const state = lineState(context.documentValue, context.sku);
    const control = state?.control;
    if (!state || control?.kind !== "stepper" || control.quantity !== reached) {
      return raiseOutcome(context, control?.quantity ?? null, false, storeLimit);
    }
    storeLimit = lowerLimit(storeLimit, control.storeLimit);
    const increase = control.increase;
    if ((storeLimit !== null && reached >= storeLimit) || (increase && cartControlDisabled(increase))) {
      storeLimit = lowerLimit(storeLimit, reached);
      limitHit = true;
      break;
    }
    if (!raiseClickAllowed(increase, state.line)) return reached > context.start
      ? raiseOutcome(context, reached, false, storeLimit) : unavailable(context, storeLimit);
    increase.click();
    const before = reached;
    const next = await waitForLine(context, Math.min(context.deadline, Date.now() + context.stepWaitMs),
      (candidate) => candidate?.quantity !== null && candidate?.quantity !== undefined && candidate.quantity !== before);
    const quantity = next?.quantity ?? null;
    if (quantity === null || quantity === before) {
      // Nothing moved. A disabled "+" or a limit message now says why.
      const after = next?.control;
      if ((after?.storeLimit !== null && after?.storeLimit !== undefined && after.storeLimit <= before)
        || (after?.increase && cartControlDisabled(after.increase))) {
        storeLimit = lowerLimit(storeLimit, after?.storeLimit, before);
        limitHit = true;
      }
      break;
    }
    reached = quantity;
    if (reached !== before + 1) break;
  }
  const settled = reached > context.start ? await settledQuantity(context, reached) : reached;
  return raiseOutcome(context, settled, limitHit, storeLimit);
}

function cartControlDisabled(element: Element): boolean {
  return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}

function raiseInputValid(job: TargetAddJob, input: TargetCartQuantityInput): boolean {
  const baseline = input?.baselineQuantity;
  const current = input?.currentQuantity;
  const target = input?.targetQuantity;
  return Number.isInteger(baseline) && Number.isInteger(current) && Number.isInteger(target)
    && baseline >= 0 && current > baseline && current <= target && target <= 99
    && target - baseline <= job.quantity;
}

/**
 * On Target's cart page after a verified add: raises the job item's line from
 * `currentQuantity` toward `targetQuantity` with that line's own quantity
 * control, never past the store's limit (the control's highest choice, a
 * disabled "+", or "Limit N" text in the line). It never lowers a line,
 * touches another line, removes anything or opens checkout, and it finishes
 * within about 8 seconds. The caller re-reads the whole cart afterwards and
 * proves the exact delta against the pre-add baseline.
 */
export async function raiseTargetCartQuantity(
  documentValue: Document,
  urlValue: string,
  job: TargetAddJob,
  input: TargetCartQuantityInput,
  timing: TargetCartQuantityTiming = {}
): Promise<TargetCartQuantityRaise> {
  const deadline = Date.now() + boundedMs(timing.maxMs, RAISE_MAX_MS);
  if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  const invalid = targetJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  if (!raiseInputValid(job, input)) return { ok: false, reason: "quantity_invalid" };
  if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const probe = {
    documentValue,
    sku: job.retailerSku,
    pollMs: Math.max(1, boundedMs(timing.pollMs, RAISE_POLL_MS))
  };
  const initial = await waitForLine(probe, Math.min(deadline, Date.now() + RAISE_LINE_WAIT_MS),
    (state) => state !== null && state.quantity !== null);
  if (!initial) return { ok: false, reason: "quantity_line_ambiguous" };
  const control = initial.control;
  if (!control || control.quantity === null) return { ok: false, reason: "quantity_control_unavailable" };
  const start = control.quantity;
  const storeLimit = control.storeLimit;
  if (start !== input.currentQuantity) return { ok: false, reason: "cart_delta_unverified", quantity: start, storeLimit };
  const desired = Math.min(input.targetQuantity, storeLimit ?? input.targetQuantity);
  if (desired <= start) {
    return start >= input.targetQuantity
      ? { ok: true, reason: "quantity_set", quantity: start, storeLimit }
      : { ok: false, reason: "quantity_limit_reached", quantity: start, storeLimit };
  }
  const context: RaiseContext = {
    ...probe,
    line: initial.line,
    control,
    start,
    desired,
    target: input.targetQuantity,
    deadline,
    stepWaitMs: boundedMs(timing.stepWaitMs, RAISE_STEP_WAIT_MS),
    settleMs: boundedMs(timing.settleMs, RAISE_SETTLE_MS)
  };
  if (control.kind === "select" || control.kind === "input") return raiseNativeControl(context);
  if (control.kind === "dropdown") return raiseDropdown(context);
  if (control.kind === "stepper") return raiseStepper(context);
  return unavailable(context);
}

Object.defineProperty(globalThis, "YoinkTargetAction", {
  value: Object.freeze({
    abandonTargetAdd,
    commitTargetAdd,
    inspectTargetCartBaseline,
    prepareTargetAdd,
    raiseTargetCartQuantity,
    rehearseTargetAdd,
    verifyTargetAddedCart
  }),
  configurable: true
});
