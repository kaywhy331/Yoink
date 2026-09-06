import type { AdapterEnvironment } from "../../contracts/src/index.js";
import type { CartInventoryEvidence, LiveOfferObservation } from "../../browser-safety/src/index.js";

export { AUDIOADVICE_ADD_ADAPTER_VERSION } from "../../contracts/src/index.js";
const VARIANT = /^\d{10,20}$/;

function visible(element: Element, environment?: AdapterEnvironment): boolean {
  if (environment?.isVisible) return environment.isVisible(element);
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
  }
  return true;
}

function text(element: Element, environment?: AdapterEnvironment): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) parts.push(node.textContent || "");
    else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes((node as Element).tagName)
      && visible(node as Element, environment)) for (const child of node.childNodes) visit(child);
  };
  visit(element);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function audioAdviceUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && url.hostname === "www.audioadvice.com" ? url : null;
  } catch { return null; }
}

export function audioAdvicePageKind(value: string): LiveOfferObservation["pageKind"] {
  const url = audioAdviceUrl(value);
  if (!url) return "other";
  if (/^\/account(?:\/|$)/.test(url.pathname)) return "auth";
  if (/^\/cart\/?$/.test(url.pathname)) return "cart";
  if (/^\/checkouts?(?:\/|$)/.test(url.pathname)) return "checkout";
  return /^\/products\/[a-z0-9][a-z0-9-]*\/?$/.test(url.pathname) ? "product" : "other";
}

export function audioAdviceUrlSku(value: string): string {
  const url = audioAdviceUrl(value);
  const variant = url?.searchParams.get("variant") || "";
  return url && audioAdvicePageKind(value) === "product"
    && url.searchParams.getAll("variant").length === 1 && VARIANT.test(variant) ? variant : "";
}

export function audioAdviceSecurityChallenge(document: Document, environment?: AdapterEnvironment): boolean {
  return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment))
    || [...document.querySelectorAll("iframe[src*='captcha'], iframe[src*='challenge']")].some(e => visible(e, environment));
}

export function audioAdviceInteractiveBlock(document: Document, url: string, environment?: AdapterEnvironment): LiveOfferObservation["interactiveBlock"] {
  if (audioAdvicePageKind(url) === "auth") return "auth";
  if (audioAdviceSecurityChallenge(document, environment)) return "unknown";
  if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
  if ([...document.querySelectorAll("dialog[open], [aria-modal='true'], input[type='password']")].some(e => visible(e, environment))) return "unknown";
  return "";
}

export interface AudioAdviceOfferBinding {
  control: Element;
  root: Element;
  variantId: string;
  unitPriceCents: number;
  fingerprint: string;
}

/** Initial scope: single-offer US products with the assessed native quantity-one form. */
export function audioAdviceOfferBinding(document: Document, urlValue: string, variantId: string, environment?: AdapterEnvironment): AudioAdviceOfferBinding | null {
  const url = audioAdviceUrl(urlValue);
  if (!url || document.URL !== urlValue || audioAdvicePageKind(urlValue) !== "product" || !VARIANT.test(variantId)
    || url.searchParams.has("variant") && (url.searchParams.getAll("variant").length !== 1 || url.searchParams.get("variant") !== variantId)
    || audioAdviceInteractiveBlock(document, urlValue, environment)) return null;
  const scoped = [...document.querySelectorAll("product-form .product-column-right")].filter(e => visible(e, environment));
  if (scoped.length !== 1) return null;
  const root = scoped[0]!;
  const controls = [...root.querySelectorAll("form[action='/cart/add'] button#add-to-cart[name=add][type=submit]")]
    .filter(e => visible(e, environment));
  if (controls.length !== 1 || text(controls[0]!, environment).toUpperCase() !== "ADD TO CART") return null;
  const control = controls[0]!;
  const form = control.closest("form")!;
  if (form.getAttribute("method")?.toLowerCase() !== "post" || control.matches(":disabled")
    || control.closest("[aria-disabled=true], [aria-busy=true]")) return null;
  const fields = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
  const ids = fields("id"), quantities = fields("quantity"), products = fields("product-id"), sections = fields("section-id");
  if (ids.length !== 1 || ids[0]!.disabled || ids[0]!.value !== variantId
    || quantities.length !== 1 || quantities[0]!.disabled || quantities[0]!.value !== "1" || !visible(quantities[0]!, environment)
    || products.length !== 1 || !/^\d{10,20}$/.test(products[0]!.value) || products[0]!.disabled
    || sections.length !== 1 || !/^template--\d+__main$/.test(sections[0]!.value) || sections[0]!.disabled
    // A hidden input named id shadows form.id in the live browser.
    || form.getAttribute("id") !== `product-form-${sections[0]!.value}-${products[0]!.value}`) return null;
  for (const attr of ["min", "max"] as const) {
    const value = quantities[0]!.getAttribute(attr);
    if (value !== null && (!/^\d+$/.test(value) || (attr === "min" ? Number(value) > 1 : Number(value) < 1))) return null;
  }
  if (root.querySelector("variant-picker, variant-selects, select[name=id], input[name=selling_plan], input[name^='properties[']")) return null;
  const visibleNodes = (selector: string) => [...root.querySelectorAll(selector)].filter(e => visible(e, environment));
  const prices = visibleNodes(".price-container .price__default .price__current"), stock = visibleNodes(".product-inventory-text");
  const title = visibleNodes("h1.product-title"), subtitle = visibleNodes(".product-subtitle"), mpn = visibleNodes(".product-mpn__value");
  if (prices.length !== 1 || stock.length !== 1 || title.length !== 1 || subtitle.length > 1 || mpn.length !== 1
    || !/^In Stock: Free (?:2-Day )?Shipping$/i.test(text(stock[0]!, environment))) return null;
  const match = text(prices[0]!, environment).match(/^\$(\d[\d,]*)\.(\d{2})$/);
  if (!match) return null;
  const unitPriceCents = Number(match[1]!.replace(/,/g, "")) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) return null;
  const schemas: Array<Record<string, any>> = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const p = JSON.parse(script.textContent || "null"); if (p?.["@type"] === "Product") schemas.push(p); } catch { /* unrelated metadata */ }
  }
  if (schemas.length !== 1) return null;
  const product = schemas[0]!;
  const expectedName = [text(title[0]!, environment), ...subtitle.map(e => text(e, environment))].join(" ");
  const primaryTitle = text(title[0]!, environment);
  if (typeof product.name !== "string" || !(product.name === primaryTitle || product.name.startsWith(`${primaryTitle} `))
    || audioAdviceUrl(String(product.url))?.pathname !== url.pathname
    || typeof product.sku !== "string" || product.sku.split(":").at(-1) !== text(mpn[0]!, environment)
    || !Array.isArray(product.offers) || product.offers.length !== 1) return null;
  const offer = product.offers[0];
  const offerUrl = audioAdviceUrl(String(offer?.url));
  if (!offer || offer.sku !== product.sku || offer.priceCurrency !== "USD"
    || !/^https?:\/\/schema.org\/InStock$/.test(String(offer.availability)) || offer.seller?.name !== "Audio Advice"
    || !offerUrl || offerUrl.pathname !== url.pathname || offerUrl.searchParams.getAll("variant").length !== 1
    || offerUrl.searchParams.get("variant") !== variantId || Math.abs(Number(offer.price) * 100 - unitPriceCents) > 0.000001
    || !Number.isFinite(Number(offer.price))) return null;
  const fingerprint = JSON.stringify([variantId, products[0]!.value, sections[0]!.value, form.getAttribute("id"),
    product.sku, product.name, expectedName, unitPriceCents, text(stock[0]!, environment), quantities[0]!.value, product.offers]);
  return { root, control, variantId, unitPriceCents, fingerprint };
}

