import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type CartInventoryEvidence,
  type CheckoutEvidence,
  type LiveOfferObservation
} from "../../browser-safety/src/index.js";
import {
  TARGET_OBSERVER_VERSION,
  type AdapterEnvironment,
  type AdapterTraceEntry,
  type Fulfillment,
  type RetailerAdapterLayoutEvidence,
  type SellerType
} from "../../contracts/src/index.js";
import { parseQuantityText, quantityIsOne, readControlQuantity } from "./dom.js";
import { selectedOfferScope } from "./selected-offer.js";
import { selectorsFor } from "./selector-packs.js";

export { TARGET_OBSERVER_VERSION };

let activeAdapterEnvironment: AdapterEnvironment | undefined;

function withAdapterEnvironment<T>(environment: AdapterEnvironment, work: () => T): T {
  const previous = activeAdapterEnvironment;
  activeAdapterEnvironment = environment;
  try {
    return work();
  } finally {
    activeAdapterEnvironment = previous;
  }
}

function recordTrace(entry: AdapterTraceEntry): void {
  activeAdapterEnvironment?.trace?.record(entry);
}

function selectorTrace(step: AdapterTraceEntry["step"], root: ParentNode, selector: string): void {
  if (!activeAdapterEnvironment?.trace) return;
  let matches: Element[] = [];
  try {
    matches = [...root.querySelectorAll(selector)];
  } catch {
    recordTrace({ step, selector, matched: 0, visible: 0, scoped: 0, reject: "pattern_mismatch" });
    return;
  }
  const visibleMatches = matches.filter(visible);
  recordTrace({
    step,
    selector,
    matched: matches.length,
    visible: visibleMatches.length,
    scoped: root.nodeType === 9 ? 0 : visibleMatches.length,
    ...(matches.length > 0 && visibleMatches.length === 0 ? { reject: "not_visible" } : {})
  });
}

function selectorListTrace(step: AdapterTraceEntry["step"], root: ParentNode, selectors: readonly string[]): void {
  for (const selector of selectors) selectorTrace(step, root, selector);
}

export interface TargetMissionIdentity {
  retailerSku: string;
  quantity: number;
  fulfillment: Fulfillment;
}

export interface TargetAddBinding {
  control: Element | null;
  fulfillmentControl: Element | null;
  fulfillment: "shipping" | "pickup" | "unknown";
  selectionRequired: boolean;
  offerRoot: Element | null;
}

export type FingerprintSigner = (values: string[]) => Promise<string>;

const MARKETPLACE_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+(?!target\b)|sold\s+by\s+(?!target\b)|target\s*plus|marketplace\s+seller/i;
const FIRST_PARTY_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+target\b|sold\s+by\s+target\b/i;
const TARGET_PRICE_SELECTORS = selectorsFor("target", "price");
const TARGET_CURRENT_PRICE_SELECTORS = TARGET_PRICE_SELECTORS.slice(0, -1);
const TARGET_PRICE_MODULE_SELECTOR = TARGET_PRICE_SELECTORS.at(-1) ?? "meta:not(*)";
const TARGET_ADD_CONTROL_SELECTORS = selectorsFor("target", "addControl");
const TARGET_SELLER_SELECTORS = selectorsFor("target", "seller");
const TARGET_AVAILABILITY_SELECTORS = selectorsFor("target", "availability");
const TARGET_QUANTITY_SELECTORS = selectorsFor("target", "quantity");
const TARGET_PRIMARY_SCOPE_SELECTOR = selectorsFor("target", "primaryScope").join(", ");
const TARGET_RECOMMENDATION_SCOPE_SELECTOR = selectorsFor("target", "merchandisingScope").join(", ");
const TARGET_OFFER_INPUT_SELECTOR = selectorsFor("target", "offerInput").join(", ");

function text(value: Element | Document | null | undefined, maximum = 2_000): string {
  return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function observableText(
  value: Element | Document | null | undefined,
  maximum = 2_000,
  skip: (element: Element) => boolean = () => false
): string {
  if (!value || maximum < 1) return "";
  const fragments: string[] = [];
  let length = 0;
  const append = (candidate: unknown): void => {
    if (length >= maximum) return;
    const fragment = String(candidate || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!fragment) return;
    const bounded = fragment.slice(0, maximum - length);
    fragments.push(bounded);
    length += bounded.length + 1;
  };
  const visit = (node: Node): void => {
    if (length >= maximum) return;
    if (node.nodeType === 3) {
      append(node.textContent);
      return;
    }
    if (node.nodeType === 1) {
      const element = node as Element;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || !visible(element) || skip(element)) return;
    }
    for (const child of [...node.childNodes]) visit(child);
  };
  visit(value);
  return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function visible(element: Element | null): element is Element {
  if (!element) return false;
  if (activeAdapterEnvironment?.isVisible) {
    try {
      return activeAdapterEnvironment.isVisible(element);
    } catch {
      return false;
    }
  }
  const view = element.ownerDocument.defaultView;
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
    const inlineStyle = current.getAttribute("style");
    const style = inlineStyle ? inlineStyle.replace(/\s+/g, "").toLocaleLowerCase("en-US") : "";
    if (/(?:^|;)display:none(?:;|$)|(?:^|;)visibility:hidden(?:;|$)/.test(style)) return false;
    const computed = view?.getComputedStyle?.(current);
    if (computed?.display === "none" || computed?.visibility === "hidden") return false;
    current = current.parentElement;
  }
  return true;
}

function actionable(element: Element | null): element is Element {
  return visible(element)
    && !element.hasAttribute("disabled")
    && element.getAttribute("aria-disabled") !== "true"
    && !/sold out|out of stock|unavailable/i.test(text(element, 300));
}

function formControlChecked(element: Element): boolean {
  return element.tagName === "INPUT" && Boolean((element as HTMLInputElement).checked);
}

function queryVisible(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const match = [...root.querySelectorAll(selector)].find(visible);
    if (match) return match;
  }
  return null;
}

export function extractTargetSku(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "target.com" || url.hostname.endsWith(".target.com"))) return "";
    const pathMatch = url.pathname.match(/(?:^|\/)A-(\d{6,})(?:\/|$)/i);
    if (pathMatch?.[1]) return pathMatch[1];
    for (const key of ["preselect", "tcin"]) {
      const value = String(url.searchParams.get(key) || "");
      if (/^\d{6,}$/.test(value)) return value;
    }
    return "";
  } catch {
    return "";
  }
}

export function parseUsPrice(value: unknown): number | null {
  const source = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!source || /(?:C|CA|MX|SG|HK|AU|A|R)\s*\$/i.test(source)) return null;
  const match = source.match(/(?:US\s*)?\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i)
    ?? (/^[0-9]{1,7}(?:\.[0-9]{1,2})?$/.test(source) ? [source, source] : null);
  if (!match?.[1]) return null;
  const dollars = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
}

function readPrice(root: ParentNode, selectors: readonly string[]): number | null {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (!visible(element) || recommendationControl(element)) continue;
      for (const candidate of [element.getAttribute("content"), element.getAttribute("value"), text(element, 300)]) {
        const price = parseUsPrice(candidate);
        if (price !== null) return price;
      }
    }
  }
  return null;
}

function adaptiveTargetPrice(root: ParentNode, selectors: readonly string[]): number | null {
  selectorListTrace("price", root, selectors);
  selectorTrace("price", root, TARGET_PRICE_MODULE_SELECTOR);
  const packaged = readPrice(root, selectors);
  if (packaged !== null) return packaged;
  const modulePrices = [...root.querySelectorAll(TARGET_PRICE_MODULE_SELECTOR)]
    .filter((element) => visible(element) && !recommendationControl(element))
    .map((element) => readPrice(element, selectors) ?? parseUsPrice(observableText(element, 1_200)))
    .filter((price): price is number => price !== null);
  const uniqueModulePrices = [...new Set(modulePrices)];
  if (uniqueModulePrices.length === 1) return uniqueModulePrices[0] ?? null;
  const candidates = [...root.querySelectorAll("[data-test], [data-testid], [itemprop], [aria-label]")]
    .slice(0, 500)
    .filter((element) => visible(element) && !recommendationControl(element))
    .filter((element) => /(?:price|amount)/i.test([
      element.getAttribute("data-test"),
      element.getAttribute("data-testid"),
      element.getAttribute("itemprop"),
      element.getAttribute("aria-label")
    ].filter(Boolean).join(" ")))
    .map((element) => ({
      element,
      price: [element.getAttribute("content"), element.getAttribute("value"), text(element, 300)]
        .map(parseUsPrice).find((value) => value !== null) ?? null
    }))
    .filter((entry): entry is { element: Element; price: number } => entry.price !== null);
  return candidates.length === 1 && candidates[0] ? candidates[0].price : null;
}

export function targetSecurityChallenge(document: Document): boolean {
  return Boolean(queryVisible(document, [
    "iframe[src*='captcha' i]",
    "[data-test*='captcha' i]",
    "[data-testid*='captcha' i]",
    "[id*='captcha' i]"
  ])) || /verify you are human|unusual traffic|security challenge/i.test(observableText(document.body, 50_000));
}

