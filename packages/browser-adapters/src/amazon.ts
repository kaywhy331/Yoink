import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type CartInventoryEvidence,
  type CartLineEvidence,
  type LiveOfferObservation
} from "../../browser-safety/src/index.js";
import { AMAZON_OBSERVER_VERSION, type AdapterEnvironment, type Fulfillment, type SellerType } from "../../contracts/src/index.js";
import { parseQuantityText, parseStepperText } from "./dom.js";
import {
  amazonEvidenceText,
  amazonOfferBinding,
  amazonQuantityShown,
  extractRetailerSku,
  observeRetailerOffer,
  parseRetailerPriceElement,
  retailerInteractiveBlock,
  retailerSecurityChallenge
} from "./retailers.js";

export { AMAZON_OBSERVER_VERSION, amazonQuantityShown };

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

function readPrice(root: ParentNode): number | null {
  for (const selector of [
    ".sc-product-price",
    ".sc-price",
    "[data-testid*='price' i]",
    ".a-price .a-offscreen",
    "[itemprop='price']"
  ]) {
    for (const element of root.querySelectorAll(selector)) {
      if (!visible(element)) continue;
      const price = parseRetailerPriceElement(element);
      if (price !== null) return price;
    }
  }
  return null;
}

function amazonHost(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password
    && (url.hostname === "amazon.com" || url.hostname.endsWith(".amazon.com"));
}

export function amazonPageKind(urlValue: string): LiveOfferObservation["pageKind"] {
  try {
    const url = new URL(urlValue);
    if (!amazonHost(url)) return "other";
    const path = url.pathname.toLocaleLowerCase("en-US");
    if (/\/ap\/(?:signin|cvf|mfa)|\/gp\/css\/account/.test(path)) return "auth";
    if (/waiting-room|virtual-queue|\/queue(?:\/|$)/.test(path)) return "queue";
    if (/^\/(?:gp\/cart\/view\.html|cart)(?:\/|$)/.test(path)) return "cart";
    if (/^\/(?:checkout|hz\/checkout|gp\/buy)(?:\/|$)/.test(path)) return "checkout";
    return extractRetailerSku("amazon", urlValue) ? "product" : "other";
  } catch {
    return "other";
  }
}

/**
 * The exact offer's Add control. The page's quantity controls must read
 * `quantity` (1 unless the runner set the dropdown); `null` skips that
 * reading so the runner can find the dropdown before setting it.
 */
export function amazonAddBinding(
  documentValue: Document,
  urlValue: string,
  expectedAsin: string,
  requiredFulfillment: Fulfillment,
  environment?: AdapterEnvironment,
  quantity: number | null = 1
): { control: Element; offerListingId: string; offerRoot: Element } | null {
  if (requiredFulfillment !== "shipping" && requiredFulfillment !== "pickup") return null;
  if (amazonInteractiveBlock(documentValue, urlValue)) return null;
  return amazonOfferBinding(documentValue, urlValue, expectedAsin, requiredFulfillment, environment, quantity);
}

export interface AmazonQuantityPlan {
  requested: number;
  /** Amazon's own per-order limit for this offer, when the page shows one. */
  storeLimit: number | null;
  /** How many the Add submits. */
  add: number;
  /** The total still wanted on the cart line after the add (Amazon raises nothing later). */
  raiseTo: number;
  /** The Add form's quantity dropdown, when it has exactly one. */
  select: HTMLSelectElement | null;
}

const QUANTITY_SELECT = "select#quantity, select[name='quantity']";
const BUY_BOX = "#buybox, #desktop_buybox, [data-feature-name='buybox']";
const LIMIT_TEXT = /\blimit(?:ed)?\s+(?:to\s+)?(\d{1,3})\s+(?:(?:units?|items?)\s+)?(?:per|each)\s+(?:customer|order|household|account|person)\b|\b(?:max(?:imum)?\s+(?:order\s+)?quantity|purchase\s+limit)\s*(?:is|of|:)?\s*(\d{1,3})\b/gi;

function wholeQuantity(value: unknown, maximum = 99): number | null {
  const raw = String(value ?? "").trim();
  const quantity = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= maximum ? quantity : null;
}

// A coupon's or promotion's own terms ("limit 1 per customer") are not the item's limit.
const NOT_ITEM_LIMIT = "[id*='coupon' i], [id*='promotion' i], [id*='promo' i], [class*='coupon' i]";

