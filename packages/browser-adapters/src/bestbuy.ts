import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type CartInventoryEvidence,
  type LiveOfferObservation
} from "../../browser-safety/src/index.js";
import { BESTBUY_OBSERVER_VERSION, type AdapterEnvironment, type Fulfillment, type SellerType } from "../../contracts/src/index.js";
// retailers.js first: it already loads the modules below, so the runner
// bundle keeps its module order.
import {
  extractRetailerSku,
  observeRetailerOffer,
  parseRetailerPriceElement,
  retailerAddControl,
  retailerInteractiveBlock,
  retailerSecurityChallenge
} from "./retailers.js";
import { bestBuyPageSku, bestBuyProductCode } from "./bestbuy-identity.js";
import { parseQuantityText, renderedVisible } from "./dom.js";
import { selectorsFor } from "./selector-packs.js";

export { BESTBUY_OBSERVER_VERSION };

const BESTBUY_MERCHANDISING_SCOPE = selectorsFor("bestbuy", "merchandisingScope").join(", ");

function text(value: Element | Document | null | undefined, maximum = 2_000): string {
  return String(value?.textContent || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function visibleSelf(element: Element): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
  const style = String(element.getAttribute("style") || "").replace(/\s+/g, "").toLocaleLowerCase("en-US");
  return !/(?:^|;)display:none(?:;|$)|(?:^|;)visibility:hidden(?:;|$)/.test(style);
}

function visible(element: Element | null): element is Element {
  if (!element) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (!visibleSelf(current)) return false;
  }
  return true;
}