export function targetInteractiveBlock(
  document: Document,
  environment?: AdapterEnvironment
): LiveOfferObservation["interactiveBlock"] {
  if (environment) return withAdapterEnvironment(environment, () => targetInteractiveBlock(document));
  selectorListTrace("interactive_block", document, [
    "input[autocomplete='one-time-code']", "input[name*='otp' i]",
    "[role='dialog']", "dialog[open]",
    "form[action*='login' i] input[type='password']", "input[autocomplete='current-password']"
  ]);
  const visibleText = observableText(document.body, 80_000);
  if (queryVisible(document, ["input[autocomplete='one-time-code']", "input[name*='otp' i]"])) return "mfa";
  const dialog = queryVisible(document, ["[role='dialog']", "dialog[open]"]);
  const dialogText = text(dialog, 10_000);
  if (dialog && /choose|select|set/.test(dialogText.toLocaleLowerCase("en-US")) && /pickup store|my store|location/.test(dialogText.toLocaleLowerCase("en-US"))) return "location";
  if (dialog && /target circle 360|membership|free trial/i.test(dialogText)) return "membership";
  if (dialog && /something went wrong|please try again in a bit|loading screen/i.test(dialogText)) return "unknown";
  if (queryVisible(document, ["form[action*='login' i] input[type='password']", "input[autocomplete='current-password']"])) return "auth";
  if (/you(?:’|')?re in line|virtual queue|waiting room/i.test(visibleText)) return "queue";
  if (targetSecurityChallenge(document)) return "unknown";
  return "";
}

export function targetPageKind(urlValue: string): LiveOfferObservation["pageKind"] {
  try {
    const path = new URL(urlValue).pathname.toLocaleLowerCase("en-US");
    if (/order-confirm|thank.?you|confirmation/.test(path)) return "confirmation";
    if (/\/(?:login|signin|sign-in|verify|challenge|mfa|otp)(?:\/|$)|\/account(?:\/|$)|\/co-(?:login|signin)(?:\/|$)/.test(path)) return "auth";
    if (/checkout|co-(?:delivery|fulfillment|pickup|payment|review)/.test(path)) return "checkout";
    if (/\/(?:cart|co-cart)(?:\/|$)/.test(path)) return "cart";
    return extractTargetSku(urlValue) ? "product" : "other";
  } catch {
    return "other";
  }
}

const TARGET_FULFILLMENT_ROOT_SELECTOR = selectorsFor("target", "fulfillmentRoot").join(", ");
const TARGET_FULFILLMENT_TILE_SELECTOR = selectorsFor("target", "fulfillmentTile").join(", ");
const TARGET_FULFILLMENT_UNAVAILABLE_PATTERN = /\b(?:not available|unavailable|out of stock|sold out|loading|check availability|choose (?:a |your )?(?:store|location|address)|select (?:a |your )?(?:store|location|address)|set (?:a |your )?(?:store|location|address))\b/i;
const TARGET_FULFILLMENT_AVAILABLE_PATTERN = /\b(?:arrives?|ready|available|get it|same[ -]?day|today|tomorrow|within|deliver(?:ed|y) by)\b/i;

function fulfillmentKind(element: Element): "shipping" | "pickup" | "unknown" {
  const marker = [
    element.getAttribute("data-test"),
    element.getAttribute("data-fulfillment"),
    element.getAttribute("id")
  ].filter(Boolean).join(" ");
  if (/shipping|shipit|delivery|same[ -]?day/i.test(marker)) return "shipping";
  if (/pickup|pick-up/i.test(marker)) return "pickup";
  const label = `${element.getAttribute("aria-label") || ""} ${text(element, 300)}`;
  if (/^\s*(?:ship it|shipping|delivery|same[ -]?day delivery)\b/i.test(label)) return "shipping";
  if (/^\s*(?:pick it up|pickup|pick-up)\b/i.test(label)) return "pickup";
  return "unknown";
}

function fulfillmentTileSelected(element: Element): boolean {
  const ariaLabel = String(element.getAttribute("aria-label") || "");
  return element.getAttribute("aria-selected") === "true"
    || element.getAttribute("aria-checked") === "true"
    || element.getAttribute("aria-pressed") === "true"
    || element.getAttribute("data-selected") === "true"
    || (/\bselected\b/i.test(ariaLabel) && !/\bunselected\b/i.test(ariaLabel))
    || /(?:^|[_\s-])(?:is-)?active(?:[_\s-]|$)/i.test(String(element.getAttribute("class") || ""));
}

function fulfillmentTileAvailable(element: Element): boolean {
  if (!visible(element) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
  const evidence = `${element.getAttribute("aria-label") || ""} ${text(element, 500)}`;
  if (TARGET_FULFILLMENT_UNAVAILABLE_PATTERN.test(evidence)) return false;
  return fulfillmentTileSelected(element) || TARGET_FULFILLMENT_AVAILABLE_PATTERN.test(evidence);
}

function controlFulfillment(control: Element, root: Element | Document): "shipping" | "pickup" | "unknown" {
  selectorTrace("fulfillment", root, TARGET_FULFILLMENT_TILE_SELECTOR);
  selectorListTrace("fulfillment", root, ["[aria-selected='true']", "[data-selected='true']", "input:checked"]);
  const own = fulfillmentKind(control);
  const selectedTiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)]
    .filter((element) => visible(element) && fulfillmentKind(element) !== "unknown" && fulfillmentTileSelected(element));
  if (selectedTiles.length === 1 && selectedTiles[0]) {
    const selected = fulfillmentKind(selectedTiles[0]);
    return own !== "unknown" && own !== selected ? "unknown" : selected;
  }
  if (selectedTiles.length > 1) return "unknown";
  if (own !== "unknown") return own;
  const selected = [...root.querySelectorAll("[aria-selected='true'], [data-selected='true'], input:checked")]
    .filter((element) => visible(element))
    .map((element) => text(element.closest("label, [role='tab'], [data-test*='fulfillment' i]") || element, 500));
  const shipping = selected.some((value) => /ship it|shipping|delivery/i.test(value));
  const pickup = selected.some((value) => /pick it up|pickup|pick-up/i.test(value));
  return shipping === pickup ? "unknown" : shipping ? "shipping" : "pickup";
}

function directControlFulfillment(control: Element, root: Element): "shipping" | "pickup" | "unknown" {
  const own = fulfillmentKind(control);
  if (own !== "unknown") return own;
  const methodScope = control.closest([
    "[data-test*='AddToCart/Fulfillment/Shipping' i]",
    "[data-test*='AddToCart/Fulfillment/Delivery' i]",
    "[data-test*='AddToCart/Fulfillment/Pickup' i]",
    "[data-fulfillment]",
    "[data-fulfillment-type]"
  ].join(", "));
  return methodScope && root.contains(methodScope) ? fulfillmentKind(methodScope) : "unknown";
}

function recommendationControl(candidate: Element): boolean {
  return Boolean(candidate.closest(TARGET_RECOMMENDATION_SCOPE_SELECTOR));
}

function exactAddControls(root: ParentNode, sku: string): Element[] {
  if (!/^\d{6,}$/.test(sku)) return [];
  selectorTrace("add_control", root, `button[id='addToCartButtonOrTextIdFor${sku}']`);
  return [...root.querySelectorAll(`button[id='addToCartButtonOrTextIdFor${sku}']`)]
    .filter((candidate) => visible(candidate) && !recommendationControl(candidate));
}

// Since late September 2026 Target renders the buy button in its own
// ProductDetailAddToCart module beside the Fulfillment region, not inside it.
// Its label follows the chosen fulfillment: "Add to cart" (id carrying the
// exact TCIN) when an available method is chosen, or "Show in-stock stores"
// (id AddToCart.*) when Pickup at a store without stock is chosen. A hidden
// sticky copy of the button (aria-hidden) is never used.
const TARGET_ADD_MODULE_SELECTOR = "[data-module-type='ProductDetailAddToCart'], [data-test='module-product-detail-add-to-cart']";
const TARGET_ADD_INTENT_PATTERN = /\badd(?:\s+(?:item\s+)?to)?\s+cart\b/i;

/** Whether a control's own label says it adds to the cart. */
export function targetAddIntent(control: Element | null): boolean {
  if (!control) return false;
  return TARGET_ADD_INTENT_PATTERN.test(`${control.getAttribute("aria-label") || ""} ${text(control, 300)}`);
}

function targetAddModule(document: Document): Element | null {
  const modules = [...new Set(document.querySelectorAll(TARGET_ADD_MODULE_SELECTOR))]
    .filter((module) => visible(module) && !recommendationControl(module));
  const outermost = modules.filter((module) => !modules.some((other) => other !== module && other.contains(module)));
  return outermost.length === 1 && outermost[0] ? outermost[0] : null;
}

/**
 * The buy control of the separate add-to-cart module: the exact-TCIN button
 * when present, else (only to choose a fulfillment first) its single
 * AddToCart.* placeholder. `exact` says which one it is.
 */
function moduleAddControl(document: Document, sku: string): { control: Element; exact: boolean } | null {
  const module = targetAddModule(document);
  selectorTrace("add_control", document, TARGET_ADD_MODULE_SELECTOR);
  if (!module) return null;
  const exact = exactAddControls(module, sku);
  if (exact.length === 1 && exact[0]) return { control: exact[0], exact: true };
  if (exact.length > 1) return null;
  const placeholders = [...module.querySelectorAll("button[id^='AddToCart.'], button[data-test^='AddToCart.']")]
    .filter((candidate) => visible(candidate) && !recommendationControl(candidate));
  return placeholders.length === 1 && placeholders[0] ? { control: placeholders[0], exact: false } : null;
}

/**
 * A shipping-only Fulfillment region has no method tiles, just "Ship to
 * <zip> · Arrives by <date>". It proves shipping only when that text is
 * present and nothing in the region says the item is unavailable.
 */
function shipOnlyRegion(root: Element): "shipping" | "unknown" {
  const evidence = `${root.getAttribute("aria-label") || ""} ${observableText(root, 800)}`;
  return /\bship(?:s|ping)? to\b/i.test(evidence)
    && /\barrives?\b/i.test(evidence)
    && !TARGET_FULFILLMENT_UNAVAILABLE_PATTERN.test(evidence)
    && !/\b(?:pickup|pick it up|same[ -]?day delivery)\b/i.test(evidence)
    ? "shipping"
    : "unknown";
}

/** Whether a (re-rendered) Add control still belongs to the prepared offer. */
export function targetOfferOwnsControl(offerRoot: Element | null, control: Element | null, sku: string): boolean {
  if (!offerRoot || !control) return false;
  if (offerRoot.contains(control)) return true;
  const module = moduleAddControl(control.ownerDocument, sku);
  return Boolean(module?.exact && module.control === control);
}

function targetSkuEvidence(root: ParentNode): Set<string> {
  const skus = new Set<string>();
  const elements = [
    ...(root.nodeType === 1 ? [root as Element] : []),
    ...root.querySelectorAll(TARGET_OFFER_INPUT_SELECTOR)
  ];
  for (const element of elements) {
    const dataTcin = String(element.getAttribute("data-tcin") || "").trim();
    const idTcin = String(element.getAttribute("id") || "").match(/^addToCartButtonOrTextIdFor(\d{6,})$/)?.[1] || "";
    if (/^\d{6,}$/.test(dataTcin)) skus.add(dataTcin);
    if (idTcin) skus.add(idTcin);
  }
  return skus;
}

function semanticTargetAddControls(root: ParentNode, sku: string): Element[] {
  const skus = targetSkuEvidence(root);
  if ([...skus].some((candidate) => candidate !== sku)) return [];
  const candidates = [...root.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")]
    .filter((candidate) => visible(candidate) && !recommendationControl(candidate))
    .filter((candidate) => /\badd(?:\s+(?:item\s+)?to)?\s+cart\b/i.test([
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("name"),
      candidate.getAttribute("value"),
      candidate.getAttribute("data-test"),
      candidate.getAttribute("data-testid"),
      text(candidate, 300)
    ].filter(Boolean).join(" ")));
  recordTrace({
    step: "add_control",
    selector: "semantic:add-intent",
    matched: candidates.length,
    visible: candidates.length,
    scoped: root.nodeType === 9 ? 0 : candidates.length,
    chosen: candidates.length === 1 ? 1 : 0,
    ...(candidates.length === 1 ? {} : { reject: "ambiguous" })
  });
  return candidates.length === 1 ? candidates : [];
}

function addControls(document: Document, sku: string): Element[] {
  selectorListTrace("add_control", document, [
    `button[id='addToCartButtonOrTextIdFor${sku}']`,
    ...TARGET_ADD_CONTROL_SELECTORS
  ]);
  const candidates = [
    ...exactAddControls(document, sku),
    ...document.querySelectorAll(TARGET_ADD_CONTROL_SELECTORS.join(", "))
  ];
  return [...new Set(candidates)].filter((candidate) => {
    if (!visible(candidate)) return false;
    if (recommendationControl(candidate)) return false;
    const idSku = candidate.getAttribute("id")?.match(/^addToCartButtonOrTextIdFor(\d{6,})$/)?.[1];
    if (idSku && idSku !== sku) return false;
    const scopedSku = candidate.closest("[data-tcin]")?.getAttribute("data-tcin");
    return idSku === sku || scopedSku === sku;
  });
}

// The Add click must add exactly one unit. A product page that keeps or
// restores Qty 2 is refused before the click, not caught by the cart delta
// after the extra unit is already in the cart.
function targetQuantityOne(roots: readonly (Element | null)[], addControl: Element | null = null): boolean {
  const traceRoot = roots.find(Boolean);
  if (traceRoot) selectorListTrace("quantity", traceRoot, TARGET_QUANTITY_SELECTORS);
  // Target marks its Add button data-test="quantity-stepper" (it turns into a
  // stepper after the first add); the button itself is not a quantity reading.
  const exclude = (element: Element) => element === addControl || recommendationControl(element);
  const passed = [...new Set(roots.filter((root): root is Element => Boolean(root)))]
    .every((root) => quantityIsOne(root, TARGET_QUANTITY_SELECTORS, visible, exclude));
  recordTrace({
    step: "quantity",
    condition: "target.quantityOne",
    expected: "1",
    passed,
    ...(passed ? {} : { reject: "condition_failed" as const })
  });
  return passed;
}

function emptyTargetAddBinding(): TargetAddBinding {
  return { control: null, fulfillmentControl: null, fulfillment: "unknown", selectionRequired: false, offerRoot: null };
}

function modernTargetAddBinding(document: Document, sku: string, required: Fulfillment): TargetAddBinding | null {
  selectorTrace("offer_scope", document, TARGET_FULFILLMENT_ROOT_SELECTOR);
  const visibleRoots = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))]
    .filter((root) => visible(root) && !recommendationControl(root));
  const roots = visibleRoots.filter((root) => !visibleRoots.some((candidate) => candidate !== root && root.contains(candidate)));
  recordTrace({
    step: "offer_scope",
    condition: "target.fulfillmentRoot",
    matched: visibleRoots.length,
    visible: visibleRoots.length,
    scoped: roots.length,
    chosen: roots.length === 1 ? 1 : 0,
    passed: roots.length > 0,
    ...(roots.length > 0 ? {} : { reject: "outside_offer_root" })
  });
  if (roots.length === 0) return null;
  let scoped = roots.map((root) => {
    const exact = exactAddControls(root, sku);
    return { root, controls: exact.length > 0 ? exact : semanticTargetAddControls(root, sku) };
  })
    .filter((entry) => entry.controls.length === 1 && entry.controls[0]);
  // A placeholder control may only be used to choose fulfillment; it is never
  // the control that gets clicked (the rebind after selection must find the
  // exact-TCIN "Add to cart" control).
  let placeholder = false;
  if (scoped.length === 0 && roots.length === 1 && roots[0]) {
    const moduleControl = moduleAddControl(document, sku);
    recordTrace({
      step: "add_control",
      selector: "module:ProductDetailAddToCart",
      matched: moduleControl ? 1 : 0,
      visible: moduleControl ? 1 : 0,
      scoped: 0,
      chosen: moduleControl ? 1 : 0,
      ...(moduleControl ? {} : { reject: "outside_offer_root" as const })
    });
    if (moduleControl) {
      scoped = [{ root: roots[0], controls: [moduleControl.control] }];
      placeholder = !moduleControl.exact;
    }
  }
  if (scoped.length !== 1 || !scoped[0]?.controls[0]) return emptyTargetAddBinding();
  const { root } = scoped[0];
  const control = scoped[0].controls[0];
  if (!targetQuantityOne([root, control.closest(TARGET_PRIMARY_SCOPE_SELECTOR)], control)) return emptyTargetAddBinding();
  const tiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)]
    .filter((fulfillmentControl) => fulfillmentControl !== control && visible(fulfillmentControl))
    .map((fulfillmentControl) => ({
      fulfillmentControl,
      fulfillment: fulfillmentKind(fulfillmentControl),
      selected: fulfillmentTileSelected(fulfillmentControl),
      available: fulfillmentTileAvailable(fulfillmentControl)
    }))
    .filter((entry) => entry.fulfillment !== "unknown");
  required = required === "pickup" ? "pickup" : "shipping";
  if (tiles.length === 0) {
    if (placeholder) return emptyTargetAddBinding();
    let directFulfillment = directControlFulfillment(control, root);
    // Shipping-only products: the module's exact Add to cart beside a region
    // that only offers "Ship to … Arrives by …".
    if (directFulfillment === "unknown" && !root.contains(control) && targetAddIntent(control)) {
      directFulfillment = shipOnlyRegion(root);
    }
    return directFulfillment === required
      ? { control, fulfillmentControl: null, fulfillment: required, selectionRequired: false, offerRoot: root }
      : emptyTargetAddBinding();
  }
  const selected = tiles.filter((entry) => entry.selected);
  if (selected.length !== 1 || !selected[0]) return emptyTargetAddBinding();
  const selectedEntry = selected[0];
  const alreadySelected = selectedEntry.fulfillment === required && selectedEntry.available;
  if (alreadySelected) {
    // Ready to click: this must be the exact product control, labelled as an add.
    if (placeholder || (!root.contains(control) && !targetAddIntent(control))) return emptyTargetAddBinding();
    return { control, fulfillmentControl: selectedEntry.fulfillmentControl, fulfillment: required, selectionRequired: false, offerRoot: root };
  }
  const available = tiles.filter((entry) => entry.fulfillment === required && entry.available);
  if (available.length === 0) return emptyTargetAddBinding();
  const preferred = required === "shipping"
    ? available.find((entry) => /shipping/i.test(String(entry.fulfillmentControl.getAttribute("data-test") || entry.fulfillmentControl.getAttribute("id") || ""))) ?? available[0]
    : available[0];
  return preferred
    ? { control, fulfillmentControl: preferred.fulfillmentControl, fulfillment: required, selectionRequired: true, offerRoot: root }
    : emptyTargetAddBinding();
}