/** "Limit 2 per customer" style text shown in the buy box; the smallest wins. */
function shownLimit(root: Element | null): number | null {
  const limits = [...amazonEvidenceText(root, 20_000, NOT_ITEM_LIMIT).matchAll(LIMIT_TEXT)]
    .map((match) => wholeQuantity(match[1] ?? match[2], 999))
    .filter((limit): limit is number => limit !== null);
  return limits.length ? Math.min(...limits) : null;
}

/**
 * Read-only quantity plan for the bound Add control. Amazon caps its quantity
 * dropdown at the offer's purchase limit, so the highest numbered option is
 * the store's limit (a "5+" / bulk option has no number and never counts).
 * The Add submits the dropdown in its own form: with one there, the add is
 * min(requested, limit) rounded down to an option; without one it is 1.
 */
export function amazonQuantityPlan(control: Element, requested: number): AmazonQuantityPlan | { reason: string } {
  const form = control.closest("form");
  const selects = form ? [...form.querySelectorAll<HTMLSelectElement>(QUANTITY_SELECT)].filter(visible) : [];
  if (requested > 1 && selects.length > 1) return { reason: "quantity_control_unavailable" };
  const select = selects.length === 1 ? selects[0] ?? null : null;
  const options = select
    ? [...select.options].filter((option) => !option.disabled)
      .map((option) => wholeQuantity(option.value, 999))
      .filter((value): value is number => value !== null)
    : [];
  const highestOption = options.length ? Math.max(...options) : null;
  const textLimit = shownLimit(control.closest(BUY_BOX) || form);
  const limits = [highestOption, textLimit].filter((limit): limit is number => limit !== null);
  const storeLimit = limits.length ? Math.min(...limits) : null;
  if (!select || requested <= 1) return { requested, storeLimit, add: 1, raiseTo: 1, select };
  const wanted = Math.min(requested, storeLimit ?? requested);
  const add = Math.max(1, ...options.filter((option) => option <= wanted));
  if (select.disabled && add > 1) return { reason: "quantity_control_unavailable" };
  return { requested, storeLimit, add, raiseTo: add, select };
}

export function observeAmazonOffer(
  documentValue: Document,
  urlValue: string,
  expectedAsin: string,
  requiredFulfillment: Fulfillment,
  observedAt = new Date().toISOString(),
  environment?: AdapterEnvironment
): LiveOfferObservation {
  const observation = observeRetailerOffer(
    documentValue,
    urlValue,
    "amazon",
    expectedAsin,
    requiredFulfillment,
    observedAt,
    environment
  );
  return { ...observation, pageKind: amazonPageKind(urlValue) };
}

