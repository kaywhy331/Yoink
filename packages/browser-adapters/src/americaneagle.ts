import type { AdapterEnvironment } from "../../contracts/src/index.js";
import type { CartInventoryEvidence, LiveOfferObservation } from "../../browser-safety/src/index.js";

const CHILD_SKU = /^\d{10}$/;
const STYLE_COLOR = /^\d{4}_\d{4}_\d{3}$/;

function visible(element: Element, environment?: AdapterEnvironment): boolean {
  if (environment?.isVisible) {
    try { return environment.isVisible(element); } catch { return false; }
  }
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0")) return false;
  }
  return true;
}

function elements(root: ParentNode, selector: string, environment?: AdapterEnvironment): Element[] {
  return [...root.querySelectorAll(selector)].filter(e => visible(e, environment));
}

function text(element: Element, environment?: AdapterEnvironment): string {
  if (!environment && typeof (element as HTMLElement).innerText === "string") return (element as HTMLElement).innerText.replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) parts.push(node.textContent || "");
    else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes((node as Element).tagName)
      && visible(node as Element, environment)) for (const child of node.childNodes) visit(child);
  };
  visit(element);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function cents(value: string): number | null {
  const match = value.match(/^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  if (!match) return null;
  const price = Number(match[1]!.replace(/,/g, "")) * 100 + Number(match[2]);
  return Number.isSafeInteger(price) && price > 0 ? price : null;
}

export function americanEagleUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["ae.com", "www.ae.com"].includes(url.hostname) && /^\/us\/en(?:\/|$)/.test(url.pathname) ? url : null;
  } catch { return null; }
}

export function americanEagleStyleColor(value: string): string {
  const url = americanEagleUrl(value);
  return url?.pathname.match(/^\/us\/en\/p\/(?:[a-z0-9-]+\/)*(\d{4}_\d{4}_\d{3})\/?$/)?.[1] || "";
}

/** sku is an identity constraint; it never authorizes selecting a different size. */
export function americanEagleUrlSku(value: string): string {
  const url = americanEagleUrl(value);
  const sku = url?.searchParams.get("sku") || "";
  return americanEagleStyleColor(value) && url?.searchParams.getAll("sku").length === 1 && CHILD_SKU.test(sku) ? sku : "";
}

export function americanEaglePageKind(value: string): LiveOfferObservation["pageKind"] {
  const url = americanEagleUrl(value);
  if (!url) return "other";
  if (/^\/us\/en\/(?:login|account|signin)(?:\/|$)/.test(url.pathname)) return "auth";
  if (/^\/us\/en\/cart\/?$/.test(url.pathname)) return "cart";
  if (/^\/us\/en\/checkout(?:\/|$)/.test(url.pathname)) return "checkout";
  return americanEagleStyleColor(value) ? "product" : "other";
}

export function americanEagleSecurityChallenge(document: Document, environment?: AdapterEnvironment): boolean {
  return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment))
    || elements(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
}

export function americanEagleInteractiveBlock(document: Document, url: string, environment?: AdapterEnvironment): LiveOfferObservation["interactiveBlock"] {
  if (americanEaglePageKind(url) === "auth") return "auth";
  if (americanEagleSecurityChallenge(document, environment)) return "unknown";
  if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
  if (elements(document, "dialog[open], [aria-modal='true'], input[type='password']", environment).length) return "unknown";
  return "";
}

export interface AmericanEagleOfferBinding {
  control: Element;
  root: Element;
  retailerSku: string;
  styleColor: string;
  unitPriceCents: number;
  fingerprint: string;
}