// October 2026 sold-out layout: the Fulfillment region holds only an
// "Out of Stock" status line (no method tiles) and the add-to-cart module holds
// a single disabled AddToCart.Disabled placeholder. That is an availability
// rejection, not a missing Add control. A store-specific line such as
// "Out of stock at San Dimas" beside available tiles is NOT this state.
const TARGET_SOLD_OUT_STATUS_PATTERN = /^(?:out of stock|sold out|currently unavailable)$/i;

function targetSoldOutLayout(document: Document): boolean {
  const module = targetAddModule(document);
  if (!module) return false;
  const buttons = [...module.querySelectorAll("button, [role='button']")]
    .filter((button) => visible(button) && !recommendationControl(button));
  const placeholders = buttons.filter((button) => button.getAttribute("id") === "AddToCart.Disabled"
    || button.getAttribute("data-test") === "AddToCart.Disabled");
  const placeholder = placeholders.length === 1 ? placeholders[0] : null;
  if (!placeholder || (!placeholder.hasAttribute("disabled") && placeholder.getAttribute("aria-disabled") !== "true")) return false;
  if (buttons.some((button) => button !== placeholder && actionable(button)
    && /\b(?:add(?:\s+(?:item\s+)?to)?\s+cart|pre[ -]?order)\b/i.test(`${button.getAttribute("aria-label") || ""} ${text(button, 300)}`))) return false;
  const regions = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))]
    .filter((region) => visible(region) && !recommendationControl(region));
  const outermost = regions.filter((region) => !regions.some((other) => other !== region && other.contains(region)));
  const region = outermost.length === 1 ? outermost[0] : null;
  if (!region) return false;
  if ([...region.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)]
    .some((tile) => fulfillmentKind(tile) !== "unknown" && fulfillmentTileAvailable(tile))) return false;
  return TARGET_SOLD_OUT_STATUS_PATTERN.test(observableText(region, 200));
}

