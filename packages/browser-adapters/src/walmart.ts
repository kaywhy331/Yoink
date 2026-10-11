import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type CartInventoryEvidence,
  type LiveOfferObservation
} from "../../browser-safety/src/index.js";
import { WALMART_OBSERVER_VERSION, type AdapterEnvironment, type Fulfillment, type SellerType } from "../../contracts/src/index.js";
import {
  extractRetailerSku,
  observeRetailerOffer,
  parseRetailerPriceElement,
  retailerAddControl,
  retailerInteractiveBlock,
  retailerSecurityChallenge,
  walmartFulfillmentTiles,
  walmartOrderLimitValue
} from "./retailers.js";
import { parseQuantityText, parseStepperText, readControlQuantity } from "./dom.js";
import { selectorsFor } from "./selector-packs.js";

export { WALMART_OBSERVER_VERSION, walmartFulfillmentTiles };
export type { WalmartFulfillmentTile } from "./retailers.js";

function text(value: Element | Document | null | undefined, maximum = 2_000): string {
  return String(value?.textContent || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function visible(element: Element | null): element is Element {
  if (!element) return false;
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
    const style = String(current.getAttribute("style") || "").replace(/\s+/g, "").toLocaleLowerCase("en-US");
    if (/(?:^|;)display:none(?:;|$)|(?:^|;)visibility:hidden(?:;|$)/.test(style)) return false;
    current = current.parentElement;
  }
  return true;
}

function queryVisible(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const found = [...root.querySelectorAll(selector)].find(visible);
    if (found) return found;
  }
  return null;
}

function firstPrice(root: ParentNode, selectors: readonly string[], skip: string = ""): number | null {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (!visible(element) || (skip && element.matches(skip))) continue;
      const price = parseRetailerPriceElement(element);
      if (price !== null) return price;
    }
  }
  return null;
}

// `line-price` is the line total, not the unit price. Read a unit price
// first; otherwise divide the line total by the parsed quantity, rounding up
// so the unit-cap check never sees a price lower than the real one.
function readUnitPrice(root: ParentNode, quantity: number | null): number | null {
  const unit = firstPrice(root, [
    "[data-automation-id='product-price']",
    "[data-testid*='unit-price' i]",
    "[itemprop='price']"
  ]);
  if (unit !== null) return unit;
  const total = firstPrice(root, ["[data-testid='line-price']", "[data-testid*='price' i]"], "[data-testid*='was' i], [data-testid*='strike' i]");
  if (total === null || quantity === null) return null;
  return Math.ceil(total / quantity);
}

export function walmartPageKind(urlValue: string): LiveOfferObservation["pageKind"] {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" || url.username || url.password
      || !(url.hostname === "walmart.com" || url.hostname.endsWith(".walmart.com"))) return "other";
    const path = url.pathname.toLocaleLowerCase("en-US");
    if (path === "/qp" || /waiting-room|virtual-queue/.test(path)) return "queue";
    if (/\/account\/(?:login|verify)|\/login|\/signin|\/challenge/.test(path)) return "auth";
    if (/\/checkout\/(?:review|payment|shipping)|\/checkout$/.test(path)) return "checkout";
    if (/^\/cart(?:\/|$)/.test(path)) return "cart";
    return extractRetailerSku("walmart", urlValue) ? "product" : "other";
  } catch {
    return "other";
  }
}

export function walmartAddControl(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  environment?: AdapterEnvironment
): Element | null {
  if (requiredFulfillment !== "shipping" && requiredFulfillment !== "pickup") return null;
  if (retailerInteractiveBlock(document, urlValue, environment)) return null;
  return retailerAddControl(document, urlValue, "walmart", expectedSku, requiredFulfillment, environment);
}

export function observeWalmartOffer(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  observedAt = new Date().toISOString(),
  environment?: AdapterEnvironment
): LiveOfferObservation {
  const observation = observeRetailerOffer(
    document,
    urlValue,
    "walmart",
    expectedSku,
    requiredFulfillment,
    observedAt,
    environment
  );
  return { ...observation, pageKind: walmartPageKind(urlValue) };
}