export function americanEagleOfferBinding(document: Document, urlValue: string, expectedSku?: string, environment?: AdapterEnvironment): AmericanEagleOfferBinding | null {
  const url = americanEagleUrl(urlValue);
  const styleColor = americanEagleStyleColor(urlValue);
  if (!url || !styleColor || document.URL !== urlValue || americanEagleInteractiveBlock(document, urlValue, environment)) return null;
  const panels = elements(document, "[data-test-psp]", environment);
  if (panels.length !== 1) return null;
  const panel = panels[0]!;
  const root = panel.closest("[data-test-sticky-content]");
  if (!root || !visible(root, environment)) return null;
  const buttons = elements(panel, "button[data-test-btn='addToBag'][type='button']", environment);
  if (buttons.length !== 1) return null;
  const control = buttons[0]!;
  if (!/^Add to Bag(?: \(Before It's Gone\))?$/i.test(text(control, environment))
    || control.matches(":disabled") || control.closest("[aria-disabled='true']")) return null;
  const sizes = elements(panel, "[data-test-select-size]", environment);
  if (sizes.length !== 1 || sizes[0]!.getAttribute("data-test-sizes-count") !== "1") return null;
  const size = sizes[0]!;
  const selectedText = elements(size, "[data-test-dropdown-toggle][aria-label='Size'] [data-test-text]", environment);
  // Only one-size products have a proven default selection on a fresh navigation.
  if (selectedText.length !== 1 || text(selectedText[0]!, environment) !== "One Size") return null;
  const options = [...size.querySelectorAll("li[data-value]")];
  if (options.length !== 1 || !options[0]!.classList.contains("active")
    || options[0]!.textContent?.replace(/\s+/g, " ").trim() !== "One Size") return null;
  const retailerSku = options[0]!.getAttribute("data-value") || "";
  if (!CHILD_SKU.test(retailerSku) || (expectedSku !== undefined && retailerSku !== expectedSku)
    || (url.searchParams.has("sku") && americanEagleUrlSku(urlValue) !== retailerSku)) return null;
  const quantities = elements(panel, "[data-test-select-quantity] [data-testid='quantity-value']", environment);
  if (quantities.length !== 1 || text(quantities[0]!, environment) !== "1") return null;
  // The captured Add-to-Bag control creates a shipping line; pickup needs its
  // own store control. Any selected pickup/store mode is outside this lane.
  if (elements(panel, "input:checked, [aria-checked='true'], [aria-pressed='true']", environment).length
    || /pre[ -]?order|subscription|pick ?up (?:at|in store)|ship to store/i.test(text(panel, environment))
    || elements(root, "[data-testid='modal-link-shipping-returns']", environment).length !== 1) return null;
  const prices = elements(root, "[data-test-product-sku-price]", environment);
  const names = elements(root, "h1[data-testid='product-name']", environment);
  if (prices.length !== 1 || names.length !== 1) return null;
  const unitPriceCents = cents(text(prices[0]!, environment));
  if (unitPriceCents === null) return null;
  const products: Array<Record<string, any>> = [];
  for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
    try {
      const value = JSON.parse(script.textContent || "null");
      for (const item of Array.isArray(value) ? value : [value]) if (item?.["@type"] === "Product") products.push(item);
    } catch { /* Malformed metadata cannot supply evidence. */ }
  }
  if (products.length !== 1) return null;
  const product = products[0]!;
  const offer = product.offers;
  if (product.sku !== styleColor || product.name !== text(names[0]!, environment)
    || !offer || Array.isArray(offer) || offer.priceCurrency !== "USD" || !/\/InStock$/.test(String(offer.availability))
    || americanEagleStyleColor(String(offer.url)) !== styleColor || cents(`$${offer.price}`) !== unitPriceCents
    || /\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]|sold (?:and shipped )?by/i.test(text(root, environment))) return null;
  const fingerprint = JSON.stringify([styleColor, retailerSku, unitPriceCents, product.name, "One Size",
    text(root.querySelector("[data-test-extras='colors']") || names[0]!, environment), control.getAttribute("name")]);
  return { root, control, retailerSku, styleColor, unitPriceCents, fingerprint };
}

export function observeAmericanEagleOffer(document: Document, url: string, retailerSku: string, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): LiveOfferObservation {
  const binding = americanEagleOfferBinding(document, url, retailerSku, environment);
  return { contractVersion: 1, observedAt, url, pageKind: americanEaglePageKind(url), retailerId: "americaneagle", retailerSku: binding?.retailerSku || "",
    availability: binding ? "in_stock" : "unknown", unitPriceCents: binding?.unitPriceCents ?? null, currency: "USD",
    sellerName: binding ? "American Eagle" : "", sellerType: binding ? "first_party" : "unknown", fulfillment: binding ? "shipping" : "unknown",
    addControlActionable: Boolean(binding), securityChallenge: americanEagleSecurityChallenge(document, environment), interactiveBlock: americanEagleInteractiveBlock(document, url, environment) };
}

export function observeAmericanEagleCart(document: Document, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): CartInventoryEvidence {
  const empty: CartInventoryEvidence = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
  if (americanEaglePageKind(document.URL) !== "cart" || americanEagleInteractiveBlock(document, document.URL, environment)) return empty;
  const counters = elements(document, "a.qa-tnav-bag-icon [data-test-content]", environment);
  if (counters.length !== 1 || !/^\d{1,3}$/.test(text(counters[0]!, environment))) return empty;
  const count = Number(text(counters[0]!, environment));
  const rows = elements(document, ".cart-item", environment);
  if (rows.length > 25) return empty;
  const lines = [];
  for (const row of rows) {
    const retailerSku = row.getAttribute("data-sku-id") || "";
    const styleColor = row.getAttribute("data-product-id") || "";
    const links = elements(row, "a.product-link[href]", environment);
    if (!CHILD_SKU.test(retailerSku) || !STYLE_COLOR.test(styleColor) || links.length === 0 || links.some(link => {
      try { return americanEagleStyleColor(new URL(link.getAttribute("href")!, document.URL).href) !== styleColor; } catch { return true; }
    })) return empty;
    const quantities = elements(row, "[data-testid='quantity']", environment);
    const prices = elements(row, "[data-test-cart-item-price]", environment);
    const quantity = quantities.length === 1 ? Number(text(quantities[0]!, environment).match(/^Qty: (\d{1,2})$/)?.[1]) : 0;
    const total = prices.length === 1 ? cents(text(prices[0]!, environment)) : null;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || total === null || total % quantity !== 0
      || /pre[ -]?order|subscription|pick ?up|ship to store/i.test(text(row, environment))) return empty;
    lines.push({ retailerSku, quantity, unitPriceCents: total / quantity, sellerName: "American Eagle", sellerType: "first_party" as const });
  }
  if (new Set(lines.map(line => line.retailerSku)).size !== lines.length || lines.reduce((sum, line) => sum + line.quantity, 0) !== count
    || (count === 0 && !/Your bag is empty\. Find something you love!/i.test(text(document.body, environment)))) return empty;
  return { contractVersion: 1, observedAt, complete: true, independentlyCounted: true, independentLineCount: lines.length, lines };
}