function cartLineElements(documentValue: Document): Element[] {
  const candidates = [...documentValue.querySelectorAll(
    "#sc-active-cart .sc-list-item, [data-name='Active Items'] .sc-list-item, [data-testid='cart-item']"
  )].filter((element) => visible(element) && element.getAttribute("data-removed") !== "true");
  return [...new Set(candidates)]
    .filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

// Amazon's cart hides its alternate quantity controls with classes (the "10+"
// text box is `sc-hidden` until chosen).
const CART_UNSHOWN = ".sc-hidden, .aok-hidden, .a-hidden, [hidden]";

function cartShown(element: Element, line: Element): boolean {
  if (!visible(element)) return false;
  for (let node: Element | null = element; node && node !== line; node = node.parentElement) {
    if (node.matches(CART_UNSHOWN)) return false;
  }
  return true;
}

/**
 * The line's quantity as Amazon shows it: the quantity dropdown's selected
 * value (or the number typed in the box Amazon shows after "10+"), a typed
 * quantity box, a stepper's value, and the line's own data-quantity. Every
 * reading present must agree; one that is present but unreadable, or none at
 * all, leaves the line unreadable.
 */
function lineQuantity(line: Element): number | null {
  const readings: Array<number | null> = [];
  for (const select of line.querySelectorAll<HTMLSelectElement>("select[name*='quantity' i]")) {
    if (!cartShown(select, line)) continue;
    const option = [...select.options].find((candidate) => candidate.selected) ?? null;
    // "10+" only opens the typed box; that box holds the number.
    if (option && /\+\s*$/.test(text(option, 20))) continue;
    readings.push(wholeQuantity(select.value));
  }
  for (const input of line.querySelectorAll<HTMLInputElement>("input[name*='quantity' i]")) {
    if (String(input.getAttribute("type") || "").toLocaleLowerCase("en-US") === "hidden" || !cartShown(input, line)) continue;
    readings.push(wholeQuantity(input.value));
  }
  const stepperValue = (stepper: Element): number | null => {
    const now = stepper.getAttribute("aria-valuenow");
    return now !== null && now.trim() ? wholeQuantity(now) : parseStepperText(text(stepper, 100));
  };
  for (const stepper of line.querySelectorAll("[data-a-selector='value'], [data-a-selector='inner-value'], [role='spinbutton']")) {
    if (cartShown(stepper, line) && !stepper.matches("select, input") && !stepper.querySelector("select, input")) readings.push(stepperValue(stepper));
  }
  for (const prompt of line.querySelectorAll(".a-dropdown-prompt")) {
    // A prompt reading "10+" only says the typed box is in use.
    if (cartShown(prompt, line) && !/\+\s*$/.test(text(prompt, 40))) readings.push(parseQuantityText(text(prompt, 40)));
  }
  if (line.hasAttribute("data-quantity")) readings.push(wholeQuantity(line.getAttribute("data-quantity")));
  // Generic quantity labels are a last resort, only when Amazon's own controls are absent.
  if (!readings.length) {
    for (const label of line.querySelectorAll("[data-testid*='quantity' i]")) {
      if (cartShown(label, line) && !label.querySelector("select, input")) readings.push(stepperValue(label));
    }
  }
  const first = readings[0];
  return first !== undefined && first !== null && readings.every((reading) => reading === first) ? first : null;
}

function sellerEvidence(line: Element): { sellerName: string; sellerType: SellerType } {
  const sellerText = text(queryVisible(line, [
    ".sc-product-seller",
    "[data-feature-id='seller']",
    "[data-testid*='seller' i]"
  ]), 1_000);
  if (/sold\s+by\s+amazon(?:\.com)?|seller\s*:?\s*amazon(?:\.com)?/i.test(sellerText)) {
    return { sellerName: "Amazon.com", sellerType: "first_party" };
  }
  const marketplace = sellerText.match(/(?:sold\s+by|seller\s*:?)\s*(.+)$/i)?.[1]?.trim().slice(0, 160) ?? "";
  return marketplace
    ? { sellerName: marketplace, sellerType: "third_party" }
    : { sellerName: "", sellerType: "unknown" };
}

function visiblyEmpty(documentValue: Document): boolean {
  const root = queryVisible(documentValue, ["#sc-active-cart", "[data-name='Active Items']", "main", "body"]);
  return Boolean(root && /(?:your )?(?:amazon )?cart is empty|no items in (?:your )?cart|cart has no items/i.test(text(root, 40_000)));
}

// One ASIN can sit on two cart rows (another seller's offer, a gift option).
// The cart proof counts units per ASIN, so such rows are one line whose
// quantity is their sum; a price or seller the rows disagree on is unknown.
function mergedBySku(lines: CartLineEvidence[]): CartLineEvidence[] {
  const merged = new Map<string, CartLineEvidence>();
  for (const line of lines) {
    const existing = merged.get(line.retailerSku);
    if (!existing || !line.retailerSku) {
      merged.set(line.retailerSku || `unidentified:${merged.size}`, { ...line });
      continue;
    }
    existing.quantity = existing.quantity !== null && line.quantity !== null ? existing.quantity + line.quantity : null;
    if (existing.unitPriceCents !== line.unitPriceCents) existing.unitPriceCents = null;
    if (existing.sellerName !== line.sellerName || existing.sellerType !== line.sellerType) {
      existing.sellerName = "";
      existing.sellerType = "unknown";
    }
  }
  return [...merged.values()];
}

export function observeAmazonCart(documentValue: Document, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const elements = cartLineElements(documentValue);
  const lines = mergedBySku(elements.map((line) => {
    const seller = sellerEvidence(line);
    return {
      retailerSku: String(line.getAttribute("data-asin") || "").toUpperCase(),
      quantity: lineQuantity(line),
      unitPriceCents: readPrice(line),
      sellerName: seller.sellerName,
      sellerType: seller.sellerType
    };
  }));
  const independentlyCounted = elements.length > 0
    ? new Set(elements).size === elements.length
    : visiblyEmpty(documentValue);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    complete: independentlyCounted && lines.every((line) => /^[A-Z0-9]{10}$/.test(line.retailerSku)),
    independentlyCounted,
    independentLineCount: lines.length,
    lines
  };
}

export function amazonSecurityChallenge(documentValue: Document): boolean {
  return retailerSecurityChallenge(documentValue);
}

export function amazonInteractiveBlock(documentValue: Document, urlValue: string): LiveOfferObservation["interactiveBlock"] {
  return retailerInteractiveBlock(documentValue, urlValue);
}
