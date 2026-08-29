import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type CartInventoryEvidence,
  type LiveOfferObservation
} from "../../browser-safety/src/index.js";
import { WALMART_OBSERVER_VERSION, type Fulfillment, type SellerType } from "../../contracts/src/index.js";
import {
  extractRetailerSku,
  observeRetailerOffer,
  parseRetailerPriceElement,
  retailerAddControl,
  retailerInteractiveBlock,
  retailerSecurityChallenge
} from "./retailers.js";

export { WALMART_OBSERVER_VERSION };

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
    "[data-automation-id='product-price']",
    "[data-testid='line-price']",
    "[data-testid*='price' i]",
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
  requiredFulfillment: Fulfillment
): Element | null {
  if (requiredFulfillment !== "shipping" && requiredFulfillment !== "pickup") return null;
  if (retailerInteractiveBlock(document, urlValue)) return null;
  return retailerAddControl(document, urlValue, "walmart", expectedSku, requiredFulfillment);
}

export function observeWalmartOffer(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  observedAt = new Date().toISOString()
): LiveOfferObservation {
  const observation = observeRetailerOffer(
    document,
    urlValue,
    "walmart",
    expectedSku,
    requiredFulfillment,
    observedAt
  );
  return { ...observation, pageKind: walmartPageKind(urlValue) };
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

function lineQuantity(line: Element): number | null {
  const control = queryVisible(line, [
    "select[aria-label*='quantity' i]",
    "select[name*='quantity' i]",
    "input[aria-label*='quantity' i]",
    "input[name*='quantity' i]",
    "[data-testid*='quantity' i]"
  ]);
  if (!control) return null;
  const formValue = ["INPUT", "SELECT"].includes(control.tagName)
    ? String((control as HTMLInputElement | HTMLSelectElement).value || "") : "";
  const candidate = `${formValue} ${control.getAttribute("aria-label") || ""} ${text(control, 200)}`;
  const match = candidate.match(/(?:qty|quantity)?\s*:?\s*(\d{1,2})/i);
  const quantity = Number(match?.[1]);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
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
    return {
      retailerSku: lineSku(line),
      quantity: lineQuantity(line),
      unitPriceCents: readPrice(line),
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