// Visible text under `root`, skipping hidden subtrees, `skip` subtrees and
// form option lists: a <select> lists every option ("12345"), never a value.
function scopedText(
  root: Element,
  skip: (element: Element) => boolean,
  maximum = 30_000,
  shown: (element: Element) => boolean = visibleSelf
): string {
  const parts: string[] = [];
  let size = 0;
  const visit = (node: Node): void => {
    if (size >= maximum) return;
    if (node.nodeType === 3) {
      const value = node.textContent || "";
      parts.push(value);
      size += value.length;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SELECT"].includes(element.tagName)) return;
    if (element !== root && (!shown(element) || skip(element))) return;
    for (const child of element.childNodes) visit(child);
  };
  visit(root);
  return parts.join(" ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function queryVisible(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const found = [...root.querySelectorAll(selector)].find(visible);
    if (found) return found;
  }
  return null;
}

function bestBuyHost(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password
    && (url.hostname === "bestbuy.com" || url.hostname.endsWith(".bestbuy.com"));
}

export function bestBuyPageKind(urlValue: string, document?: Document): LiveOfferObservation["pageKind"] {
  try {
    const url = new URL(urlValue);
    if (!bestBuyHost(url)) return "other";
    const path = url.pathname.toLocaleLowerCase("en-US");
    if (/\/identity\/(?:global\/)?signin|\/login|\/signin|\/challenge/.test(path)) return "auth";
    if (/waiting-room|virtual-queue|\/queue(?:\/|$)|^\/qp(?:\/|$)/.test(path)) return "queue";
    if (/^\/cart(?:\/|$)/.test(path)) return "cart";
    if (/^\/(?:checkout|payment|purchase)(?:\/|$)/.test(path)) return "checkout";
    return extractRetailerSku("bestbuy", urlValue, document) ? "product" : "other";
  } catch {
    return "other";
  }
}

export function bestBuyAddControl(
  documentValue: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  environment?: AdapterEnvironment
): Element | null {
  if (requiredFulfillment !== "shipping" && requiredFulfillment !== "pickup") return null;
  if (retailerInteractiveBlock(documentValue, urlValue, environment)) return null;
  return retailerAddControl(documentValue, urlValue, "bestbuy", expectedSku, requiredFulfillment, environment);
}

export function observeBestBuyOffer(
  documentValue: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  observedAt = new Date().toISOString(),
  environment?: AdapterEnvironment
): LiveOfferObservation {
  const observation = observeRetailerOffer(
    documentValue,
    urlValue,
    "bestbuy",
    expectedSku,
    requiredFulfillment,
    observedAt,
    environment
  );
  return { ...observation, pageKind: bestBuyPageKind(urlValue, documentValue) };
}

// ---------------------------------------------------------------------------
// Product page: honest unavailability, purchase limit, product-code binding.

// The product page names the required fulfillment unavailable for this exact
// SKU in its fulfillment tiles ("Shipping Unavailable"). Only this is stock
// evidence; an Add control that failed to bind is not.
const FULFILLMENT_UNAVAILABLE = /\b(?:unavailable|not available|not eligible|sold out|out of stock)\b/i;

export function bestBuyFulfillmentUnavailable(
  documentValue: Document,
  expectedSku: string,
  fulfillment: Fulfillment,
  environment?: AdapterEnvironment
): boolean {
  if (!/^\d{5,20}$/.test(expectedSku) || (fulfillment !== "shipping" && fulfillment !== "pickup")) return false;
  const tiles = [...documentValue.querySelectorAll(
    `[data-testid='pdp-${fulfillment}-tile-${expectedSku}'], [data-testid='pdp-${fulfillment}-tile-${expectedSku}-selected']`
  )].filter((tile) => renderedVisible(tile, environment) && !tile.closest(BESTBUY_MERCHANDISING_SCOPE));
  return tiles.length > 0 && tiles.every((tile) =>
    FULFILLMENT_UNAVAILABLE.test(`${tile.getAttribute("aria-label") || ""} ${text(tile, 500)}`));
}

// The product page's Shipping/Pickup choices are still Best Buy's loading
// placeholder (the browser draws them after the page loads).
export function bestBuyFulfillmentLoading(documentValue: Document, environment?: AdapterEnvironment): boolean {
  return [...documentValue.querySelectorAll("[data-testid='fulfillment-selector-loading']")]
    .some((element) => renderedVisible(element, environment) && !element.closest(BESTBUY_MERCHANDISING_SCOPE));
}

const ADD_INTENT = /\badd(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)\b|\bpre[ -]?order\b/i;
// "Limit 2 per customer", "Limit of 1 per order", "Limited to 3 per household".
const PURCHASE_LIMIT = /\blimit(?:ed)?(?:\s+(?:of|to))?\s+(\d{1,2})\s+(?:per|each)\s+(?:customer|order|household|guest|account|person|member|transaction)s?\b/gi;

function wholeQuantity(value: unknown): number | null {
  const candidate = String(value ?? "").trim();
  return /^\d{1,2}$/.test(candidate) && Number(candidate) >= 1 ? Number(candidate) : null;
}

function purchaseLimits(value: string): number[] {
  return [...value.matchAll(PURCHASE_LIMIT)]
    .map((match) => wholeQuantity(match[1]))
    .filter((limit): limit is number => limit !== null);
}

// Offline replay supplies the captured visibility; a live page uses the
// same inline visibility as the rest of this adapter.
function replayVisibility(environment?: AdapterEnvironment): (element: Element) => boolean {
  const isVisible = environment?.isVisible;
  if (!isVisible) return visible;
  return (element) => {
    try { return isVisible(element); } catch { return false; }
  };
}

function addIntentControls(root: Element, shown: (element: Element) => boolean): Element[] {
  return [...root.querySelectorAll("button, [role='button'], input[type='submit']")]
    .filter((element) => shown(element) && !element.closest(BESTBUY_MERCHANDISING_SCOPE)
      && ADD_INTENT.test(`${element.getAttribute("aria-label") || ""} ${element.getAttribute("value") || ""} ${text(element, 200)}`));
}

// The primary buy box around the bound Add control: its widest ancestor that
// holds no other Add action (accessories, sticky duplicates, carousels).
function bestBuyBuyBox(control: Element, shown: (element: Element) => boolean): Element | null {
  let root: Element | null = null;
  for (let node = control.parentElement; node && !["MAIN", "BODY", "HTML"].includes(node.tagName); node = node.parentElement) {
    if (addIntentControls(node, shown).some((other) => other !== control && !other.contains(control) && !control.contains(other))) break;
    root = node;
  }
  return root;
}

/**
 * The store's own per-customer or per-order limit stated in the primary buy
 * box of the bound Add control ("Limit 2 per customer"), or null when the
 * page states none. When several limits are stated the lowest one wins.
 */
export function bestBuyPurchaseLimit(control: Element | null, environment?: AdapterEnvironment): number | null {
  const shown = replayVisibility(environment);
  const root = control ? bestBuyBuyBox(control, shown) : null;
  if (!root) return null;
  const limits = purchaseLimits(scopedText(root, (element) => element.matches(BESTBUY_MERCHANDISING_SCOPE), 30_000,
    environment?.isVisible ? shown : visibleSelf));
  return limits.length ? Math.min(...limits) : null;
}

/**
 * The product code (`/product/<slug>/<code>`) of a verified product page whose
 * own evidence names exactly `expectedSku`. Cart lines that link only to that
 * product code can be matched to the job through it; nothing else can.
 */
export function bestBuyBoundProductCode(documentValue: Document, urlValue: string, expectedSku: string): string {
  if (!/^\d{5,20}$/.test(expectedSku) || extractRetailerSku("bestbuy", urlValue, documentValue) !== expectedSku) return "";
  const own = bestBuyProductCode(urlValue);
  if (own) return own;
  // A legacy /site/...p route: its canonical product URL may name the code.
  const codes = new Set<string>();
  for (const element of documentValue.querySelectorAll("link[rel='canonical'], meta[property='og:url']")) {
    let href = "";
    try { href = new URL(element.getAttribute("href") || element.getAttribute("content") || "", urlValue).href; } catch { continue; }
    const code = bestBuyProductCode(href);
    if (code && bestBuyPageSku(documentValue, href) === expectedSku) codes.add(code);
  }
  return codes.size === 1 ? [...codes][0] ?? "" : "";
}

// ---------------------------------------------------------------------------
// Cart page.

/** A product page proved that `productCode` shows `retailerSku` (carried on the add proof). */
export interface BestBuyCartBinding {
  productCode: string;
  retailerSku: string;
}

// Rows nested in a cart line that describe something else: protection plans
// and merchandising. Their SKUs, prices and pickers are not the line's. Kept
// narrow: a matched wrapper around the whole line would hide the line itself.
const CART_SIDE_SCOPE = [
  BESTBUY_MERCHANDISING_SCOPE,
  "[class*='protection-plan' i]",
  "[class*='geek-squad' i]",
  "[class*='geeksquad' i]",
  "[data-testid*='protection' i]",
  "[data-testid*='warranty' i]",
  "[data-testid*='geek-squad' i]"
].join(", ");

function sideScoped(element: Element, line: Element): boolean {
  for (let node: Element | null = element; node && node !== line; node = node.parentElement) {
    if (node.matches(CART_SIDE_SCOPE)) return true;
  }
  return false;
}

function lineParts(line: Element, selector: string): Element[] {
  return [...line.querySelectorAll(selector)].slice(0, 5_000).filter((element) => !sideScoped(element, line));
}

function lineText(line: Element, maximum = 20_000): string {
  return scopedText(line, (element) => element.matches(CART_SIDE_SCOPE), maximum);
}

const SKU_VALUE = /^\d{5,20}$/;
const SKU_QUERY = /[?&]skuId=(\d{5,20})(?!\d)/gi;
const URL_ATTRIBUTES = ["href", "data-href", "data-url", "data-link", "action"];

interface LineIdentity {
  sku: string;
  code: string;
}

// A line is identified by the one numeric SKU its own evidence names: its
// data-sku-id/data-sku attributes, skuId= parameters, /site/...<sku>.p and
// /product/.../sku/<sku> links, or "SKU: n" text. Evidence naming two SKUs
// is unidentifiable. With no SKU at all, a single /product/<slug>/<code>
// link identifies the line by that product code.
function lineIdentity(line: Element): LineIdentity {
  for (const name of ["data-sku-id", "data-sku", "data-product-id"]) {
    const own = String(line.getAttribute(name) || "").trim();
    if (SKU_VALUE.test(own)) return { sku: own, code: "" };
  }
  const skus = new Set<string>();
  const codes = new Set<string>();
  const add = (value: unknown): void => {
    const candidate = String(value ?? "").trim();
    if (SKU_VALUE.test(candidate)) skus.add(candidate);
  };
  for (const element of lineParts(line, "*")) {
    add(element.getAttribute("data-sku-id"));
    add(element.getAttribute("data-sku"));
    if (element.tagName === "INPUT" && /sku/i.test(element.getAttribute("name") || "")) add((element as HTMLInputElement).value);
    for (const name of URL_ATTRIBUTES) {
      const raw = element.getAttribute(name);
      if (!raw) continue;
      for (const match of raw.matchAll(SKU_QUERY)) add(match[1]);
      let href = "";
      try { href = new URL(raw, "https://www.bestbuy.com").href; } catch { continue; }
      add(extractRetailerSku("bestbuy", href));
      const code = bestBuyProductCode(href);
      if (code) codes.add(code);
    }
  }
  for (const match of lineText(line).matchAll(/\bSKU\s*:?\s*(\d{5,20})\b/gi)) add(match[1]);
  if (skus.size > 0) return { sku: skus.size === 1 ? [...skus][0] ?? "" : "", code: "" };
  return { sku: "", code: codes.size === 1 ? [...codes][0] ?? "" : "" };
}

// A product-code key is never numeric, so it cannot be mistaken for a SKU.
// It becomes the job's SKU only through the code its product page proved.
function lineKey(identity: LineIdentity, binding?: BestBuyCartBinding | null): string {
  if (identity.sku) return identity.sku;
  if (!identity.code) return "";
  return binding && identity.code === binding.productCode ? binding.retailerSku : identity.code;
}

const QUANTITY_HINT = /qty|quantity/i;
const STEPPER_FORBIDDEN = /\b(?:cart|checkout|buy|save|remove|delete|trash|protection|plan|warranty|pickup|shipping|member|membership)\b/i;
const TEXT_INPUT = "input:not([type]), input[type='text'], input[type='number'], input[type='tel']";

function controlLabel(element: Element): string {
  const labelledBy = String(element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
    .map((id) => text(element.ownerDocument.getElementById(id), 200)).join(" ");
  const labels = [...((element as HTMLInputElement).labels || [])]
    .map((label) => scopedText(label, () => false, 200)).join(" ");
  return [element.getAttribute("aria-label"), element.getAttribute("title"), labelledBy, labels].filter(Boolean).join(" ");
}

function quantityHinted(element: Element): boolean {
  return ["name", "id", "class", "data-testid", "data-test", "data-automation-id"]
    .some((name) => QUANTITY_HINT.test(element.getAttribute(name) || ""))
    || QUANTITY_HINT.test(controlLabel(element));
}

function optionQuantity(option: HTMLOptionElement): number | null {
  return wholeQuantity(option.value) ?? parseQuantityText(option.textContent);
}

function numericOptions(select: HTMLSelectElement): boolean {
  const options = [...select.options];
  return options.length > 0 && options.every((option) => optionQuantity(option) !== null);
}

function buttonLabel(element: Element): string {
  return `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${text(element, 80)}`
    .replace(/\s+/g, " ").trim();
}

function increaseButton(element: Element): boolean {
  const label = buttonLabel(element);
  if (!label || label.length > 80 || STEPPER_FORBIDDEN.test(label)) return false;
  return /^[+＋]$/.test(label)
    || /^(?:increase|increment|add one|plus one|plus)$/i.test(label)
    || (/\b(?:increase|increment)\b/i.test(label) && QUANTITY_HINT.test(label));
}

// The value a +/- stepper shows: a form control, a spinbutton or one bare
// number next to the "+" button. Anything else is unreadable.
function stepperValue(button: Element, line: Element): Element | null {
  for (let node = button.parentElement, depth = 0; node && depth < 4; node = node === line ? null : node.parentElement, depth += 1) {
    const parts = [...node.querySelectorAll("select, input, [role='spinbutton'], output, span, div, p, strong, b, label")]
      .filter((element) => element !== button && !button.contains(element) && !element.contains(button)
        && !element.matches("input[type='hidden'], input[type='checkbox'], input[type='radio'], input[type='submit'], input[type='button']")
        && visible(element) && !sideScoped(element, line));
    const formLike = parts.filter((element) => ["SELECT", "INPUT"].includes(element.tagName) || element.getAttribute("role") === "spinbutton");
    if (formLike.length) return formLike.length === 1 ? formLike[0] ?? null : null;
    const displays = parts.filter((element) => element.childElementCount === 0
      && /^\s*(?:(?:qty|quantity)\s*:?\s*)?\d{1,2}\s*$/i.test(element.textContent || ""));
    if (displays.length) return displays.length === 1 ? displays[0] ?? null : null;
  }
  return null;
}

type QuantityKind = "select" | "input" | "spinbutton" | "stepper";

interface QuantityControl {
  kind: QuantityKind;
  element: Element;
  increase: Element | null;
}

function quantityControls(line: Element): { controls: QuantityControl[]; unreadableStepper: boolean } {
  const controls: QuantityControl[] = [];
  const add = (kind: QuantityKind, element: Element, increase: Element | null = null): void => {
    const existing = controls.find((control) => control.element === element);
    if (existing) {
      if (!existing.increase) existing.increase = increase;
      return;
    }
    controls.push({ kind, element, increase });
  };
  for (const select of lineParts(line, "select")) {
    if (visible(select) && (quantityHinted(select) || numericOptions(select as HTMLSelectElement))) add("select", select);
  }
  for (const input of lineParts(line, TEXT_INPUT)) {
    if (visible(input) && quantityHinted(input)) add("input", input);
  }
  for (const spin of lineParts(line, "[role='spinbutton']")) {
    if (!["SELECT", "INPUT"].includes(spin.tagName) && visible(spin)) add("spinbutton", spin);
  }
  let unreadableStepper = false;
  for (const button of lineParts(line, "button, [role='button']")) {
    if (!visible(button) || !increaseButton(button)) continue;
    const value = stepperValue(button, line);
    if (!value) {
      unreadableStepper = true;
      continue;
    }
    add(value.tagName === "SELECT" ? "select" : value.tagName === "INPUT" ? "input"
      : value.getAttribute("role") === "spinbutton" ? "spinbutton" : "stepper", value, button);
  }
  return { controls, unreadableStepper };
}

function controlQuantity(control: QuantityControl): number | null {
  const element = control.element;
  if (element.tagName === "SELECT") {
    const select = element as HTMLSelectElement;
    const option = select.selectedOptions.length === 1 ? select.selectedOptions[0] : undefined;
    return option ? optionQuantity(option) : null;
  }
  if (element.tagName === "INPUT") return wholeQuantity((element as HTMLInputElement).value);
  const now = element.getAttribute("aria-valuenow");
  if (now !== null && now.trim()) return wholeQuantity(now);
  return parseQuantityText(element.textContent);
}

// A line without any quantity control may still say "Qty 2" as plain text.
function staticQuantity(line: Element): number | null {
  const readings = new Set<number>();
  for (const element of lineParts(line, "span, div, p, strong, b, label, output, dd, td")) {
    if (element.childElementCount > 2 || !visible(element)) continue;
    const value = scopedText(element, () => false, 120);
    if (!/^(?:qty|quantity)\s*:?\s*\d{1,2}$/i.test(value)) continue;
    const quantity = parseQuantityText(value);
    if (quantity !== null) readings.add(quantity);
  }
  return readings.size === 1 ? [...readings][0] ?? null : null;
}

// The line quantity from its own control: the selected option of a select
// (never the option list), an input value, a spinbutton or the number a
// +/- stepper shows. Controls that disagree or cannot be read are null.
function lineQuantity(line: Element, controls = quantityControls(line)): number | null {
  if (!controls.controls.length) return controls.unreadableStepper ? null : staticQuantity(line);
  const readings = controls.controls.map(controlQuantity);
  const first = readings[0] ?? null;
  return first !== null && readings.every((reading) => reading === first) ? first : null;
}

const LINE_PRICE_SELECTORS = [
  "[data-testid='customer-price']",
  "[data-testid*='line-price' i]",
  "[data-testid*='price' i]",
  ".priceView-customer-price",
  ".priceView-hero-price",
  "[itemprop='price']"
];
const UNIT_PRICE_SELECTORS = ["[data-testid*='unit-price' i]", "[class*='unit-price' i]"];
const EACH_PRICE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:each\b|ea\b|\/\s*ea(?:ch)?\b|per\s+(?:item|unit)\b)/i;

function firstLinePrice(line: Element, selectors: readonly string[]): number | null {
  for (const selector of selectors) {
    for (const element of lineParts(line, selector)) {
      if (!visible(element)) continue;
      const price = parseRetailerPriceElement(element);
      if (price !== null) return price;
    }
  }
  return null;
}

// A cart row shows the line total; the unit-cap check needs one unit's price.
// Read a stated per-unit price first; otherwise divide the line total by the
// line quantity, rounding up so the cap never sees less than the real price.
function lineUnitPrice(line: Element, quantity: number | null): number | null {
  const unit = firstLinePrice(line, UNIT_PRICE_SELECTORS);
  if (unit !== null) return unit;
  const each = lineText(line).match(EACH_PRICE)?.[1];
  if (each) {
    const cents = Math.round(Number(each.replace(/,/g, "")) * 100);
    if (Number.isSafeInteger(cents) && cents > 0) return cents;
  }
  const shown = firstLinePrice(line, LINE_PRICE_SELECTORS);
  if (shown === null) return null;
  return quantity !== null && quantity > 1 ? Math.ceil(shown / quantity) : shown;
}

function sellerEvidence(line: Element): { sellerName: string; sellerType: SellerType } {
  let sellerElement: Element | null = null;
  for (const selector of ["[data-testid='sold-by']", "[data-testid*='sold-by' i]", "[data-testid*='seller' i]", "[class*='seller' i]"]) {
    sellerElement = lineParts(line, selector).find(visible) ?? null;
    if (sellerElement) break;
  }
  const evidence = sellerElement ? text(sellerElement, 12_000) : lineText(line, 12_000);
  if (/sold\s+(?:and|&)\s+shipped\s+by\s+best\s*buy|sold\s+by\s+best\s*buy/i.test(evidence)) {
    return { sellerName: "Best Buy", sellerType: "first_party" };
  }
  const marketplace = evidence.match(/sold\s+(?:and|&)\s+shipped\s+by\s+(.{1,160}?)(?:\s+(?:return|shipping|pickup|quantity|qty|\$)|$)/i)?.[1]
    ?? evidence.match(/sold\s+by\s+(.{1,160}?)(?:\s+(?:return|shipping|pickup|quantity|qty|\$)|$)/i)?.[1]
    ?? "";
  const sellerName = marketplace.trim().slice(0, 160);
  return sellerName
    ? { sellerName, sellerType: "third_party" }
    : { sellerName: "", sellerType: "unknown" };
}

function cartLineElements(documentValue: Document): Element[] {
  const candidates = [...documentValue.querySelectorAll(
    "[data-testid='cart-item'], [data-testid^='cart-item-'], [data-sku-id][class*='cart' i], li.item-list-item, [class~='cart-item']"
  )].filter(visible);
  return [...new Set(candidates)]
    .filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

function visiblyEmpty(documentValue: Document): boolean {
  const root = queryVisible(documentValue, ["[data-testid*='empty-cart' i]", "main", "body"]);
  return Boolean(root && /(?:your )?cart is empty|no items in (?:your )?cart|cart has no items/i.test(text(root, 40_000)));
}

export interface BestBuyCartLine {
  element: Element;
  /** The line's SKU; a product code when the line names no SKU and no binding applies; "" when unidentifiable. */
  retailerSku: string;
  quantity: number | null;
  unitPriceCents: number | null;
  sellerName: string;
  sellerType: SellerType;
}

/** Every counted cart line with its identity under an optional product-code binding. */
export function bestBuyCartLines(
  documentValue: Document,
  binding?: BestBuyCartBinding | null
): { lines: BestBuyCartLine[]; independentlyCounted: boolean } {
  const elements = cartLineElements(documentValue);
  const lines = elements.map((element) => {
    const seller = sellerEvidence(element);
    const quantity = lineQuantity(element);
    return {
      element,
      retailerSku: lineKey(lineIdentity(element), binding),
      quantity,
      unitPriceCents: lineUnitPrice(element, quantity),
      sellerName: seller.sellerName,
      sellerType: seller.sellerType
    };
  });
  const independentlyCounted = elements.length > 0
    ? new Set(elements).size === elements.length
    : visiblyEmpty(documentValue);
  return { lines, independentlyCounted };
}

export function observeBestBuyCart(
  documentValue: Document,
  observedAt = new Date().toISOString(),
  binding?: BestBuyCartBinding | null
): CartInventoryEvidence {
  const { lines, independentlyCounted } = bestBuyCartLines(documentValue, binding);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
    independentlyCounted,
    independentLineCount: lines.length,
    lines: lines.map(({ retailerSku, quantity, unitPriceCents, sellerName, sellerType }) =>
      ({ retailerSku, quantity, unitPriceCents, sellerName, sellerType }))
  };
}

// "Limit 2 per customer", "Max quantity: 3", "Maximum of 2 per order".
const LINE_LIMIT = /\blimit(?:ed)?(?:\s+(?:of|to))?\s+(\d{1,2})\s+(?:per|each)\b|\bmax(?:imum)?\s+(?:qty|quantity|purchase quantity|order quantity)(?:\s+(?:of|is))?\s*:?\s*(\d{1,2})\b|\bmax(?:imum)?\s+(?:of\s+)?(\d{1,2})\s+per\b/gi;
const LIMIT_MESSAGE = /\blimit(?:ed)?(?:\s+(?:of|to))?\s+\d{1,2}\s+(?:per|each)\b|\b(?:quantity|purchase|order)\s+limit\b|\blimit\s+reached\b|\breached\s+(?:the|your)\s+(?:maximum|limit)\b|\bmax(?:imum)?\s+(?:qty|quantity)\b/i;

export interface BestBuyLineQuantityState {
  /** The quantity the line shows, null when unreadable or ambiguous. */
  quantity: number | null;
  kind: QuantityKind | "none";
  /** The select/input to set, or the value a stepper shows. */
  control: Element | null;
  /** The line's "+" button, when it has one. */
  increase: Element | null;
  increaseEnabled: boolean;
  disabled: boolean;
  /** The lowest of the highest select option, the input max and any "Limit N per..." text in the line. */
  storeLimit: number | null;
  /** The line shows a quantity-limit message. */
  limitMessage: boolean;
}

function disabledControl(element: Element | null): boolean {
  return Boolean(element && (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true"
    || element.closest("fieldset[disabled]")));
}

export function bestBuyLineQuantityState(line: Element): BestBuyLineQuantityState {
  const found = quantityControls(line);
  const quantity = lineQuantity(line, found);
  const controls = found.controls;
  const chosen = controls.find((control) => control.kind === "select")
    ?? controls.find((control) => control.kind === "input")
    ?? controls.find((control) => Boolean(control.increase))
    ?? controls[0]
    ?? null;
  const limits: number[] = [];
  if (chosen?.kind === "select") {
    const values = [...(chosen.element as HTMLSelectElement).options]
      .filter((option) => !option.disabled)
      .map(optionQuantity)
      .filter((value): value is number => value !== null);
    if (values.length) limits.push(Math.max(...values));
  }
  if (chosen?.kind === "input") {
    const maximum = wholeQuantity(chosen.element.getAttribute("max"));
    if (maximum !== null) limits.push(maximum);
  }
  for (const control of controls) {
    const maximum = wholeQuantity(control.element.getAttribute("aria-valuemax"));
    if (maximum !== null) limits.push(maximum);
  }
  const words = lineText(line);
  for (const match of words.matchAll(LINE_LIMIT)) {
    const limit = wholeQuantity(match[1] ?? match[2] ?? match[3]);
    if (limit !== null) limits.push(limit);
  }
  const increase = chosen?.increase ?? null;
  return {
    quantity,
    kind: chosen?.kind ?? "none",
    control: chosen?.element ?? null,
    increase,
    increaseEnabled: Boolean(increase) && !disabledControl(increase),
    disabled: disabledControl(chosen?.element ?? null),
    storeLimit: limits.length ? Math.min(...limits) : null,
    limitMessage: LIMIT_MESSAGE.test(words)
  };
}

export function bestBuySecurityChallenge(documentValue: Document): boolean {
  return retailerSecurityChallenge(documentValue, "bestbuy");
}

export function bestBuyInteractiveBlock(documentValue: Document, urlValue: string): LiveOfferObservation["interactiveBlock"] {
  return retailerInteractiveBlock(documentValue, urlValue);
}

export interface BestBuyPostAddState {
  state: "queue" | "product" | "cart" | "user_action" | "unknown";
  reason: string;
  addControlActionable: boolean;
}

/** Passive only: a click receipt is not proof that the store has finished adding. */
export function observeBestBuyPostAdd(
  document: Document,
  urlValue: string,
  expectedSku: string,
  fulfillment: Fulfillment,
  environment?: AdapterEnvironment
): BestBuyPostAddState {
  const result = (state: BestBuyPostAddState["state"], reason: string, addControlActionable = false) => ({ state, reason, addControlActionable });
  let url: URL;
  try { url = new URL(urlValue); } catch { return result("user_action", "page_changed"); }
  if (!bestBuyHost(url) || url.port || document.URL !== urlValue || !/^\d{5,20}$/.test(expectedSku)) return result("user_action", "page_changed");
  const kind = bestBuyPageKind(urlValue, document);
  const isVisible = (e: Element): boolean => {
    if (environment?.isVisible) return environment.isVisible(e);
    for (let p: Element | null = e; p; p = p.parentElement) {
      if (p.hasAttribute("hidden") || p.hasAttribute("inert") || p.getAttribute("aria-hidden") === "true") return false;
      const style = document.defaultView?.getComputedStyle(p);
      if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
    }
    return true;
  };
  const visibleText = (root: Element): string => {
    const parts: string[] = [];
    const visit = (node: Node): void => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes((node as Element).tagName)
        && isVisible(node as Element)) for (const child of node.childNodes) visit(child);
    };
    visit(root);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };
  if (bestBuySecurityChallenge(document)) return result("user_action", "security_challenge");
  const block = retailerInteractiveBlock(document, urlValue, environment);
  if (kind === "auth" || ["auth", "mfa", "location", "membership"].includes(block)) return result("user_action", "manual_action_required");
  const page = visibleText(document.body);
  if (kind === "queue" || block === "queue" || block === "high_demand"
    || /\b(?:you(?:['’]re| are) in (?:the )?line|virtual queue|waiting room|(?:your )?place in line|please (?:do not|don['’]t) (?:refresh|leave|close))\b/i.test(page)) {
    return result("queue", "bestbuy_queue_waiting");
  }
  if (block) return result("user_action", "manual_action_required");
  if ([...document.querySelectorAll("dialog[open], [role=dialog], [aria-modal=true]")]
    .some(e => isVisible(e) && !/\badded to (?:your )?cart\b/i.test(visibleText(e)))) return result("user_action", "manual_action_required");
  if (kind === "cart") return result("cart", "cart_page");
  if (kind !== "product") return result("unknown", "post_add_state_unknown");
  if (extractRetailerSku("bestbuy", urlValue, document) !== expectedSku) return result("user_action", "listing_mismatch");
  const waitingControl = [...document.querySelectorAll(
    `[data-testid='pdp-add-to-cart-${expectedSku}'], [data-sku-id='${expectedSku}'] button, [data-sku='${expectedSku}'] button`
  )].some(e => isVisible(e) && /^(?:please wait|checking (?:inventory|availability)|getting in line)[.!…\s]*$/i.test(visibleText(e)));
  if (waitingControl) return result("queue", "bestbuy_queue_waiting");
  return result("product", "awaiting_cart", Boolean(bestBuyAddControl(document, urlValue, expectedSku, fulfillment, environment)));
}