function targetExplicitlyUnavailable(document: Document): boolean {
  return [...document.querySelectorAll(TARGET_AVAILABILITY_SELECTORS.join(", "))]
    .filter((element) => visible(element) && !recommendationControl(element))
    .some((element) => /\b(?:out of stock|sold out|currently unavailable)\b/i.test(
      `${element.getAttribute("content") || ""} ${element.getAttribute("aria-label") || ""} ${observableText(element, 500)}`
    )) || targetSoldOutLayout(document);
}

// Target client-renders the ProductDetailPrice_2 module (layout
// "is_enrichment_deferred": true, page flag
// isProductDetailServerSideRenderPriceEnabled=false). Since about 2026-09-30 it
// stays an animated skeleton ([data-test='price-module-placeholder']) for the
// whole observation window in automatic store-check tabs, while the same page
// has already rendered the exact item's price in its sticky add-to-cart bar
// (aria-hidden until the shopper scrolls).
const TARGET_PRICE_MODULE_SELECTOR_V2 = "[data-module-type='ProductDetailPrice']";
const TARGET_PRICE_PLACEHOLDER_SELECTOR = "[data-test='price-module-placeholder']";
const TARGET_STICKY_SELECTOR = "[data-test='sticky-atc']";
const TARGET_SINGLE_US_PRICE_PATTERN = /^\$\s*[0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{2})?$/;

/** The visible price module is present but is still only its loading skeleton. */
export function targetPriceModuleLoading(document: Document): boolean {
  const modules = [...document.querySelectorAll(TARGET_PRICE_MODULE_SELECTOR_V2)]
    .filter((module) => visible(module) && !recommendationControl(module));
  const outermost = modules.filter((module) => !modules.some((other) => other !== module && other.contains(module)));
  const module = outermost.length === 1 ? outermost[0] : null;
  return Boolean(module
    && [...module.querySelectorAll(TARGET_PRICE_PLACEHOLDER_SELECTOR)].some(visible)
    && parseUsPrice(observableText(module, 1_200)) === null);
}

/**
 * The exact item's price from the sticky add-to-cart bar, used ONLY while the
 * visible price module is still its loading skeleton. The bar must be bound to
 * the exact TCIN (its own Add control carries it and no other TCIN appears),
 * hold exactly one current price that is a single US amount (no range), and
 * carry no price qualifier other than "When purchased online". Shipping only.
 * The caller's cap, official-MSRP and cart checks still apply unchanged.
 */
function targetStickyPriceWhileLoading(document: Document, sku: string, required: Fulfillment): number | null {
  const reject = (reason: NonNullable<AdapterTraceEntry["reject"]>) => {
    recordTrace({ step: "price", selector: "sticky-atc:while-module-loading", matched: 0, visible: 0, scoped: 0, reject: reason });
    return null;
  };
  if (required === "pickup" || !/^\d{6,}$/.test(sku) || !targetPriceModuleLoading(document)) return null;
  const bars = [...document.querySelectorAll(TARGET_STICKY_SELECTOR)].filter((bar) => !recommendationControl(bar));
  const bar = bars.length === 1 ? bars[0] : null;
  if (!bar) return reject("ambiguous");
  const skus = targetSkuEvidence(bar);
  const exactControls = bar.querySelectorAll(`button[id='addToCartButtonOrTextIdFor${sku}']`);
  if (exactControls.length !== 1 || skus.size !== 1 || !skus.has(sku)) return reject("sku_mismatch");
  const blocks = bar.querySelectorAll("[data-test='@web/Price/PriceFull']");
  const block = blocks.length === 1 ? blocks[0] : null;
  const prices = block ? block.querySelectorAll("[data-test='product-price']") : [];
  const current = prices.length === 1 ? text(prices[0], 100) : "";
  if (!block || !TARGET_SINGLE_US_PRICE_PATTERN.test(current)) return reject("pattern_mismatch");
  const qualifier = [...block.querySelectorAll("[data-test='@web/Price/PriceHandle']")].map((handle) => text(handle, 200)).join(" ");
  if (qualifier && !/^when purchased online$/i.test(qualifier)) return reject("condition_failed");
  const price = parseUsPrice(current);
  recordTrace({ step: "price", selector: "sticky-atc:while-module-loading", matched: 1, visible: 0, scoped: 1, chosen: price === null ? 0 : 1 });
  return price;
}

function legacyTargetAddBinding(document: Document, sku: string, required: Fulfillment): TargetAddBinding {
  required = required === "pickup" ? "pickup" : "shipping";
  const candidates = addControls(document, sku).map((control) => ({ control, fulfillment: controlFulfillment(control, document) }));
  const matching = candidates.find((entry) => entry.fulfillment === required);
  return matching && targetQuantityOne([matching.control.closest(TARGET_PRIMARY_SCOPE_SELECTOR) ?? document.documentElement])
    ? { ...matching, fulfillmentControl: null, selectionRequired: false, offerRoot: null }
    : emptyTargetAddBinding();
}

export function targetAddBinding(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  environment?: AdapterEnvironment
): TargetAddBinding {
  if (environment) {
    return withAdapterEnvironment(environment, () => targetAddBinding(document, urlValue, expectedSku, requiredFulfillment));
  }
  const pageSku = extractTargetSku(urlValue);
  recordTrace({
    step: "page_identity",
    condition: "retailerSku",
    expected: expectedSku,
    actual: pageSku,
    passed: pageSku === expectedSku,
    ...(pageSku === expectedSku ? {} : { reject: "sku_mismatch" })
  });
  if (pageSku !== expectedSku) return emptyTargetAddBinding();
  return modernTargetAddBinding(document, expectedSku, requiredFulfillment)
    ?? legacyTargetAddBinding(document, expectedSku, requiredFulfillment);
}

export function targetAddControl(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  environment?: AdapterEnvironment
): Element | null {
  if (environment) {
    return withAdapterEnvironment(environment, () => targetAddControl(document, urlValue, expectedSku, requiredFulfillment));
  }
  const binding = targetAddBinding(document, urlValue, expectedSku, requiredFulfillment);
  const control = !binding.selectionRequired && actionable(binding.control) ? binding.control : null;
  recordTrace({
    step: "add_control",
    chosen: control ? 1 : 0,
    condition: "actionable",
    expected: "true",
    actual: String(Boolean(control)),
    passed: Boolean(control),
    ...(control ? {} : { reject: "not_actionable" })
  });
  return control;
}

function closestOfferContainer(anchor: Element | null): Element | null {
  let current = anchor?.parentElement ?? null;
  for (let depth = 0; depth < 12 && current; depth += 1) {
    const scopedText = text(current, 60_000);
    const price = adaptiveTargetPrice(current, TARGET_CURRENT_PRICE_SELECTORS);
    if (price !== null && scopedText.length < 40_000) return current;
    current = current.parentElement;
  }
  return null;
}

function sellerEvidence(document: Document, anchor: Element | null): { sellerName: string; sellerType: SellerType } {
  const cartRoot = anchor?.closest("[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item']") ?? null;
  const offerRoot = cartRoot ? null : closestOfferContainer(anchor);
  const root = cartRoot || offerRoot || anchor?.closest(TARGET_PRIMARY_SCOPE_SELECTOR) || document;
  const region = queryVisible(root, TARGET_SELLER_SELECTORS);
  const seller = text(region, 500);
  const scope = text(root, 60_000);
  if (FIRST_PARTY_PATTERN.test(seller)) return { sellerName: "Target", sellerType: "first_party" };
  if (seller && MARKETPLACE_PATTERN.test(seller)) {
    const name = seller.replace(/^.*?sold\s+(?:and|&)\s+shipped\s+by\s*/i, "").replace(/^.*?sold\s+by\s*/i, "").trim();
    return { sellerName: name.slice(0, 160), sellerType: "third_party" };
  }
  if (MARKETPLACE_PATTERN.test(scope)) return { sellerName: seller.slice(0, 160), sellerType: "unknown" };
  if (cartRoot || offerRoot) return { sellerName: "Target", sellerType: "first_party" };
  if (!MARKETPLACE_PATTERN.test(text(document.body, 120_000))) return { sellerName: "Target", sellerType: "first_party" };
  return { sellerName: seller.slice(0, 160), sellerType: "unknown" };
}