export function observeAudioAdviceOffer(document: Document, url: string, variantId: string, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): LiveOfferObservation {
  const binding = audioAdviceOfferBinding(document, url, variantId, environment);
  return { contractVersion: 1, observedAt, url, pageKind: audioAdvicePageKind(url), retailerId: "audioadvice", retailerSku: binding?.variantId || "",
    availability: binding ? "in_stock" : "unknown", unitPriceCents: binding?.unitPriceCents ?? null, currency: "USD",
    sellerName: binding ? "Audio Advice" : "", sellerType: binding ? "first_party" : "unknown", fulfillment: binding ? "shipping" : "unknown",
    addControlActionable: Boolean(binding), securityChallenge: audioAdviceSecurityChallenge(document, environment), interactiveBlock: audioAdviceInteractiveBlock(document, url, environment) };
}

/** Shopify's same-origin read response; no cookie, cart token or customer fields enter evidence. */
export function audioAdviceCartInventory(value: unknown, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const empty: CartInventoryEvidence = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
  if (!value || typeof value !== "object") return empty;
  const cart = value as Record<string, unknown>;
  if (cart.currency !== "USD" || !Array.isArray(cart.items) || cart.items.length > 25 || !Number.isSafeInteger(cart.item_count)) return empty;
  const lines = [];
  for (const item of cart.items as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") return empty;
    const variantId = String(item.variant_id);
    let itemUrl: URL | null = null;
    try { itemUrl = audioAdviceUrl(new URL(String(item.url || ""), "https://www.audioadvice.com").href); } catch { return empty; }
    if (!VARIANT.test(variantId) || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1
      || Number(item.quantity) > 99 || !Number.isSafeInteger(item.final_price) || Number(item.final_price) <= 0
      || !itemUrl || audioAdvicePageKind(itemUrl.href) !== "product" || itemUrl.searchParams.get("variant") !== variantId
      || itemUrl.searchParams.getAll("variant").length !== 1 || item.product_has_only_default_variant !== true
      || item.selling_plan_allocation || item.requires_shipping !== true || item.gift_card === true
      || !item.properties || typeof item.properties !== "object" || Object.keys(item.properties).length !== 0
      || !Number.isSafeInteger(item.final_line_price) || item.final_line_price !== Number(item.quantity) * Number(item.final_price)) return empty;
    lines.push({ retailerSku: variantId, quantity: Number(item.quantity), unitPriceCents: Number(item.final_price), sellerName: "Audio Advice", sellerType: "first_party" as const });
  }
  if (new Set(lines.map(line => line.retailerSku)).size !== lines.length || lines.reduce((sum, line) => sum + line.quantity, 0) !== cart.item_count
    || !Number.isSafeInteger(cart.total_price) || lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0) !== cart.total_price) return empty;
  return { contractVersion: 1, observedAt, complete: true, independentlyCounted: true, independentLineCount: lines.length, lines };
}
