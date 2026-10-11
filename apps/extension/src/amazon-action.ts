import {AMAZON_APPROVED_TEST,amazonApprovedTestReason} from "../../../packages/contracts/src/amazon-approved-test.js";
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
  amazonAddBinding,
  amazonInteractiveBlock,
  amazonPageKind,
  amazonQuantityPlan,
  amazonQuantityShown,
  amazonSecurityChallenge,
  observeAmazonCart,
  observeAmazonOffer
} from "../../../packages/browser-adapters/src/amazon.js";
import { AMAZON_ADD_ADAPTER_VERSION, type AdapterEnvironment } from "../../../packages/contracts/src/index.js";
import { guardedCartQuantity } from "../../../packages/contracts/src/official-msrp.js";

export interface AmazonAddJob extends BrowserActionContract {
  adapterVersion: typeof AMAZON_ADD_ADAPTER_VERSION;
}

/** What one Add puts in the cart (spec: requested, store limit, add, total to raise to). */
export interface AmazonAddQuantity {
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
  offerListingId: string;
  proof: LiveOfferProof;
  document: Document;
  jobSnapshot: string;
  quantity: AmazonAddQuantity;
  /** The buy-box dropdown this preparation set to `quantity.add` (only when add > 1). */
  quantityControl: HTMLSelectElement | null;
}

export type AmazonAddPreparation =
  | { ok: true; reason: "verified"; authorizationId: string; proof: LiveOfferProof; quantity: AmazonAddQuantity }
  | { ok: false; reason: string };

export type AmazonAddRehearsal =
  | { ok: true; reason: "verified"; proof: LiveOfferProof; wouldClick: true; quantity: AmazonAddQuantity }
  | { ok: false; reason: string };

export type AmazonAddCommit =
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

function amazonJobReason(job: AmazonAddJob): string {
  if (job?.adapterVersion !== AMAZON_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
  if (job?.retailerId !== "amazon" || job?.action !== "add_to_cart") return "unsupported_action";
  if (!guardedCartQuantity(job?.quantity) || (job.approvedTest && job.quantity !== 1)) return "quantity_not_supported";
  if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
  if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
  return "";
}

// A page the runner could not bind (no Add button or offer found) is not proof
// the item is sold out; "out of stock" is kept for a page that says so.
function honestReason(reason: string, observation: LiveOfferObservation): string {
  return reason === "out_of_stock" && observation.availability === "unknown" ? "add_control_unavailable" : reason;
}

/**
 * Sets Amazon's buy-box quantity dropdown the way a shopper's pick does: the
 * native value, then bubbling input and change events (Amazon's own handlers
 * listen for change and update the drawn dropdown and its form fields).
 * Only an enabled numbered option is ever chosen.
 */
function setAmazonQuantity(select: HTMLSelectElement, add: number): boolean {
  const value = String(add);
  if (select.disabled || ![...select.options].some((option) => option.value === value && !option.disabled)) return false;
  if (select.value === value) return true;
  const view = select.ownerDocument.defaultView;
  const setter = view ? Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, "value")?.set : undefined;
  if (setter) setter.call(select, value);
  else select.value = value;
  const EventType = view?.Event ?? Event;
  select.dispatchEvent(new EventType("input", { bubbles: true }));
  select.dispatchEvent(new EventType("change", { bubbles: true }));
  return select.value === value;
}

function quantityResult(plan: AmazonAddQuantity): AmazonAddQuantity {
  return { requested: plan.requested, storeLimit: plan.storeLimit, add: plan.add, raiseTo: plan.raiseTo };
}