export function observeTargetOffer(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  observedAt = new Date().toISOString(),
  environment?: AdapterEnvironment
): LiveOfferObservation {
  if (environment) {
    return withAdapterEnvironment(environment, () => observeTargetOffer(
      document, urlValue, expectedSku, requiredFulfillment, observedAt
    ));
  }
  const pageSku = extractTargetSku(urlValue);
  const selected = pageSku === expectedSku
    ? targetAddBinding(document, urlValue, expectedSku, requiredFulfillment)
    : emptyTargetAddBinding();
  const seller = sellerEvidence(document, selected.control);
  const priceRoot = selected.offerRoot?.closest(TARGET_PRIMARY_SCOPE_SELECTOR)
    || selected.control?.closest(TARGET_PRIMARY_SCOPE_SELECTOR) || document;
  const unitPriceCents = adaptiveTargetPrice(priceRoot, TARGET_CURRENT_PRICE_SELECTORS)
    ?? (pageSku === expectedSku ? targetStickyPriceWhileLoading(document, expectedSku, requiredFulfillment) : null);
  const blocked = targetInteractiveBlock(document);
  const selectedControlActionable = pageSku === expectedSku && actionable(selected.control);
  const availability = blocked ? "unknown"
    : selectedControlActionable ? "in_stock"
      : pageSku === expectedSku && targetExplicitlyUnavailable(document) ? "out_of_stock" : "unknown";
  recordTrace({
    step: "availability",
    condition: "offer.availability",
    expected: "in_stock",
    actual: availability,
    passed: availability === "in_stock",
    ...(availability === "in_stock" ? {} : { reject: "not_actionable" })
  });
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    url: urlValue,
    pageKind: targetPageKind(urlValue),
    retailerId: "target",
    retailerSku: pageSku,
    selectedOffer: selectedOfferScope(document, "target", pageSku,
      selected.control?.closest(TARGET_PRIMARY_SCOPE_SELECTOR) || document),
    availability,
    unitPriceCents,
    currency: "USD",
    sellerName: seller.sellerName,
    sellerType: seller.sellerType,
    fulfillment: selected.fulfillment,
    addControlActionable: selectedControlActionable && !blocked,
    securityChallenge: targetSecurityChallenge(document),
    interactiveBlock: blocked
  };
}

export function observeTargetSelectedOfferScope(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment = "shipping",
  environment?: AdapterEnvironment
): ReturnType<typeof selectedOfferScope> {
  if (environment) {
    return withAdapterEnvironment(environment, () => observeTargetSelectedOfferScope(
      document, urlValue, expectedSku, requiredFulfillment
    ));
  }
  const pageSku = extractTargetSku(urlValue);
  if (!pageSku || pageSku !== expectedSku) throw new Error("The exact Target listing identity is unavailable.");
  const selected = targetAddBinding(document, urlValue, expectedSku, requiredFulfillment);
  return selectedOfferScope(
    document,
    "target",
    pageSku,
    selected.control?.closest(TARGET_PRIMARY_SCOPE_SELECTOR) || document
  );
}

function boundedDiagnosticCount(value: number): number {
  return Math.max(0, Math.min(50, Math.trunc(value)));
}

function targetGenericAddIntentControls(document: Document): Element[] {
  const controls = [...document.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")]
    .filter((candidate) => visible(candidate) && !recommendationControl(candidate))
    .filter((candidate) => /\b(?:add(?:\s+(?:item\s+)?to)?\s+cart|pre[ -]?order)\b/i.test([
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("name"),
      candidate.getAttribute("value"),
      candidate.getAttribute("data-test"),
      candidate.getAttribute("data-testid"),
      text(candidate, 300)
    ].filter(Boolean).join(" ")));
  recordTrace({
    step: "add_control",
    selector: "semantic:add-intent",
    matched: controls.length,
    visible: controls.length,
    scoped: 0,
    chosen: controls.length === 1 ? 1 : 0,
    ...(controls.length === 1 ? {} : { reject: "ambiguous" })
  });
  return controls;
}

function targetDiagnosticScopeKind(control: Element | null): RetailerAdapterLayoutEvidence["scopeKind"] {
  if (!control) return "none";
  if (control.closest("form")) return "form";
  if (control.closest(TARGET_PRIMARY_SCOPE_SELECTOR)) return "buybox";
  if (control.closest(TARGET_FULFILLMENT_ROOT_SELECTOR)) return "other";
  return "other";
}

function targetDiagnosticFulfillmentShape(root: Element | Document): RetailerAdapterLayoutEvidence["fulfillmentShape"] {
  const tiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)].filter(visible);
  const shipping = tiles.some((tile) => fulfillmentKind(tile) === "shipping");
  const pickup = tiles.some((tile) => fulfillmentKind(tile) === "pickup");
  if (shipping && pickup) return "mixed";
  if (shipping) return "shipping";
  if (pickup) return "pickup";
  const evidence = observableText(root, 30_000);
  const textShipping = /\b(?:ship(?:ping| it)?|deliver(?:y|ies|ed|ing)?)\b/i.test(evidence);
  const textPickup = /\bpick[ -]?up\b/i.test(evidence);
  return textShipping && textPickup ? "mixed" : textShipping ? "shipping" : textPickup ? "pickup" : "none";
}

/**
 * Privacy-bounded structural evidence for Target diagnostics. This deliberately
 * emits only counts and enum-valued page shapes; it never returns page text,
 * selectors, URLs, prices, seller names, cookies, or account state.
 */
export function targetAdapterLayoutEvidence(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment = "shipping",
  environment?: AdapterEnvironment
): RetailerAdapterLayoutEvidence {
  if (environment) {
    return withAdapterEnvironment(environment, () => targetAdapterLayoutEvidence(
      document, urlValue, expectedSku, requiredFulfillment
    ));
  }
  const pageSku = extractTargetSku(urlValue);
  const binding = pageSku === expectedSku
    ? targetAddBinding(document, urlValue, expectedSku, requiredFulfillment)
    : emptyTargetAddBinding();
  const packagedControls = pageSku === expectedSku
    ? [...new Set([...addControls(document, expectedSku), ...(binding.control ? [binding.control] : [])])]
    : [];
  const evidenceRoot = binding.offerRoot?.closest(TARGET_PRIMARY_SCOPE_SELECTOR)
    || binding.control?.closest(TARGET_PRIMARY_SCOPE_SELECTOR)
    || binding.offerRoot
    || document;
  const packagedPriceCandidates = [...evidenceRoot.querySelectorAll(TARGET_CURRENT_PRICE_SELECTORS.join(", "))]
    .filter((element) => (element.tagName === "META" || visible(element)) && !recommendationControl(element))
    .filter((element) => [element.getAttribute("content"), element.getAttribute("value"), text(element, 300)]
      .some((candidate) => parseUsPrice(candidate) !== null));
  const modulePriceCandidates = packagedPriceCandidates.length ? []
    : [...evidenceRoot.querySelectorAll(TARGET_PRICE_MODULE_SELECTOR)]
      .filter((element) => visible(element) && !recommendationControl(element))
      .filter((element) => (readPrice(element, TARGET_CURRENT_PRICE_SELECTORS)
        ?? parseUsPrice(observableText(element, 1_200))) !== null);
  const priceCandidates = packagedPriceCandidates.length ? packagedPriceCandidates : modulePriceCandidates;
  // Counted only while the visible price module is still its loading skeleton.
  const stickyPriceCandidateCount = priceCandidates.length === 0 && pageSku === expectedSku
    && targetStickyPriceWhileLoading(document, expectedSku, requiredFulfillment) !== null ? 1 : 0;
  const seller = pageSku === expectedSku
    ? sellerEvidence(document, binding.control)
    : { sellerType: "unknown" as const };
  const identities = pageSku === expectedSku ? targetSkuEvidence(document) : new Set<string>();
  return {
    schemaVersion: 1,
    pageKind: pageSku ? "product" : "other",
    scopeKind: targetDiagnosticScopeKind(binding.control),
    sellerShape: seller.sellerType === "unknown" ? "none" : "legacy",
    fulfillmentShape: targetDiagnosticFulfillmentShape(evidenceRoot),
    addControlCount: boundedDiagnosticCount(packagedControls.length),
    genericAddIntentCount: boundedDiagnosticCount(targetGenericAddIntentControls(document).length),
    scopedControlCount: binding.control ? 1 : 0,
    explicitSkuInputCount: 0,
    exactSkuInputCount: 0,
    // Identity evidence binds the control above; the layout field is Amazon-only.
    variationSkuCount: 0,
    canonicalOfferInputCount: 0,
    canonicalOfferDistinctCount: 0,
    alternateOfferInputCount: 0,
    alternateOfferDistinctCount: 0,
    priceCandidateCount: boundedDiagnosticCount(priceCandidates.length + stickyPriceCandidateCount),
    quantityControlCount: boundedDiagnosticCount([
      ...evidenceRoot.querySelectorAll(TARGET_QUANTITY_SELECTORS.join(", "))
    ].filter(visible).length),
    securityChallenge: targetSecurityChallenge(document),
    interactiveBlock: targetInteractiveBlock(document)
  };
}

// ---- Quantity for a plan of several (Kevin, 2026-10-10) ----

/**
 * The lowest limit a text states: "Limit 2 per guest", "Limited to 10 per
 * order", "Purchase limit: 2". Inside one exact cart line (`line`) a bare
 * "Limit 2" or "Max 10" counts too. None gives null.
 */
