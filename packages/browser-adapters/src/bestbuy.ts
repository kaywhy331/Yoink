import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type CartInventoryEvidence,
  type LiveOfferObservation
} from "../../browser-safety/src/index.js";
import { BESTBUY_OBSERVER_VERSION, type AdapterEnvironment, type Fulfillment, type SellerType } from "../../contracts/src/index.js";
import {
  extractRetailerSku,
  observeRetailerOffer,
  parseRetailerPriceElement,
  retailerAddControl,
  retailerInteractiveBlock,
  retailerSecurityChallenge
} from "./retailers.js";

export { BESTBUY_OBSERVER_VERSION };

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
    "[data-testid='customer-price']",
    "[data-testid*='line-price' i]",
    "[data-testid*='price' i]",
    ".priceView-customer-price",
    ".priceView-hero-price",
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

function lineSku(line: Element): string {
  for (const name of ["data-sku-id", "data-sku", "data-product-id"]) {
    const candidate = String(line.getAttribute(name) || "");
    if (/^\d{5,20}$/.test(candidate)) return candidate;
  }
  for (const anchor of line.querySelectorAll("a[href]")) {
    let href = "";
    try { href = new URL(anchor.getAttribute("href") || "", "https://www.bestbuy.com").href; } catch { href = ""; }
    const sku = extractRetailerSku("bestbuy", href);
    if (sku) return sku;
  }
  return text(line, 20_000).match(/\bSKU\s*:?\s*(\d{5,20})\b/i)?.[1] || "";
}

function lineQuantity(line: Element): number | null {
  const control = queryVisible(line, [
    "select[aria-label*='quantity' i]",
    "select[name*='quantity' i]",
    "input[aria-label*='quantity' i]",
    "input[name*='quantity' i]",
    "[data-testid*='quantity' i]",
    "[class*='quantity' i]"
  ]);
  const formValue = control && ["INPUT", "SELECT"].includes(control.tagName)
    ? String((control as HTMLInputElement | HTMLSelectElement).value || "") : "";
  const candidate = `${formValue} ${control?.getAttribute("aria-label") || ""} ${text(control, 300)} ${text(line, 4_000)}`;
  const match = candidate.match(/(?:qty|quantity)\s*:?\s*(\d{1,2})/i)
    ?? (formValue.match(/^\s*(\d{1,2})\s*$/));
  const quantity = Number(match?.[1]);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
}

function sellerEvidence(line: Element): { sellerName: string; sellerType: SellerType } {
  const sellerElement = queryVisible(line, [
    "[data-testid='sold-by']",
    "[data-testid*='sold-by' i]",
    "[data-testid*='seller' i]",
    "[class*='seller' i]"
  ]);
  const evidence = text(sellerElement || line, 12_000);
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

export function observeBestBuyCart(documentValue: Document, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const elements = cartLineElements(documentValue);
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
    : visiblyEmpty(documentValue);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
    independentlyCounted,
    independentLineCount: elements.length,
    lines
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
