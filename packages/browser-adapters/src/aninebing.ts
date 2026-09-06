import type { AdapterEnvironment } from "../../contracts/src/index.js";
import type { CartInventoryEvidence, LiveOfferObservation } from "../../browser-safety/src/index.js";

export { ANINEBING_ADD_ADAPTER_VERSION, ANINEBING_OBSERVER_VERSION } from "../../contracts/src/index.js";
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

export function anineBingUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["aninebing.com", "www.aninebing.com"].includes(url.hostname) ? url : null;
  } catch { return null; }
}

export function anineBingPageKind(value: string): LiveOfferObservation["pageKind"] {
  const url = anineBingUrl(value);
  if (!url) return "other";
  if (/^\/account(?:\/|$)/.test(url.pathname)) return "auth";
  if (/^\/cart\/?$/.test(url.pathname)) return "cart";
  if (/^\/checkouts?(?:\/|$)/.test(url.pathname)) return "checkout";
  return /^\/products\/[a-z0-9][a-z0-9-]*\/?$/.test(url.pathname) ? "product" : "other";
}

export function anineBingSecurityChallenge(document: Document, environment?: AdapterEnvironment): boolean {
  return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment))
    || [...document.querySelectorAll("iframe[src*='captcha'], iframe[src*='challenge']")].some(e => visible(e, environment));
}

export function anineBingInteractiveBlock(document: Document, url: string, environment?: AdapterEnvironment): LiveOfferObservation["interactiveBlock"] {
  if (anineBingPageKind(url) === "auth") return "auth";
  if (anineBingSecurityChallenge(document, environment)) return "unknown";
  if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
  if ([...document.querySelectorAll("dialog[open], [aria-modal='true'], input[type='password']")].some(e => visible(e, environment))) return "unknown";
  return "";
}

export interface AnineBingOfferBinding {
  control: Element;
  root: Element;
  variantId: string;
  unitPriceCents: number;
  fingerprint: string;
}

export function anineBingOfferBinding(document: Document, urlValue: string, variantId: string, environment?: AdapterEnvironment): AnineBingOfferBinding | null {
  const url = anineBingUrl(urlValue);
  if (!url || document.URL !== urlValue || anineBingPageKind(urlValue) !== "product" || !VARIANT.test(variantId)
    || (url.searchParams.has("variant") && url.searchParams.get("variant") !== variantId)
    || anineBingInteractiveBlock(document, urlValue, environment)) return null;
  const forms = [...document.querySelectorAll("form[action='/cart/add'][data-product-id]")].filter(form => visible(form, environment));
  if (forms.length !== 1) return null;
  const root = forms[0]!;
  if (root.getAttribute("method")?.toLowerCase() !== "post") return null;
  const controls = [...root.querySelectorAll("button[name='add'][type='submit']")]
    .filter(button => visible(button, environment) && /^add to cart$/i.test(text(button, environment)));
  if (controls.length !== 1) return null;
  const control = controls[0]!;
  if (control.matches(":disabled") || control.closest("[aria-disabled='true']")) return null;
  const ids = [...root.querySelectorAll<HTMLInputElement>("input[name='id']")];
  const quantities = [...root.querySelectorAll<HTMLInputElement>("input[name='quantity']")];
  if (ids.length !== 1 || ids[0]!.disabled || ids[0]!.value !== variantId
    || quantities.length !== 1 || quantities[0]!.disabled || quantities[0]!.value !== "1") return null;
  for (const attr of ["min", "max"] as const) {
    const value = quantities[0]!.getAttribute(attr);
    if (value !== null && (!/^\d+$/.test(value) || (attr === "min" ? Number(value) > 1 : Number(value) < 1))) return null;
  }
  if ([...root.querySelectorAll<HTMLInputElement>("[name='selling_plan'], [name='properties[Pre Order]']")]
    .some(input => !input.disabled && input.value !== "" && input.value !== "false")) return null;
  const selections = [...root.querySelectorAll("label[data-variant-id].is-selected")].filter(e => visible(e, environment));
  if (selections.length !== 1) return null;
  const selected = selections[0]!;
  const productId = root.getAttribute("data-product-id");
  const handle = url.pathname.split("/")[2];
  if (!productId || selected.getAttribute("data-product-handle") !== handle
    || [selected, control].some(e => e.getAttribute("data-variant-id") !== variantId || e.getAttribute("data-product-id") !== productId)
    || selected.getAttribute("data-preorder") !== "false" || selected.getAttribute("data-appexclusive") !== "false"
    || !/^\d+$/.test(selected.getAttribute("data-variant-qty") || "") || Number(selected.getAttribute("data-variant-qty")) < 1
    || !/^\d+$/.test(selected.getAttribute("data-qty-limit") || "") || Number(selected.getAttribute("data-qty-limit")) < 1) return null;
  const priceNodes = [...root.querySelectorAll(".price--final .price__value")].filter(e => visible(e, environment));
  if (priceNodes.length !== 1) return null;
  const match = text(priceNodes[0]!, environment).match(/^\$(\d[\d,]*)(?:\.(\d{2}))?$/);
  if (!match) return null;
  const unitPriceCents = Number(match[1]!.replace(/,/g, "")) * 100 + Number(match[2] || "0");
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 || Number(selected.getAttribute("data-price")) !== unitPriceCents
    || Math.round(Number(control.getAttribute("data-price")) * 100) !== unitPriceCents) return null;
  const products: Array<Record<string, unknown>> = [];
  for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
    try {
      const value = JSON.parse(script.textContent || "null");
      for (const item of Array.isArray(value) ? value : [value]) if (item?.["@type"] === "Product") products.push(item);
    } catch { /* Unrelated malformed metadata is not offer evidence. */ }
  }
  const matches = products.filter(p => anineBingUrl(String(p.url))?.pathname === url.pathname);
  if (matches.length !== 1 || !Array.isArray(matches[0]!.offers)) return null;
  const offers = (matches[0]!.offers as Array<Record<string, unknown>>).filter(o => {
    const offerUrl = anineBingUrl(String(o.url));
    return offerUrl?.pathname === url.pathname && offerUrl.searchParams.get("variant") === variantId;
  });
  const offer = offers[0];
  if (offers.length !== 1 || !offer || offer.priceCurrency !== "USD" || !/\/InStock$/.test(String(offer.availability))
    || Math.round(Number(offer.price) * 100) !== unitPriceCents || offer.sku !== control.getAttribute("data-sku")
    || offer.sku !== selected.getAttribute("data-current-sku")) return null;
  const pageText = text(document.body, environment);
  if (!/free standard shipping (?:to the united states )?on all orders/i.test(pageText)
    || /\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/.test(text(root, environment))) return null;
  const fingerprint = JSON.stringify([productId, handle, variantId, offer.sku, unitPriceCents,
    selected.getAttribute("data-current-variant-option"), [...root.querySelectorAll<HTMLInputElement>("input")]
      .filter(input => !input.disabled).map(input => [input.name, input.type, input.value, input.checked])]);
  return { root, control, variantId, unitPriceCents, fingerprint };
}