function targetLimitFromText(value: string, line = false): number | null {
  const patterns = [
    /\blimit(?:ed)?(?:\s+to)?\s+(\d{1,2})\s+(?:per|each|a)\s+(?:guest|order|customer|household|account|person|transaction)\b/gi,
    /\b(?:purchase|quantity|qty|order)\s+limit(?:\s+(?:of|is))?\s*:?\s*(\d{1,2})(?![\d%])/gi,
    ...(line ? [
      /\blimit\s*:?\s*(\d{1,2})(?![\d%])/gi,
      /\bmax(?:imum)?(?:\s+(?:qty|quantity))?(?:\s+(?:of|is))?\s*:?\s*(\d{1,2})(?![\d%])/gi
    ] : [])
  ];
  const limits: number[] = [];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const limit = Number(match[1]);
      if (Number.isInteger(limit) && limit >= 1 && limit <= 99) limits.push(limit);
    }
  }
  return limits.length ? Math.min(...limits) : null;
}

const TARGET_NEXT_DATA_MAX_CHARS = 4_000_000;
const TARGET_NEXT_DATA_MAX_NODES = 300_000;

function purchaseLimitValue(value: unknown): number | null {
  const limit = typeof value === "string" && /^\s*\d{1,2}\s*$/.test(value) ? Number(value) : value;
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 99 ? limit : null;
}

function objectField(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Target's own per-order limit for the exact TCIN from the page's
 * server-rendered data: the ProductDetailWebDatasourceCore module's
 * product.item.fulfillment.purchase_limit (2 or 10 in the October 2026 field
 * captures). Read only from a product, or one of its children, whose tcin is
 * the job's SKU: a page that navigated in place keeps the first product's
 * data, which then names another TCIN and is ignored.
 */
function targetNextDataPurchaseLimit(document: Document, sku: string): number | null {
  const scripts = document.querySelectorAll("script#__NEXT_DATA__");
  const raw = scripts.length === 1 ? String(scripts[0]?.textContent || "") : "";
  if (!raw || raw.length > TARGET_NEXT_DATA_MAX_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const limits: number[] = [];
  const productLimit = (product: unknown): void => {
    const children = objectField(product, "children");
    for (const candidate of [product, ...(Array.isArray(children) ? children : [])]) {
      if (String(objectField(candidate, "tcin") ?? "") !== sku) continue;
      const limit = purchaseLimitValue(objectField(objectField(objectField(candidate, "item"), "fulfillment"), "purchase_limit"));
      if (limit !== null) limits.push(limit);
    }
  };
  let budget = TARGET_NEXT_DATA_MAX_NODES;
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== "object" || depth > 64 || budget <= 0) return;
    budget -= 1;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (objectField(value, "module_type") === "ProductDetailWebDatasourceCore") {
      productLimit(objectField(objectField(objectField(value, "module_data"), "data"), "product"));
      return;
    }
    for (const entry of Object.values(value as Record<string, unknown>)) visit(entry, depth + 1);
  };
  visit(data, 0);
  return limits.length ? Math.min(...limits) : null;
}

const TARGET_LIMIT_MESSAGE_SELECTOR = "[data-test*='quantityLimit' i], [data-test*='purchaseLimit' i], [data-test*='limitMessage' i], "
  + "[data-testid*='quantityLimit' i], [data-testid*='purchaseLimit' i]";

/** A visible "Limit N per guest/order" in the exact product's add module, Fulfillment region or a limit message. */
function targetBuyBoxLimitText(document: Document): number | null {
  const regions = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))]
    .filter((region) => visible(region) && !recommendationControl(region));
  const roots = [
    targetAddModule(document),
    ...regions.filter((region) => !regions.some((other) => other !== region && other.contains(region))),
    ...[...document.querySelectorAll(TARGET_LIMIT_MESSAGE_SELECTOR)]
      .filter((element) => visible(element) && !recommendationControl(element))
  ].filter((root): root is Element => Boolean(root));
  const limits = roots.map((root) => targetLimitFromText(observableText(root, 2_000)))
    .filter((limit): limit is number => limit !== null);
  return limits.length ? Math.min(...limits) : null;
}

/**
 * Target's per-order limit for the exact product page's TCIN, from its
 * server-rendered data and any visible limit text in its buy box (the lower
 * one when both exist), or null when the page shows none.
 */
export function targetPurchaseLimit(
  document: Document,
  urlValue: string,
  expectedSku: string,
  environment?: AdapterEnvironment
): number | null {
  if (environment) return withAdapterEnvironment(environment, () => targetPurchaseLimit(document, urlValue, expectedSku));
  if (!/^\d{6,}$/.test(expectedSku) || extractTargetSku(urlValue) !== expectedSku) return null;
  const limits = [targetNextDataPurchaseLimit(document, expectedSku), targetBuyBoxLimitText(document)]
    .filter((limit): limit is number => limit !== null);
  const limit = limits.length ? Math.min(...limits) : null;
  recordTrace({ step: "quantity", condition: "target.purchaseLimit", actual: limit === null ? "unknown" : String(limit), passed: true });
  return limit;
}

// ---- Cart (read-only) ----
// No real Target cart page has been captured (as of 2026-10-10 Target
// bot-checks the development machine, and both field jobs stopped at the
// pre-add baseline), so the line, quantity-control and empty-cart markup read
// below is ASSUMED from plausible variants and pinned by synthetic fixtures
// (test/fixtures/target/cart*.html). Replace those with a promoted capture
// when one exists. Identity does not loosen: a line binds to exactly one TCIN
// or the cart is unreadable.

const TARGET_CART_LINE_SELECTOR = "[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item'], [data-tcin][data-cart-line]";

/** A cart link's TCIN: the variant it preselects, else its /A-<tcin> path. Relative links resolve against the cart page. */
function cartLinkTcin(anchor: Element): string {
  const href = String((anchor as HTMLAnchorElement).href || anchor.getAttribute("href") || "");
  const pathSku = extractTargetSku(href);
  if (!pathSku) return "";
  try {
    const preselect = String(new URL(href).searchParams.get("preselect") || "");
    return /^\d{6,}$/.test(preselect) ? preselect : pathSku;
  } catch {
    return "";
  }
}

/** Every TCIN a cart line names: its own and nested data-tcin, its product links and a tcin input. */
function cartLineTcins(line: Element): Set<string> {
  const tcins = new Set<string>();
  const add = (value: unknown): void => {
    const tcin = String(value ?? "").trim();
    if (/^\d{6,}$/.test(tcin)) tcins.add(tcin);
  };
  add(line.getAttribute("data-tcin"));
  for (const element of line.querySelectorAll("[data-tcin]")) {
    if (!recommendationControl(element)) add(element.getAttribute("data-tcin"));
  }
  for (const anchor of line.querySelectorAll("a[href]")) {
    if (!recommendationControl(anchor)) add(cartLinkTcin(anchor));
  }
  for (const input of line.querySelectorAll("input[name='tcin' i]")) add((input as HTMLInputElement).value);
  return tcins;
}