function approvedTestPageReason(documentValue:Document,job:AmazonAddJob,now:number):string {
  if(!job.approvedTest)return "";
  const invalid=amazonApprovedTestReason(job,now);if(invalid)return invalid;
  const clean=(s:string)=>s.replace(/\s+/g," ").trim();
  if(clean(documentValue.querySelector("#productTitle")?.textContent||"")!==AMAZON_APPROVED_TEST.title)return "approved_amazon_test_variant_changed";
  const shipper=documentValue.querySelector("#merchantInfoFeature_feature_div");
  if(!shipper||shipper.closest('[hidden],[aria-hidden="true"]')||!/Shipper\s*\/\s*Seller Amazon\.com Amazon\.com/.test(clean(shipper.textContent||"")))return "approved_amazon_test_shipper_unverified";
  for(let e:Element|null=shipper;e;e=e.parentElement){
    const style=documentValue.defaultView?.getComputedStyle(e);
    if(style&&(style.display==="none"||style.visibility==="hidden"||style.opacity==="0"))return "approved_amazon_test_shipper_unverified";
  }
  const button=documentValue.querySelector<HTMLInputElement>("#add-to-cart-button"),form=button?.form;
  if(!button||button.name!=="submit.add-to-cart"||form?.querySelector<HTMLInputElement>('[name="ASIN"]')?.value!==AMAZON_APPROVED_TEST.retailerSku)return "approved_amazon_test_add_form_changed";
  if([...documentValue.querySelectorAll<HTMLInputElement>('[name="quantity"],#quantity')].some(e=>e.value&&e.value!=="1")||form.querySelector<HTMLInputElement>('[name="purchaseMode"]')?.value)return "approved_amazon_test_quantity_or_mode_changed";
  return "";
}

function authorizationId(now: number): string {
  sequence += 1;
  return `amazon_add_${now.toString(36)}_${sequence.toString(36)}`;
}

export function abandonAmazonAdd(value: string): boolean {
  if (!pending || pending.id !== value) return false;
  pending = null;
  return true;
}

type BoundAdd =
  | { ok: true; control: Element; offerListingId: string; proof: LiveOfferProof; quantity: AmazonAddQuantity; quantityControl: HTMLSelectElement | null }
  | { ok: false; reason: string };

/**
 * Verifies the live offer and binds its Add control. With `setQuantity`, a
 * job for more than one sets the buy-box dropdown to the planned add first;
 * without it (rehearsal) the page is only read and must still show 1.
 */
function bindAmazonAdd(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  now: number,
  environment: AdapterEnvironment | undefined,
  setQuantity: boolean
): BoundAdd {
  const testReason=approvedTestPageReason(documentValue,job,now);
  if(testReason)return {ok:false,reason:testReason};
  const invalid = amazonJobReason(job);
  if (invalid) return { ok: false, reason: invalid };
  const observation = observeAmazonOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ok: false, reason: honestReason(verified.reason, observation) };
  // One binding scan: the quantity is read separately, after any set.
  const binding = amazonAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment, environment, null);
  if (!binding?.offerListingId) return { ok: false, reason: "offer_id_missing_or_ambiguous" };
  const plan = amazonQuantityPlan(binding.control, job.quantity);
  if ("reason" in plan) return { ok: false, reason: plan.reason };
  const setting = setQuantity && plan.add > 1;
  if (setting && (!plan.select || !setAmazonQuantity(plan.select, plan.add))) return { ok: false, reason: "quantity_control_unavailable" };
  // The dropdown, the form field Amazon keeps beside it and the drawn
  // dropdown must all show the add (one unit: every buy-box control reads 1).
  if (!amazonQuantityShown(binding, setting ? plan.add : 1, environment)) {
    return { ok: false, reason: setting ? "quantity_unverified" : "offer_id_missing_or_ambiguous" };
  }
  return {
    ok: true,
    control: binding.control,
    offerListingId: binding.offerListingId,
    proof: verified.proof,
    quantity: quantityResult(plan),
    quantityControl: setting ? plan.select : null
  };
}

export function prepareAmazonAdd(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): AmazonAddPreparation {
  pending = null;
  const bound = bindAmazonAdd(documentValue, urlValue, job, now, environment, job.validationMode !== "rehearsal");
  if (!bound.ok) return bound;
  const id = authorizationId(now);
  pending = {
    id,
    jobId: job.jobId,
    createdAt: now,
    control: bound.control,
    offerListingId: bound.offerListingId,
    proof: bound.proof,
    document: documentValue,
    jobSnapshot: JSON.stringify(job),
    quantity: bound.quantity,
    quantityControl: bound.quantityControl
  };
  return { ok: true, reason: "verified", authorizationId: id, proof: bound.proof, quantity: bound.quantity };
}

