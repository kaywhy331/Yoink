import type { AdapterEnvironment } from "../../contracts/src/index.js";
import type { CartInventoryEvidence, LiveOfferObservation } from "../../browser-safety/src/index.js";

// Assessed scope: simple, unbundled ASUS US products with one fixed part number.
// Registration and execution remain separate from these evidence readers.
const PART_NUMBER = /^[A-Z0-9]{8}-[A-Z0-9]{6}$/;
export { ASUS_ADD_ADAPTER_VERSION } from "../../contracts/src/index.js";

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
  return [...root.querySelectorAll(selector)].filter(element => visible(element, environment));
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

function cents(value: unknown): number | null {
  if (!["number", "string"].includes(typeof value) || !/^\d+(?:\.\d{1,6})?$/.test(String(value))) return null;
  const amount = Number(value) * 100;
  const rounded = Math.round(amount);
  return Number.isSafeInteger(rounded) && rounded >= 0 && Math.abs(amount - rounded) < 0.000001 ? rounded : null;
}

export function asusUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "eshop.asus.com" && !url.port && !url.username && !url.password
      && url.pathname.startsWith("/us/") ? url : null;
  } catch { return null; }
}

export function asusUrlSku(value: string): string {
  const url = asusUrl(value);
  if (!url || url.searchParams.has("config")) return "";
  return url.pathname.match(/^\/us\/([a-z0-9]{8}-[a-z0-9]{6})-[a-z0-9-]+\.html$/)?.[1]?.toUpperCase() || "";
}

export function asusPageKind(value: string): LiveOfferObservation["pageKind"] {
  const url = asusUrl(value);
  if (!url) return "other";
  if (/^\/us\/checkout\/cart\/?$/.test(url.pathname)) return "cart";
  if (/^\/us\/checkout(?:\/|$)/.test(url.pathname)) return "checkout";
  if (/^\/us\/customer\/account(?:\/|$)/.test(url.pathname)) return "auth";
  return asusUrlSku(value) ? "product" : "other";
}

export function asusSecurityChallenge(document: Document, environment?: AdapterEnvironment): boolean {
  return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment))
    || elements(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
}

export function asusInteractiveBlock(document: Document, url: string, environment?: AdapterEnvironment): LiveOfferObservation["interactiveBlock"] {
  if (asusPageKind(url) === "auth") return "auth";
  if (asusSecurityChallenge(document, environment)) return "unknown";
  if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
  if (elements(document, "dialog[open], [aria-modal='true'], .modal-popup._show, input[type='password']", environment).length) return "unknown";
  return "";
}

export interface AsusOfferBinding {
  root: Element;
  control: Element;
  retailerSku: string;
  productId: string;
  unitPriceCents: number;
  fingerprint: string;
}