function cartLineElements(document: Document): Element[] {
  const candidates = [...document.querySelectorAll(TARGET_CART_LINE_SELECTOR)].filter(visible);
  return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

export interface TargetCartLine {
  element: Element;
  /** The one TCIN the line names, or "" when it names none or several. */
  sku: string;
  tcins: readonly string[];
}

/** The visible cart lines, each with the TCINs it names. */
export function targetCartLines(document: Document): TargetCartLine[] {
  return cartLineElements(document).map((element) => {
    const tcins = [...cartLineTcins(element)];
    return { element, sku: tcins.length === 1 ? tcins[0] ?? "" : "", tcins };
  });
}

export interface TargetCartQuantityControl {
  /**
   * select/input: a native control; dropdown: a button that opens a listbox
   * of numbers; stepper: +/- buttons around the shown quantity; display:
   * read-only text such as "Qty 2".
   */
  kind: "select" | "input" | "dropdown" | "stepper" | "display";
  control: Element;
  /** The stepper's own "+" (stepper only). */
  increase: Element | null;
  quantity: number | null;
  /** The control's own maximum or the line's "Limit N"/"Max N" text, whichever is lower. */
  storeLimit: number | null;
}

const CART_QUANTITY_HINT = /qty|quantity/i;
const CART_INCREASE_PATTERN = /\b(?:increase|increment|add one|add 1|plus)\b/i;
const CART_DECREASE_PATTERN = /\b(?:decrease|decrement|remove one|remove 1|subtract|minus)\b/i;
// Product titles and links in a line are not its limit ("Clorox Max 2 Pack").
const CART_LIMIT_TEXT_SKIP = (element: Element) => element.tagName === "A"
  || /title|name/i.test(`${element.getAttribute("data-test") || ""} ${element.getAttribute("data-testid") || ""}`);
const CART_OPTION_PATTERN = /^\s*(?:qty|quantity)?\s*:?\s*(\d{1,2})\s*$/i;

function cartQuantityHinted(element: Element): boolean {
  return ["name", "id", "aria-label", "data-test", "data-testid", "title"]
    .some((attribute) => CART_QUANTITY_HINT.test(element.getAttribute(attribute) || ""));
}

/** Named as a quantity by itself, by its <label>, or by a wrapper inside the line. */
function cartQuantityLabelled(element: Element, line: Element): boolean {
  if (cartQuantityHinted(element)) return true;
  const id = element.getAttribute("id");
  if (id && [...line.querySelectorAll("label[for]")]
    .some((label) => label.getAttribute("for") === id && CART_QUANTITY_HINT.test(text(label, 100)))) return true;
  for (let node = element.parentElement; node && node !== line && line.contains(node); node = node.parentElement) {
    if (cartQuantityHinted(node) || (node.tagName === "LABEL" && CART_QUANTITY_HINT.test(text(node, 100)))) return true;
  }
  return false;
}

function boundedQuantity(value: unknown): number | null {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
}

/** A select option or listbox option that is exactly one number ("2", "Qty 2"); "10+" is not. */
export function targetCartOptionQuantity(option: Element): number | null {
  const sources = option.tagName === "OPTION"
    ? [(option as HTMLOptionElement).value, text(option, 40)]
    : [text(option, 40), option.getAttribute("aria-label"), option.getAttribute("data-value")];
  for (const source of sources) {
    const quantity = boundedQuantity(CART_OPTION_PATTERN.exec(String(source ?? ""))?.[1]);
    if (quantity !== null) return quantity;
  }
  return null;
}

/** "Qty 2", "Quantity: 2", "Quantity, 2 selected"; else the one number the text holds ("Current quantity is 2"). */
function cartQuantityText(value: unknown, loneNumber = false): number | null {
  const normalized = String(value ?? "").replace(/[,|]/g, " ").replace(/\s+/g, " ").trim();
  const strict = parseQuantityText(normalized);
  if (strict !== null || !loneNumber) return strict;
  const numbers = [...new Set(normalized.match(/\d+(?:[.,]\d+)?/g) ?? [])];
  return numbers.length === 1 && /^\d{1,2}$/.test(numbers[0] ?? "") ? boundedQuantity(numbers[0]) : null;
}

function cartFieldQuantity(field: Element): number | null {
  if (field.tagName === "SELECT") {
    const select = field as HTMLSelectElement;
    const option = select.options[select.selectedIndex];
    return option ? targetCartOptionQuantity(option) : null;
  }
  if (field.tagName === "INPUT") {
    const value = String((field as HTMLInputElement).value ?? "").trim();
    return /^\d{1,2}$/.test(value) ? boundedQuantity(value) : null;
  }
  const valueNow = field.getAttribute("aria-valuenow");
  return valueNow !== null && /^\s*\d{1,2}\s*$/.test(valueNow) ? boundedQuantity(valueNow.trim()) : null;
}

function cartFieldLimit(field: Element): number | null {
  if (field.tagName === "SELECT") {
    const options = [...(field as HTMLSelectElement).options]
      .filter((option) => !option.disabled)
      .map(targetCartOptionQuantity)
      .filter((quantity): quantity is number => quantity !== null);
    return options.length ? Math.max(...options) : null;
  }
  const maximum = String(field.getAttribute("max") ?? field.getAttribute("aria-valuemax") ?? "").trim();
  return /^\d{1,2}$/.test(maximum) ? boundedQuantity(maximum) : null;
}

/** A stepper label names quantity or is the bare verb ("Increase", "Add one"); "Join Circle 360 plus" is not one. */
function cartStepperLabel(value: string, verbs: RegExp): boolean {
  const label = value.replace(/\s+/g, " ").trim();
  return verbs.test(label) && (CART_QUANTITY_HINT.test(label) || label.split(" ").length <= 3);
}

function cartStepperDirection(button: Element): "increase" | "decrease" | "" {
  const labels = [button.getAttribute("aria-label"), button.getAttribute("title"), text(button, 100)]
    .map((label) => String(label || "")).filter(Boolean);
  const own = text(button, 10);
  if (own === "+" || labels.some((label) => cartStepperLabel(label, CART_INCREASE_PATTERN))) return "increase";
  if (/^[-\u2212\u2013]$/.test(own) || labels.some((label) => cartStepperLabel(label, CART_DECREASE_PATTERN))) return "decrease";
  return "";
}

function cartDisabled(element: Element): boolean {
  return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}

/** The element that holds a stepper: the smallest wrapper with both of its buttons, else a quantity wrapper, else the "+" parent. */
function cartStepperRoot(button: Element, buttons: readonly Element[], line: Element): Element {
  let hinted: Element | null = null;
  for (let node = button.parentElement; node && node !== line && line.contains(node); node = node.parentElement) {
    if (buttons.some((other) => other !== button && node.contains(other))) return node;
    if (!hinted && (cartQuantityHinted(node) || node.getAttribute("role") === "group"
      || /stepper/i.test(`${node.getAttribute("data-test") || ""} ${node.getAttribute("data-testid") || ""}`))) hinted = node;
  }
  return hinted ?? (button.parentElement && button.parentElement !== line ? button.parentElement : line);
}

function cartStepperQuantity(root: Element): number | null {
  const fields = [...root.querySelectorAll("input:not([type='hidden']), select, [role='spinbutton'], [aria-valuenow]")].filter(visible);
  if (fields.length) {
    const values = fields.map(cartFieldQuantity);
    return values.every((value) => value !== null && value === values[0]) ? values[0] ?? null : null;
  }
  const valueNow = root.getAttribute("aria-valuenow");
  if (valueNow !== null && valueNow.trim()) return cartQuantityText(valueNow);
  const isButton = (element: Element) => element.tagName === "BUTTON" || element.getAttribute("role") === "button";
  return cartQuantityText(observableText(root, 300, isButton), true);
}

function cartDropdownTrigger(element: Element, line: Element): boolean {
  if (element.tagName === "INPUT" || element.tagName === "SELECT" || cartStepperDirection(element)) return false;
  const role = element.getAttribute("role");
  const popup = String(element.getAttribute("aria-haspopup") || "").toLocaleLowerCase("en-US");
  return (role === "combobox" || ((element.tagName === "BUTTON" || role === "button") && popup !== "" && popup !== "false"))
    && (cartQuantityLabelled(element, line) || CART_QUANTITY_HINT.test(text(element, 60)));
}

function cartDropdownQuantity(trigger: Element): number | null {
  const values = [cartQuantityText(trigger.getAttribute("aria-label"), true), cartQuantityText(text(trigger, 60), true)]
    .filter((value): value is number => value !== null);
  return values.length && values.every((value) => value === values[0]) ? values[0] ?? null : null;
}

interface CartQuantityProbe {
  controls: TargetCartQuantityControl[];
  /** The line's quantity when every reading agrees; null when unreadable or contradictory; undefined when the line shows no quantity at all. */
  quantity: number | null | undefined;
}

function probeCartQuantity(line: Element): CartQuantityProbe {
  const usable = (element: Element) => visible(element) && !recommendationControl(element);
  const lineLimit = targetLimitFromText(observableText(line, 1_500, CART_LIMIT_TEXT_SKIP), true);
  const limitOf = (own: number | null) => {
    const limits = [own, lineLimit].filter((limit): limit is number => limit !== null);
    return limits.length ? Math.min(...limits) : null;
  };
  const buttons = [...line.querySelectorAll("button, [role='button']")].filter(usable);
  const stepperButtons = buttons.filter((button) => cartStepperDirection(button) !== "");
  const stepperRoots = [...new Set(stepperButtons.map((button) => cartStepperRoot(button, stepperButtons, line)))];
  const insideStepper = (element: Element) => stepperRoots.some((root) => root.contains(element));
  const controls: TargetCartQuantityControl[] = [];
  for (const select of line.querySelectorAll("select")) {
    if (!usable(select) || insideStepper(select)) continue;
    const options = [...(select as HTMLSelectElement).options];
    if (!cartQuantityLabelled(select, line) && !(options.length > 1 && options.every((option) => targetCartOptionQuantity(option) !== null))) continue;
    controls.push({ kind: "select", control: select, increase: null, quantity: cartFieldQuantity(select), storeLimit: limitOf(cartFieldLimit(select)) });
  }
  for (const input of line.querySelectorAll("input, [role='spinbutton']")) {
    const type = String(input.getAttribute("type") || "text").toLocaleLowerCase("en-US");
    if (!usable(input) || insideStepper(input) || !["text", "number", "tel", ""].includes(input.tagName === "INPUT" ? type : "")) continue;
    if (input.getAttribute("role") !== "spinbutton" && type !== "number" && !cartQuantityLabelled(input, line)) continue;
    controls.push({ kind: "input", control: input, increase: null, quantity: cartFieldQuantity(input), storeLimit: limitOf(cartFieldLimit(input)) });
  }
  for (const root of stepperRoots) {
    const own = stepperButtons.filter((button) => root.contains(button));
    const increases = own.filter((button) => cartStepperDirection(button) === "increase");
    const increase = increases.length === 1 ? increases[0] ?? null : null;
    const quantity = cartStepperQuantity(root);
    controls.push({
      kind: "stepper",
      control: root,
      increase,
      quantity: increases.length > 1 ? null : quantity,
      storeLimit: limitOf(increase && cartDisabled(increase) ? quantity : null)
    });
  }
  for (const trigger of line.querySelectorAll("button, [role='button'], [role='combobox']")) {
    if (!usable(trigger) || insideStepper(trigger) || !cartDropdownTrigger(trigger, line)) continue;
    controls.push({ kind: "dropdown", control: trigger, increase: null, quantity: cartDropdownQuantity(trigger), storeLimit: lineLimit });
  }
  if (controls.length) {
    const readings = controls.map((control) => control.quantity);
    const agreed = readings.every((reading) => reading !== null && reading === readings[0]) ? readings[0] ?? null : null;
    return { controls, quantity: agreed };
  }
  // No control: read-only text such as "Qty 2" in an element named as quantity.
  const displays = [...line.querySelectorAll("*")]
    .filter((element) => usable(element) && cartQuantityHinted(element)
      && !element.querySelector("select, input, button, [role='button'], [role='combobox'], [role='spinbutton']"))
    .map((element) => ({ element, quantity: cartQuantityText(text(element, 100)) ?? cartQuantityText(element.getAttribute("aria-label")) }))
    .filter((entry): entry is { element: Element; quantity: number } => entry.quantity !== null);
  if (displays.length) {
    const agreed = displays.every((entry) => entry.quantity === displays[0]?.quantity) ? displays[0]?.quantity ?? null : null;
    return {
      controls: displays.length === 1 && displays[0]
        ? [{ kind: "display", control: displays[0].element, increase: null, quantity: displays[0].quantity, storeLimit: lineLimit }]
        : [],
      quantity: agreed
    };
  }
  return { controls: [], quantity: undefined };
}

/** Rendered visibility as the Target observer judges it (for the cart runner's listbox options). */
export function targetElementVisible(element: Element | null): boolean {
  return visible(element);
}

/** The exact line's one quantity control, or null when it has none or several. */
export function targetCartQuantityControl(line: Element): TargetCartQuantityControl | null {
  const { controls } = probeCartQuantity(line);
  return controls.length === 1 ? controls[0] ?? null : null;
}

function lineQuantity(line: Element): number | null {
  // Controls first (select value, input value, the number between stepper
  // buttons, a quantity dropdown's label), then read-only "Qty N" text. A
  // line with no recognisable control falls back to the packaged selectors.
  // Each reading is anchored, so "Quantity 100" is unreadable, not 10 or 1.
  const probe = probeCartQuantity(line);
  if (probe.quantity !== undefined) return probe.quantity;
  return readControlQuantity(queryVisible(line, TARGET_QUANTITY_SELECTORS));
}

const TARGET_CART_PRICE_SELECTORS = ["[data-test*='price' i]", "[itemprop='price']"];
const TARGET_CART_UNIT_PRICE_SELECTORS = [
  "[data-test*='unit-price' i]", "[data-test*='unitprice' i]", "[data-testid*='unit-price' i]", "[data-testid*='unitprice' i]"
];

/**
 * The line's price for one unit. A line of one reads its first price as
 * before. With several units, a price marked per unit ("unit-price", "$19.99
 * each", "$19.99/ea") wins, then a price that is exactly the shown total
 * divided by the quantity. Otherwise the first price is taken as the unit
 * price, so an unmarked line total fails the unit cap closed instead of being
 * divided.
 */
function targetLineUnitPrice(line: Element, quantity: number | null): number | null {
  const first = readPrice(line, TARGET_CART_PRICE_SELECTORS);
  if (quantity === null || quantity <= 1) return first;
  const marked = readPrice(line, TARGET_CART_UNIT_PRICE_SELECTORS);
  if (marked !== null) return marked;
  const each = observableText(line, 3_000).match(/\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:\/\s*)?(?:ea|each)\b/i);
  const eachPrice = each ? parseUsPrice(`$${each[1]}`) : null;
  if (eachPrice !== null) return eachPrice;
  if (first === null) return null;
  const prices = [...new Set([...line.querySelectorAll(TARGET_CART_PRICE_SELECTORS.join(", "))]
    .filter((element) => visible(element) && !recommendationControl(element))
    .map((element) => parseUsPrice(text(element, 300)))
    .filter((price): price is number => price !== null))];
  return prices.find((price) => prices.includes(price * quantity)) ?? first;
}