function nextDataProduct(document: Document): Record<string, unknown> | null {
  const scripts = [...document.querySelectorAll(selectorsFor("walmart", "structuredData").join(", "))];
  if (scripts.length !== 1 || scripts[0]?.getAttribute("type") !== "application/json") return null;
  const serialized = String(scripts[0].textContent || "").trim();
  if (!serialized || serialized.length > 2_000_000) return null;
  try {
    const product = JSON.parse(serialized)?.props?.pageProps?.initialData?.data?.product;
    return product && typeof product === "object" && !Array.isArray(product) ? product as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// "Limit 2 per order", "Max 3 per customer", "limited to 2 per household".
const BUY_BOX_LIMIT = /\b(?:limit(?:ed)?(?:\s+to)?|max(?:imum)?\.?)\s*(?:of\s+)?(\d{1,2})(?!\d)\s*(?:items?\s+|units?\s+)?per\s+(?:order|customer|household|guest|member|person)\b/gi;

/**
 * The store's own per-order limit for this exact item, or null when the page
 * shows none: the positive `orderLimit` of the product and of the selected
 * fulfillment option in Walmart's page state (0 or null is no limit), and a
 * "Limit N per order" note beside the Add control. The lowest one wins.
 * `memberLimit` is not read: the captured pages carry it as null and nothing
 * shows it is a per-order cap; the cart's own stepper enforces the real one.
 */
export function walmartOrderLimit(
  document: Document,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  control: Element | null = null
): number | null {
  const limits: number[] = [];
  const product = nextDataProduct(document);
  if (product && String(product.usItemId || "") === expectedSku) {
    const type = requiredFulfillment === "pickup" ? "PICKUP" : "SHIPPING";
    const options = (Array.isArray(product.fulfillmentOptions) ? product.fulfillmentOptions : [])
      .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object"
        && (option as Record<string, unknown>).type === type && (option as Record<string, unknown>).selected === true);
    const option = options.length === 1 ? options[0] : null;
    for (const value of [product.orderLimit, option?.maxOrderQuantity, option?.orderLimit]) {
      const limit = walmartOrderLimitValue(value);
      if (typeof limit === "number") limits.push(limit);
    }
  }
  const scope = control?.closest(selectorsFor("walmart", "primaryScope").join(", ")) ?? null;
  if (scope && visible(scope)) {
    for (const match of text(scope, 4_000).matchAll(BUY_BOX_LIMIT)) {
      const limit = parseQuantityText(match[1]);
      if (limit !== null) limits.push(limit);
    }
  }
  return limits.length ? Math.min(...limits) : null;
}

function lineSku(line: Element): string {
  for (const name of ["data-us-item-id", "data-item-id", "data-product-id"]) {
    const candidate = String(line.getAttribute(name) || "");
    if (/^\d{5,20}$/.test(candidate)) return candidate;
  }
  for (const anchor of line.querySelectorAll("a[href]")) {
    let href = anchor.getAttribute("href") || "";
    try { href = new URL(href, "https://www.walmart.com").href; } catch { href = ""; }
    const sku = extractRetailerSku("walmart", href);
    if (sku) return sku;
  }
  return "";
}

/** Which way a +/- stepper button moves the line; anything else is never a stepper button. */
function stepperDirection(element: Element): "increase" | "decrease" | "" {
  const label = String(element.getAttribute("aria-label") || element.getAttribute("title") || text(element, 200)).trim();
  if (/^(?:increase|increment)\b/i.test(label) || label === "+") return "increase";
  if (/^(?:decrease|decrement)\b/i.test(label) || /^[-−–]$/.test(label)) return "decrease";
  return "";
}

function stepperButtons(line: Element, direction: "increase" | "decrease"): Element[] {
  return [...line.querySelectorAll("button, [role='button']")]
    .filter((element) => visible(element) && stepperDirection(element) === direction);
}

// Walmart's stepper buttons name the line's quantity: "Increase quantity of
// <title>, Current Quantity 2". Every such label must agree.
function stepperLabelQuantity(line: Element): number | null | undefined {
  const labels = [...line.querySelectorAll("button[aria-label], [role='button'][aria-label]")]
    .filter(visible)
    .map((element) => String(element.getAttribute("aria-label") || ""))
    .filter((label) => /\bcurrent\s+quantity\b/i.test(label));
  if (!labels.length) return undefined;
  const readings = labels.map((label) => parseQuantityText(label.match(/\bcurrent\s+quantity\s*(?:is\s*)?:?\s*(\d+)/i)?.[1] ?? ""));
  return readings.every((reading) => reading !== null && reading === readings[0]) ? readings[0] ?? null : null;
}

// The number shown between a bare "-" and "+" with no quantity test id.
function stepperDisplayQuantity(line: Element): number | null | undefined {
  const increase = stepperButtons(line, "increase");
  if (increase.length !== 1 || !increase[0]?.parentElement || increase[0].parentElement === line) return undefined;
  const parts: string[] = [];
  for (const node of increase[0].parentElement.childNodes) {
    if (node.nodeType === 1 && (node as Element).matches("button, [role='button']")) continue;
    if (node.nodeType === 1 && !visible(node as Element)) continue;
    parts.push(String(node.textContent || ""));
  }
  return parseStepperText(parts.join(" ").slice(0, 100));
}

function lineQuantity(line: Element): number | null {
  const control = queryVisible(line, [
    "select[aria-label*='quantity' i]",
    "select[name*='quantity' i]",
    "input[aria-label*='quantity' i]",
    "input[name*='quantity' i]",
    "[data-testid*='quantity' i]"
  ]);
  // Form value, inner control or aria-valuenow first, then the lone number
  // between stepper labels ("Decrease quantity 1 Increase quantity"). Each is
  // parsed anchored, so "Quantity 100" is unreadable rather than 10 or 1.
  const read = control ? readControlQuantity(control) : null;
  // A stepper whose labels name the current quantity is read from them; a
  // control that disagrees makes the line unreadable.
  const labelled = stepperLabelQuantity(line);
  if (labelled !== undefined) return labelled !== null && (read === null || read === labelled) ? labelled : null;
  if (control) return read;
  return stepperDisplayQuantity(line) ?? null;
}

export interface WalmartCartQuantityControl {
  kind: "select" | "input" | "stepper";
  /** The line's own select, number input, or "+" button. */
  element: Element;
  /** Highest select option, input max, or a limit printed in the line. */
  storeLimit: number | null;
  /** Disabled now: a "+" at the store's limit, or while the last change is saved. */
  disabled: boolean;
  /** The line says its limit is reached ("Max qty reached"). */
  limitReached: boolean;
}

export type WalmartCartLineQuantity =
  | { ok: true; quantity: number | null; control: WalmartCartQuantityControl | null }
  | { ok: false; reason: "cart_unverified" | "quantity_line_ambiguous" };

// "Limit 2 per order", "Max 5", "Maximum quantity: 4", "limited to 3".
const LINE_LIMIT = /\b(?:limit(?:ed)?(?:\s+to)?|max(?:imum)?\.?)\s*(?:(?:qty|quantity)\s*)?(?:of\s*)?:?\s*(\d{1,2})(?!\d)/gi;
const LINE_LIMIT_REACHED = /\b(?:max(?:imum)?\.?\s*(?:qty|quantity)|(?:purchase|order|quantity)\s+limit|limit)\s+(?:has\s+been\s+|is\s+)?reached\b|\byou(?:'|’)ve\s+reached\s+the\s+(?:max(?:imum)?|limit)\b/i;

/** The line's own messages: its text without the title, links, buttons and options. */
function lineMessageText(line: Element): string {
  const copy = line.cloneNode(true) as Element;
  for (const element of copy.querySelectorAll("a, h1, h2, h3, h4, h5, h6, button, select, option, input, script, style, [hidden], [aria-hidden='true'], [data-testid*='title' i], [data-automation-id*='title' i]")) {
    element.remove();
  }
  return text(copy, 4_000);
}

function quantityLimitNumber(element: Element): number | null {
  const candidates = element.tagName === "SELECT"
    ? [...(element as HTMLSelectElement).options].map((option) => option.value)
    : [element.getAttribute("max") || ""];
  const values = candidates.map((value) => /^\s*\d{1,2}\s*$/.test(value) ? parseQuantityText(value) : null)
    .filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

function lineQuantityControl(line: Element): WalmartCartQuantityControl | null {
  const message = lineMessageText(line);
  const printed = [...message.matchAll(LINE_LIMIT)].map((match) => parseQuantityText(match[1]))
    .filter((value): value is number => value !== null);
  const printedLimit = printed.length ? Math.min(...printed) : null;
  const limitReached = LINE_LIMIT_REACHED.test(message);
  const lowest = (...values: Array<number | null>) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length ? Math.min(...known) : null;
  };
  const disabled = (element: Element) => element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
  const increase = stepperButtons(line, "increase");
  if (increase.length > 1) return null;
  if (increase.length === 1 && increase[0]) {
    return { kind: "stepper", element: increase[0], storeLimit: printedLimit, disabled: disabled(increase[0]), limitReached };
  }
  const named = (element: Element) => /quantity|qty/i.test(
    `${element.getAttribute("aria-label") || ""} ${element.getAttribute("name") || ""} ${element.id}`);
  const selects = [...line.querySelectorAll("select")].filter((element) => visible(element) && named(element));
  if (selects.length > 1) return null;
  if (selects.length === 1 && selects[0]) {
    return { kind: "select", element: selects[0], storeLimit: lowest(quantityLimitNumber(selects[0]), printedLimit),
      disabled: disabled(selects[0]), limitReached };
  }
  const inputs = [...line.querySelectorAll("input")].filter((element) => visible(element) && named(element)
    && !/^(?:hidden|checkbox|radio|submit|button)$/i.test(element.getAttribute("type") || ""));
  if (inputs.length !== 1 || !inputs[0]) return null;
  return { kind: "input", element: inputs[0], storeLimit: lowest(quantityLimitNumber(inputs[0]), printedLimit),
    disabled: disabled(inputs[0]) || inputs[0].hasAttribute("readonly"), limitReached };
}

/**
 * The one cart line for `retailerSku`, found exactly as the cart reader finds
 * lines, with its quantity and its own quantity control. A cart holding a
 * line whose item can't be read, or two lines for the item, is ambiguous.
 */
export function walmartCartLineQuantity(document: Document, retailerSku: string): WalmartCartLineQuantity {
  const elements = cartLineElements(document);
  const skus = elements.map(lineSku);
  if (skus.some((sku) => !sku)) return { ok: false, reason: "quantity_line_ambiguous" };
  const lines = elements.filter((_, index) => skus[index] === retailerSku);
  if (lines.length > 1) return { ok: false, reason: "quantity_line_ambiguous" };
  const line = lines[0];
  if (!line) return { ok: false, reason: "cart_unverified" };
  return { ok: true, quantity: lineQuantity(line), control: lineQuantityControl(line) };
}

function sellerEvidence(line: Element): { sellerName: string; sellerType: SellerType } {
  const seller = text(queryVisible(line, [
    "[data-testid='seller-display-name']",
    "[data-automation-id='seller-name']",
    "[data-testid*='seller' i]"
  ]), 1_000);
  if (/sold\s+(?:and|&)\s+shipped\s+by\s+walmart(?:\.com)?|sold\s+by\s+walmart(?:\.com)?/i.test(seller)) {
    return { sellerName: "Walmart", sellerType: "first_party" };
  }
  if (/sold\s+(?:and|&)\s+shipped\s+by|sold\s+by/i.test(seller)) {
    const name = seller
      .replace(/^.*?sold\s+(?:and|&)\s+shipped\s+by\s*/i, "")
      .replace(/^.*?sold\s+by\s*/i, "")
      .trim()
      .slice(0, 160);
    return name ? { sellerName: name, sellerType: "third_party" } : { sellerName: "", sellerType: "unknown" };
  }
  return { sellerName: "", sellerType: "unknown" };
}

function cartLineElements(document: Document): Element[] {
  const candidates = [...document.querySelectorAll(
    "[data-testid='cart-item'], [data-automation-id='cart-item'], [data-testid^='cart-item-'], [data-us-item-id][data-testid*='cart' i]"
  )].filter(visible);
  return [...new Set(candidates)]
    .filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

function visiblyEmpty(document: Document): boolean {
  const root = queryVisible(document, [
    "[data-testid*='empty-cart' i]",
    "[data-automation-id*='empty-cart' i]",
    "main"
  ]);
  return Boolean(root && /(?:your )?cart is empty|no items in (?:your )?cart|cart has no items/i.test(text(root, 20_000)));
}

export function observeWalmartCart(document: Document, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const elements = cartLineElements(document);
  const lines = elements.map((line) => {
    const seller = sellerEvidence(line);
    const quantity = lineQuantity(line);
    return {
      retailerSku: lineSku(line),
      quantity,
      unitPriceCents: readUnitPrice(line, quantity),
      sellerName: seller.sellerName,
      sellerType: seller.sellerType
    };
  });
  const independentlyCounted = elements.length > 0
    ? new Set(elements).size === elements.length
    : visiblyEmpty(document);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
    independentlyCounted,
    independentLineCount: elements.length,
    lines
  };
}

export function walmartSecurityChallenge(document: Document): boolean {
  return retailerSecurityChallenge(document);
}

export function walmartInteractiveBlock(document: Document, urlValue: string): LiveOfferObservation["interactiveBlock"] {
  return retailerInteractiveBlock(document, urlValue);
}