/** Read-only: never sets the quantity or clicks. It reports the add it would make. */
export function rehearseAmazonAdd(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  now = Date.now(),
  environment?: AdapterEnvironment
): AmazonAddRehearsal {
  const prepared = prepareAmazonAdd(documentValue, urlValue, { ...job, validationMode: "rehearsal" }, now, environment);
  if (!prepared.ok) return prepared;
  abandonAmazonAdd(prepared.authorizationId);
  return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true, quantity: prepared.quantity };
}

export function commitAmazonAdd(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  value: string,
  now = Date.now(),
  environment?: AdapterEnvironment
): AmazonAddCommit {
  const authorization = pending;
  pending = null;
  const testReason=approvedTestPageReason(documentValue,job,now);
  if(testReason)return {ok:false,reason:testReason,clicked:false};
  if (job.validationMode === "rehearsal" || (!job.officialMsrp && !job.approvedTest)) {
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
  const invalid = amazonJobReason(job);
  if (invalid) return { ok: false, reason: invalid, clicked: false };
  const observation = observeAmazonOffer(
    documentValue,
    urlValue,
    job.retailerSku,
    job.fulfillment,
    new Date(now).toISOString(),
    environment
  );
  const verified = verifyLiveOffer(job, observation, now);
  if (!verified.ok) return { ok: false, reason: honestReason(verified.reason, observation), clicked: false };
  // A dropdown set for more than one must still show exactly that amount:
  // the click submits it.
  const add = authorization.quantity.add;
  const select = authorization.quantityControl;
  if (add > 1 && (!select || !select.isConnected || select.disabled || select.value !== String(add)
    || select.closest("form") !== authorization.control.closest("form"))) {
    return { ok: false, reason: "quantity_changed", clicked: false };
  }
  const binding = amazonAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment, environment, null);
  if (!binding || binding.control !== authorization.control) {
    traceElement(environment, "authorized", authorization.control);
    traceElement(environment, "rebound", binding?.control || null);
    return { ok: false, reason: "add_control_changed", clicked: false };
  }
  if (!amazonQuantityShown(binding, add, environment)) {
    return { ok: false, reason: add > 1 ? "quantity_changed" : "add_control_changed", clicked: false };
  }
  if (binding.offerListingId !== authorization.offerListingId) {
    traceElement(environment, "authorized", authorization.control);
    traceElement(environment, "rebound", binding.control);
    return { ok: false, reason: "offer_binding_changed", clicked: false };
  }
  try {
    (binding.control as HTMLElement).click();
    return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
  } catch {
    return { ok: false, reason: "click_failed", clicked: false };
  }
}

function amazonCartUrl(value: string): boolean {
  return amazonPageKind(value) === "cart";
}

export function inspectAmazonCartBaseline(
  documentValue: Document,
  urlValue: string,
  now = Date.now()
) {
  if (!amazonCartUrl(urlValue)) return { ok: false as const, reason: "cart_page_unverified" };
  if (amazonSecurityChallenge(documentValue) || amazonInteractiveBlock(documentValue, urlValue)) {
    return { ok: false as const, reason: "manual_action_required" };
  }
  return captureCartBaseline(
    "amazon",
    observeAmazonCart(documentValue, new Date(now).toISOString()),
    now
  );
}

export function verifyAmazonAddedCart(
  documentValue: Document,
  urlValue: string,
  job: AmazonAddJob,
  proof: LiveOfferProof,
  baseline: CartBaselineProof,
  now = Date.now()
): { ok: true; reason: "verified"; proof: CartProof; cartBaseline?: CartBaselineProof } | { ok: false; reason: string } {
  if (!amazonCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
  if (amazonSecurityChallenge(documentValue) || amazonInteractiveBlock(documentValue, urlValue)) {
    return { ok: false, reason: "manual_action_required" };
  }
  const inventory = observeAmazonCart(documentValue, new Date(now).toISOString());
  const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
  if (!verified.ok) return verified;
  const nextBaseline = captureCartBaseline("amazon", inventory, now);
  return {
    ...verified,
    ...(nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {})
  };
}

Object.defineProperty(globalThis, "YoinkAmazonAction", {
  value: Object.freeze({
    abandonAmazonAdd,
    commitAmazonAdd,
    inspectAmazonCartBaseline,
    prepareAmazonAdd,
    rehearseAmazonAdd,
    verifyAmazonAddedCart
  }),
  configurable: true
});