export function observeAnineBingOffer(document: Document, url: string, variantId: string, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): LiveOfferObservation {
  const binding = anineBingOfferBinding(document, url, variantId, environment);
  return { contractVersion: 1, observedAt, url, pageKind: anineBingPageKind(url), retailerId: "aninebing", retailerSku: binding?.variantId || "",
    availability: binding ? "in_stock" : "unknown", unitPriceCents: binding?.unitPriceCents ?? null, currency: "USD",
    sellerName: binding ? "ANINE BING" : "", sellerType: binding ? "first_party" : "unknown", fulfillment: binding ? "shipping" : "unknown",
    addControlActionable: Boolean(binding), securityChallenge: anineBingSecurityChallenge(document, environment), interactiveBlock: anineBingInteractiveBlock(document, url, environment) };
}

/** Shopify's same-origin read response; no cookie, cart token or customer fields enter evidence. */
export function anineBingCartInventory(value: unknown, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const empty: CartInventoryEvidence = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
  if (!value || typeof value !== "object") return empty;
  const cart = value as Record<string, unknown>;
  if (cart.currency !== "USD" || !Array.isArray(cart.items) || cart.items.length > 25 || !Number.isSafeInteger(cart.item_count)) return empty;
  const lines = [];
  for (const item of cart.items as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") return empty;
    const variantId = String(item.variant_id);
    let itemUrl: URL | null = null;
    try { itemUrl = anineBingUrl(new URL(String(item.url || ""), "https://www.aninebing.com").href); } catch { return empty; }
    if (!VARIANT.test(variantId) || String(item.id) !== variantId || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1
      || Number(item.quantity) > 99 || !Number.isSafeInteger(item.final_price) || Number(item.final_price) <= 0
      || !itemUrl || anineBingPageKind(itemUrl.href) !== "product" || itemUrl.searchParams.get("variant") !== variantId
      || item.selling_plan_allocation || item.requires_shipping !== true || item.gift_card === true) return empty;
    lines.push({ retailerSku: variantId, quantity: Number(item.quantity), unitPriceCents: Number(item.final_price), sellerName: "ANINE BING", sellerType: "first_party" as const });
  }
  if (new Set(lines.map(line => line.retailerSku)).size !== lines.length || lines.reduce((sum, line) => sum + line.quantity, 0) !== cart.item_count) return empty;
  return { contractVersion: 1, observedAt, complete: true, independentlyCounted: true, independentLineCount: lines.length, lines };
}