const TARGET_EMPTY_CART_PATTERN = /\b(?:your\s+)?(?:shopping\s+)?cart\s+is\s+(?:currently\s+)?empty\b|\byour\s+cart(?:’|')?s\s+empty\b|\bno\s+items\s+in\s+(?:your\s+)?(?:shopping\s+)?cart\b|\bcart\s+has\s+no\s+items\b|\byou\s+have\s+no\s+items\s+in\s+your\s+cart\b/i;

function targetCartVisiblyEmpty(document: Document): boolean {
  const roots = [...document.querySelectorAll([
    "[data-test*='empty-cart' i]",
    "[data-testid*='empty-cart' i]",
    "[data-test*='emptycart' i]",
    "[data-testid*='emptycart' i]",
    "[data-test='cart-empty']",
    "main",
    "[role='main']"
  ].join(", "))].filter(visible);
  return roots.some((root) => TARGET_EMPTY_CART_PATTERN.test(observableText(root, 20_000)));
}

export function observeTargetCart(document: Document, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const cartLines = targetCartLines(document);
  const lines = cartLines.map(({ element, sku }) => {
    const seller = sellerEvidence(document, element);
    const quantity = lineQuantity(element);
    return {
      retailerSku: sku,
      quantity,
      unitPriceCents: targetLineUnitPrice(element, quantity),
      sellerName: seller.sellerName,
      sellerType: seller.sellerType
    };
  });
  const independentlyCounted = cartLines.length > 0
    ? new Set(cartLines.map((line) => line.element)).size === cartLines.length
    : targetCartVisiblyEmpty(document);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
    independentlyCounted,
    independentLineCount: cartLines.length,
    lines
  };
}

function selectedEvidence(document: Document, selectors: string[]): string[] {
  return [...document.querySelectorAll(selectors.join(", "))]
    .filter(visible)
    .map((element) => text(element, 1_000))
    .filter(Boolean)
    .slice(0, 20);
}

function targetCheckoutFulfillment(document: Document): "shipping" | "pickup" | "unknown" {
  const selected = selectedEvidence(document, ["[data-test*='fulfillment' i][data-selected='true']", "input[name*='fulfillment' i]:checked"]);
  const page = text(queryVisible(document, ["[data-test='STEP_SHIPPING_CONTAINER']", "[data-test*='pickup' i]"]), 5_000);
  const evidence = [...selected, page].join(" ");
  const shipping = /shipping|delivery|ship it/i.test(evidence);
  const pickup = /pickup|pick-up|pick it up/i.test(evidence);
  return shipping === pickup ? "unknown" : shipping ? "shipping" : "pickup";
}

export async function observeTargetCheckout(
  document: Document,
  mission: TargetMissionIdentity,
  signFingerprint: FingerprintSigner,
  observedAt = new Date().toISOString()
): Promise<CheckoutEvidence> {
  if (typeof signFingerprint !== "function") throw new Error("Target checkout observation requires an in-memory fingerprint signer.");
  const fulfillment = targetCheckoutFulfillment(document);
  const destinationValues = fulfillment === "shipping"
    ? selectedEvidence(document, ["[data-test='cart-shipping-address']", "[data-test*='address-option' i][data-selected='true']", "input[name*='address' i]:checked"])
    : [];
  const pickupValues = fulfillment === "pickup"
    ? selectedEvidence(document, ["[data-test*='pickup-store' i]", "[data-test*='store' i][data-selected='true']"])
    : [];
  const paymentValues = selectedEvidence(document, [
    "[data-test^='IconPayment']",
    "[data-test*='payment' i][data-selected='true']",
    "input[name*='payment' i]:checked"
  ]);
  const cart = observeTargetCart(document, observedAt);
  const line = cart.lines.find((entry) => entry.retailerSku === mission.retailerSku);
  const substitutionControls = [...document.querySelectorAll("[data-test*='substitution' i], input[name*='substitution' i]")].filter(visible);
  const substitutionEnabled = substitutionControls.some((control) => (
    formControlChecked(control)
    || control.getAttribute("aria-checked") === "true"
    || control.getAttribute("data-selected") === "true"
    || control.getAttribute("data-enabled") === "true"
  ));
  const checkoutRoot = queryVisible(document, ["[data-test='checkout-container']", "[data-test='checkout-summary-container']", "main"]);
  const substitutions: CheckoutEvidence["substitutions"] = substitutionControls.length
    ? substitutionEnabled ? "enabled" : "disabled"
    : checkoutRoot ? "not-applicable" : "unknown";
  const unsafeChoices = [
    queryVisible(document, ["input[name*='membership' i]:checked", "[data-test*='trial' i][data-selected='true']"]) ? "membership_or_trial" : "",
    queryVisible(document, ["input[name*='gift' i]:checked", "[data-test*='gift' i][data-selected='true']"]) ? "gift_option" : "",
    queryVisible(document, ["input[name*='protection' i]:checked", "[data-test*='protection' i][data-selected='true']"]) ? "protection_plan" : ""
  ].filter(Boolean);
  const submit = queryVisible(document, ["button[data-test*='placeOrder' i]", "button[id*='placeOrder' i]"]);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    source: "visible-checkout-dom",
    observedAt,
    retailerId: "target",
    retailerSku: mission.retailerSku,
    fulfillment,
    destinationFingerprint: destinationValues.length ? await signFingerprint(destinationValues) : "",
    pickupStoreFingerprint: pickupValues.length ? await signFingerprint(pickupValues) : "",
    paymentInstrumentSetFingerprint: paymentValues.length ? await signFingerprint(paymentValues) : "",
    paymentInstrumentCount: paymentValues.length,
    substitutions,
    substitutionSku: mission.retailerSku,
    cartComplete: cart.complete,
    cartIndependentlyCounted: cart.independentlyCounted,
    cartLineCount: cart.lines.length,
    cartSku: line?.retailerSku ?? "",
    cartQuantity: line?.quantity ?? 0,
    orderTotalCents: readPrice(document, [
      "[data-test='order-summary-total']",
      "[data-test='orderTotal']",
      "[data-test='grand-total']",
      "[data-testid='order-total']",
      "[data-test='cart-summary-total']"
    ]),
    unsafeChoices,
    submitControlActionable: actionable(submit)
  };
}
