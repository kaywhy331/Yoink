import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type CartInventoryEvidence,
  type LiveOfferObservation
} from "../../browser-safety/src/index.js";
import { AMAZON_OBSERVER_VERSION, type AdapterEnvironment, type Fulfillment, type SellerType } from "../../contracts/src/index.js";
import {
  amazonOfferBinding,
  extractRetailerSku,
  observeRetailerOffer,
  parseRetailerPriceElement,
  retailerInteractiveBlock,
  retailerSecurityChallenge
} from "./retailers.js";

export { AMAZON_OBSERVER_VERSION };

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

export function amazonAddBinding(
  documentValue: Document,
  urlValue: string,
  expectedAsin: string,
  requiredFulfillment: Fulfillment,
  environment?: AdapterEnvironment
): { control: Element; offerListingId: string } | null {
  if (requiredFulfillment !== "shipping" && requiredFulfillment !== "pickup") return null;
  if (amazonInteractiveBlock(documentValue, urlValue)) return null;
  return amazonOfferBinding(documentValue, urlValue, expectedAsin, requiredFulfillment, environment);
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

function lineQuantity(line: Element): number | null {
  const control = queryVisible(line, [
    "select[name*='quantity' i]",
    "input[name*='quantity' i]",
    "[data-a-selector='value']",
    ".a-dropdown-prompt",
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

export function observeAmazonCart(documentValue: Document, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const elements = cartLineElements(documentValue);
  const lines = elements.map((line) => {
    const seller = sellerEvidence(line);
    return {
      retailerSku: String(line.getAttribute("data-asin") || "").toUpperCase(),
      quantity: lineQuantity(line),
      unitPriceCents: readPrice(line),
      sellerName: seller.sellerName,
      sellerType: seller.sellerType
    };
  });
  const independentlyCounted = elements.length > 0
    ? new Set(elements).size === elements.length
    : visiblyEmpty(documentValue);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    complete: independentlyCounted && lines.every((line) => /^[A-Z0-9]{10}$/.test(line.retailerSku)),
    independentlyCounted,
    independentLineCount: elements.length,
    lines
  };
}

export function amazonSecurityChallenge(documentValue: Document): boolean {
  return retailerSecurityChallenge(documentValue);
}

export function amazonInteractiveBlock(documentValue: Document, urlValue: string): LiveOfferObservation["interactiveBlock"] {
  return retailerInteractiveBlock(documentValue, urlValue);
}
