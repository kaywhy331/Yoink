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

function observableText(value: Element | Document | null | undefined, maximum = 2_000): string {
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
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || !visible(element)) return;
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
    const style = String(current.getAttribute("style") || "").replace(/\s+/g, "").toLocaleLowerCase("en-US");
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

function formControlValue(element: Element | null): string {
  if (!element || !["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) return "";
  return String((element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value || "");
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
  const scoped = roots.map((root) => {
    const exact = exactAddControls(root, sku);
    return { root, controls: exact.length > 0 ? exact : semanticTargetAddControls(root, sku) };
  })
    .filter((entry) => entry.controls.length === 1 && entry.controls[0]);
  if (scoped.length !== 1 || !scoped[0]?.controls[0]) return emptyTargetAddBinding();
  const { root } = scoped[0];
  const control = scoped[0].controls[0];
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
    const directFulfillment = directControlFulfillment(control, root);
    return directFulfillment === required
      ? { control, fulfillmentControl: null, fulfillment: required, selectionRequired: false, offerRoot: root }
      : emptyTargetAddBinding();
  }
  const selected = tiles.filter((entry) => entry.selected);
  if (selected.length !== 1 || !selected[0]) return emptyTargetAddBinding();
  const selectedEntry = selected[0];
  const alreadySelected = selectedEntry.fulfillment === required && selectedEntry.available;
  if (alreadySelected) {
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

function targetExplicitlyUnavailable(document: Document): boolean {
  return [...document.querySelectorAll(TARGET_AVAILABILITY_SELECTORS.join(", "))]
    .filter((element) => visible(element) && !recommendationControl(element))
    .some((element) => /\b(?:out of stock|sold out|currently unavailable)\b/i.test(
      `${element.getAttribute("content") || ""} ${element.getAttribute("aria-label") || ""} ${observableText(element, 500)}`
    ));
}

function legacyTargetAddBinding(document: Document, sku: string, required: Fulfillment): TargetAddBinding {
  required = required === "pickup" ? "pickup" : "shipping";
  const candidates = addControls(document, sku).map((control) => ({ control, fulfillment: controlFulfillment(control, document) }));
  const matching = candidates.find((entry) => entry.fulfillment === required);
  return matching
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
  const unitPriceCents = adaptiveTargetPrice(priceRoot, TARGET_CURRENT_PRICE_SELECTORS);
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
    variationSkuCount: boundedDiagnosticCount(identities.size),
    canonicalOfferInputCount: 0,
    canonicalOfferDistinctCount: 0,
    alternateOfferInputCount: 0,
    alternateOfferDistinctCount: 0,
    priceCandidateCount: boundedDiagnosticCount(priceCandidates.length),
    quantityControlCount: boundedDiagnosticCount([
      ...evidenceRoot.querySelectorAll(TARGET_QUANTITY_SELECTORS.join(", "))
    ].filter(visible).length),
    securityChallenge: targetSecurityChallenge(document),
    interactiveBlock: targetInteractiveBlock(document)
  };
}

function lineSku(line: Element): string {
  const own = line.getAttribute("data-tcin");
  if (own && /^\d{6,}$/.test(own)) return own;
  for (const anchor of line.querySelectorAll("a[href]")) {
    const sku = extractTargetSku(anchor.getAttribute("href") || "");
    if (sku) return sku;
  }
  return "";
}

function lineQuantity(line: Element): number | null {
  const control = queryVisible(line, TARGET_QUANTITY_SELECTORS);
  const candidate = control?.getAttribute("value") || formControlValue(control) || text(control, 100);
  const match = String(candidate).match(/(?:qty|quantity)?\s*:?\s*(\d{1,2})/i);
  const quantity = Number(match?.[1]);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
}

function cartLineElements(document: Document): Element[] {
  const candidates = [...document.querySelectorAll("[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item'], [data-tcin][data-cart-line]")].filter(visible);
  return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

function targetCartVisiblyEmpty(document: Document): boolean {
  const root = queryVisible(document, [
    "[data-test*='empty-cart' i]",
    "[data-testid*='empty-cart' i]",
    "[data-test='cart-empty']",
    "main"
  ]);
  return Boolean(root && /(?:your )?cart is empty|no items in (?:your )?cart|cart has no items/i.test(text(root, 20_000)));
}

export function observeTargetCart(document: Document, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const elements = cartLineElements(document);
  const lines = elements.map((line) => {
    const seller = sellerEvidence(document, line);
    return {
      retailerSku: lineSku(line),
      quantity: lineQuantity(line),
      unitPriceCents: readPrice(line, ["[data-test*='price' i]", "[itemprop='price']"]),
      sellerName: seller.sellerName,
      sellerType: seller.sellerType
    };
  });
  const independentlyCounted = elements.length > 0
    ? new Set(elements).size === elements.length
    : targetCartVisiblyEmpty(document);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
    independentlyCounted,
    independentLineCount: elements.length,
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