export function asusOfferBinding(document: Document, urlValue: string, expectedSku?: string, environment?: AdapterEnvironment): AsusOfferBinding | null {
  const retailerSku = asusUrlSku(urlValue);
  if (!retailerSku || document.URL !== urlValue || (expectedSku !== undefined && expectedSku !== retailerSku)
    || asusInteractiveBlock(document, urlValue, environment)) return null;
  const roots = elements(document, ".product-info-main", environment);
  const forms = elements(document, "form#product_addtocart_form", environment);
  if (roots.length !== 1 || forms.length !== 1 || !roots[0]!.contains(forms[0]!)) return null;
  const root = roots[0]!, form = forms[0]!;
  if (form.getAttribute("data-product-sku") !== retailerSku || form.getAttribute("method")?.toLowerCase() !== "post") return null;
  const values = (name: string): string[] => [...form.querySelectorAll<HTMLInputElement>(`input[name='${name}']`)].map(x => x.value);
  const products = values("product"), quantities = values("qty"), configurations = values("selected_configurable_option");
  const productId = products[0] || "";
  if (products.length !== 1 || !/^\d{1,10}$/.test(productId) || quantities.length !== 1 || quantities[0] !== "1"
    || configurations.length !== 1 || configurations[0] !== "" || values("related_product").some(value => value !== "")
    || form.querySelector("select, input[name^='super_attribute'], input[name^='bundle_option'], [data-is-cto='1']")) return null;
  const action = asusUrl(form.getAttribute("action") || "");
  if (!action || !new RegExp(`^/us/checkout/cart/add/uenc/[A-Za-z0-9_,=-]+/product/${productId}/$`).test(action.pathname)
    || action.search || action.hash) return null;
  const controls = elements(form, "button#product-addtocart-button[type='submit']", environment);
  if (controls.length !== 1 || text(controls[0]!, environment) !== "Add to Cart" || controls[0]!.matches(":disabled")
    || controls[0]!.closest("[aria-disabled='true']")) return null;
  const prices = elements(root, "[data-price-type='finalPrice'][data-price-amount]", environment);
  const currencies = [...document.querySelectorAll<HTMLMetaElement>('meta[property="product:price:currency"]')];
  const metaPrices = [...document.querySelectorAll<HTMLMetaElement>('meta[property="product:price:amount"]')];
  if (prices.length !== 1 || currencies.length !== 1 || currencies[0]!.content !== "USD" || metaPrices.length !== 1) return null;
  const unitPriceCents = cents(prices[0]!.getAttribute("data-price-amount"));
  const shown = text(prices[0]!, environment);
  if (!unitPriceCents || !/^\$\d+(?:,\d{3})*\.\d{2}$/.test(shown)
    || cents(shown.slice(1).replace(/,/g, "")) !== unitPriceCents || cents(metaPrices[0]!.content) !== unitPriceCents
    || cents(form.getAttribute("data-product-originalprice")) !== unitPriceCents) return null;
  const content = text(root, environment);
  const partNumbers = [...content.matchAll(/Part Number:\s*([A-Z0-9-]+)/g)].map(match => match[1]);
  if (partNumbers.length !== 1 || partNumbers[0] !== retailerSku || !content.includes("Most orders ship out within 24 hours")
    || /pre[ -]?order|subscription|out of stock|sold out|pick ?up|sold (?:and shipped )?by|\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/i.test(content)) return null;
  return { root, control: controls[0]!, retailerSku, productId, unitPriceCents,
    fingerprint: JSON.stringify([retailerSku, productId, unitPriceCents, action.href, content]) };
}

export function observeAsusOffer(document: Document, url: string, retailerSku: string, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): LiveOfferObservation {
  const binding = asusOfferBinding(document, url, retailerSku, environment);
  return { contractVersion: 1, observedAt, url, pageKind: asusPageKind(url), retailerId: "asus", retailerSku: binding?.retailerSku || asusUrlSku(url),
    availability: binding ? "in_stock" : "unknown", unitPriceCents: binding?.unitPriceCents ?? null, currency: "USD",
    sellerName: binding ? "ASUS" : "", sellerType: binding ? "first_party" : "unknown", fulfillment: binding ? "shipping" : "unknown",
    addControlActionable: Boolean(binding), securityChallenge: asusSecurityChallenge(document, environment), interactiveBlock: asusInteractiveBlock(document, url, environment) };
}

/** Input is the cart section from the same-origin US customer/section/load endpoint. */
export function asusCartInventory(value: unknown, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const empty: CartInventoryEvidence = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const cart = value as Record<string, any>;
  if (!Number.isSafeInteger(cart.summary_count) || cart.summary_count < 0 || !Array.isArray(cart.items) || cart.items.length > 25) return empty;
  const lines = [];
  for (const item of cart.items) {
    if (!item || !PART_NUMBER.test(item.product_sku) || asusUrlSku(String(item.product_url)) !== item.product_sku
      || item.product_type !== "simple" || !Array.isArray(item.options) || item.options.length || item.is_addon !== false
      || ["freebie", "add_on", "wep_add_on", "bundle", "preorder"].some(key => item[key] !== "no")
      || item.glidex_option !== "" || item.message !== "" || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 99) return empty;
    // In the captured two-unit row product_price_value remains 44.99, while
    // product_origin_price and the DOM subtotal are 89.98. Use the unit field.
    const unitPriceCents = cents(item.product_price_value);
    if (!unitPriceCents) return empty;
    lines.push({ retailerSku: item.product_sku, quantity: item.qty, unitPriceCents, sellerName: "ASUS", sellerType: "first_party" as const });
  }
  if (new Set(lines.map(line => line.retailerSku)).size !== lines.length
    || lines.reduce((sum, line) => sum + line.quantity, 0) !== cart.summary_count
    || lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0) !== cents(cart.subtotalAmount)) return empty;
  return { contractVersion: 1, observedAt, complete: true, independentlyCounted: true, independentLineCount: lines.length, lines };
}
