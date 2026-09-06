import type { AdapterEnvironment } from "../../contracts/src/index.js";
import type { CartInventoryEvidence, LiveOfferObservation } from "../../browser-safety/src/index.js";

export const BLUEMERCURY_ADD_ADAPTER_VERSION = "bluemercury-add-v1" as const;
const VARIANT = /^\d{10,20}$/;
const SKU = /^\d{8,14}$/;

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

export function bluemercuryUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && url.hostname === "bluemercury.com" ? url : null;
  } catch { return null; }
}

function handle(url: URL): string {
  return url.pathname.match(/^\/(?:collections\/[a-z0-9][a-z0-9-]*\/)?products\/([a-z0-9][a-z0-9-]*)\/?$/)?.[1] || "";
}

export function bluemercuryPageKind(value: string): LiveOfferObservation["pageKind"] {
  const url = bluemercuryUrl(value);
  if (!url) return "other";
  if (/^\/account(?:\/|$)/.test(url.pathname)) return "auth";
  if (/^\/cart\/?$/.test(url.pathname)) return "cart";
  if (/^\/checkouts?(?:\/|$)/.test(url.pathname)) return "checkout";
  return handle(url) ? "product" : "other";
}

export function bluemercuryUrlSku(value: string): string {
  const url = bluemercuryUrl(value), variant = url?.searchParams.get("variant") || "";
  return url && handle(url) && url.searchParams.getAll("variant").length === 1 && VARIANT.test(variant) ? variant : "";
}

export function bluemercurySecurityChallenge(document: Document, environment?: AdapterEnvironment): boolean {
  return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment))
    || [...document.querySelectorAll("iframe[src*='captcha'], iframe[src*='challenge']")].some(e => visible(e, environment));
}

export function bluemercuryInteractiveBlock(document: Document, url: string, environment?: AdapterEnvironment): LiveOfferObservation["interactiveBlock"] {
  if (bluemercuryPageKind(url) === "auth") return "auth";
  if (bluemercurySecurityChallenge(document, environment)) return "unknown";
  if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
  for (const e of document.querySelectorAll("dialog[open], [aria-modal='true'], input[type='password']")) {
    if (!visible(e, environment)) continue;
    // This storefront leaves an empty modal shell in the DOM while its inner dialog is display:none.
    const inner = e.matches("#global-modal.global-modal[role=dialog]") ? e.querySelector(":scope > .GlobalModal[data-modal-global]") : null;
    if (inner && e.children.length === 1 && !visible(inner, environment) && !text(e, environment)) continue;
    return "unknown";
  }
  return "";
}

export interface BluemercuryOfferBinding {
  control: Element;
  root: Element;
  variantId: string;
  unitPriceCents: number;
  fingerprint: string;
}

function jsonScript(root: Element, selector: string): Record<string, any> | null {
  const scripts = root.querySelectorAll(selector);
  if (scripts.length !== 1) return null;
  try {
    const value: unknown = JSON.parse(scripts[0]!.textContent || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
  } catch { return null; }
}

/** Assessed scope: Default Title or one Size selection, US shipping and native quantity one. */
export function bluemercuryOfferBinding(document: Document, value: string, variantId: string, environment?: AdapterEnvironment): BluemercuryOfferBinding | null {
  const url = bluemercuryUrl(value);
  if (!url || document.URL !== value || !handle(url) || !VARIANT.test(variantId)
    || url.searchParams.has("variant") && bluemercuryUrlSku(value) !== variantId
    || bluemercuryInteractiveBlock(document, value, environment)) return null;
  const roots = [...document.querySelectorAll("main > .ProductRefreshed")].filter(e => visible(e, environment));
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const main = root.querySelectorAll(".ProductRefreshed__Main [data-section-type=product-refreshed]");
  const addSections = root.querySelectorAll(".AddToCartWithShipping [data-section-type=add-to-cart]");
  if (main.length !== 1 || addSections.length !== 1 || !visible(main[0]!, environment) || !visible(addSections[0]!, environment)) return null;
  const add = addSections[0]!;
  const states = add.querySelectorAll("#addToCart.AddToCart[data-state=available-to-add]");
  const buttons = [...add.querySelectorAll("#addToCart .AddToCart__Add[type=submit]")].filter(e => visible(e, environment));
  if (states.length !== 1 || buttons.length !== 1 || text(buttons[0]!, environment).toUpperCase() !== "ADD TO BAG") return null;
  const control = buttons[0]!;
  if (control.matches(":disabled") || control.closest("[aria-disabled=true], [aria-busy=true]")) return null;
  if (root.querySelector("input[name=selling_plan], select[name=selling_plan], input[name^='properties['], select[name=id]")) return null;
  const quantities = [...states[0]!.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name=quantity], select.AddToCart__QtySelectSelect")];
  if (!quantities.length || !quantities.some(e => visible(e, environment))
    || quantities.some(e => e.disabled || e.value !== "1")
    || quantities.filter(e => e.tagName === "INPUT").length !== 1 || quantities.filter(e => e.tagName === "SELECT").length > 1) return null;
  for (const e of quantities) for (const attr of ["min", "max"] as const) {
    const limit = e.getAttribute(attr);
    if (limit !== null && (!/^\d+$/.test(limit) || (attr === "min" ? Number(limit) > 1 : Number(limit) < 1))) return null;
  }
  const section = jsonScript(main[0]!, 'script[type="application/json"][data-section-data]');
  const native = jsonScript(add, 'script[type="application/json"][data-add-to-cart-product-json]');
  const selected = section?.selectedVariant, variant = native?.variantData, productData = native?.productData;
  if (!section || !selected || !variant || !productData || String(selected.id) !== variantId || String(variant.id) !== variantId
    || !VARIANT.test(String(section.productId)) || String(productData.id) !== String(section.productId)
    || !Array.isArray(section.variantIds) || section.variantIds.length > 50 || section.variantIds.filter((v: unknown) => String(v) === variantId).length !== 1
    || !SKU.test(String(selected.sku)) || variant.sku !== selected.sku || selected.available !== true || selected.requires_shipping !== true
    || !Number.isSafeInteger(selected.price) || selected.price <= 0 || variant.price !== selected.price
    || !Array.isArray(selected.options) || selected.options.length !== 1 || JSON.stringify(variant.options) !== JSON.stringify(selected.options)
    || typeof selected.options[0] !== "string" || !selected.options[0] || selected.title !== selected.options[0]
    || productData.bundledProducts != null || selected.selling_plan_allocations?.length) return null;
  const options = [...root.querySelectorAll<HTMLInputElement>(".VariantPicker input[type=radio]")];
  if (selected.options[0] === "Default Title") {
    if (options.length !== 0 || section.variantIds.length !== 1) return null;
  } else {
    if (!options.length || options.some(e => e.name !== "Size") || options.filter(e => e.checked).length !== 1) return null;
    const option = options.find(e => e.checked)!;
    const label = option.closest("label");
    if (option.disabled || option.value !== selected.options[0] || !label || !visible(label, environment)
      || label.getAttribute("for") !== option.id || option.closest(".pills__pill--oos")
      || text(label, environment).toLowerCase() !== option.value.toLowerCase()) return null;
  }
  const titles = [...main[0]!.querySelectorAll("h1.main-product__title")].filter(e => visible(e, environment));
  const prices = [...main[0]!.querySelectorAll(".MainProductPrice[role=group]")].filter(e => visible(e, environment));
  if (titles.length !== 1 || prices.length !== 1 || text(titles[0]!, environment) !== productData.title) return null;
  // The assessed current price span is aria-hidden; the main price group's accessible label supplies the same value.
  const match = (prices[0]!.getAttribute("aria-label") || "").match(/^Price \$(\d[\d,]*(?:\.\d{2})?)\.$/);
  if (!match || Math.abs(Number(match[1]!.replace(/,/g, "")) * 100 - selected.price) > 0.000001) return null;
  const displayed = prices[0]!.querySelectorAll(".MainProductPrice--item-regular");
  if (displayed.length !== 1 || (displayed[0]!.textContent || "").trim() !== `$${match[1]}`
    || prices[0]!.querySelector(".MainProductPrice--item-sale")) return null;
  const products: Array<Record<string, any>> = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const p = JSON.parse(script.textContent || "null"); if (p?.["@type"] === "Product") products.push(p); } catch { /* unrelated schema */ }
  }
  if (products.length !== 1) return null;
  const product = products[0]!, canonical = bluemercuryUrl(String(product["@id"]));
  if (!canonical || canonical.pathname !== `/products/${handle(url)}` || canonical.search || product.name !== productData.title
    || !Array.isArray(product.offers) || !Array.isArray(product.shippingDetails)
    || !product.shippingDetails.some((s: any) => s?.shippingDestination?.addressCountry === "US" && s.shippingRate?.currency === "USD")) return null;
  const offers = product.offers.filter((o: any) => o?.sku === selected.sku);
  if (offers.length !== 1) return null;
  const offer = offers[0];
  // Offer URLs contain duplicated product paths on the live site. Identity comes from @id and both native selection records.
  let offerUrl: URL | null = null;
  try { offerUrl = bluemercuryUrl(new URL(String(offer.url || ""), url).href); } catch { return null; }
  if (!offerUrl || offerUrl.searchParams.getAll("variant").length !== 1 || offerUrl.searchParams.get("variant") !== variantId
    || ![canonical.pathname, `${url.pathname.replace(/\/$/, "")}/products/${handle(url)}`].includes(offerUrl.pathname)) return null;
  if (offer.priceCurrency !== "USD" || offer.name !== selected.title || offer.availability !== "https://schema.org/InStock"
    || !Number.isFinite(Number(offer.price)) || Math.abs(Number(offer.price) * 100 - selected.price) > 0.000001
    || [product.seller, offer.seller].some(s => s != null && s.name !== "Bluemercury" && s.name !== "bluemercury")) return null;
  const fingerprint = JSON.stringify([variantId, section, native, product, prices[0]!.getAttribute("aria-label"),
    text(titles[0]!, environment), quantities.map(e => [e.value, e.getAttribute("min"), e.getAttribute("max")]),
    options.map(e => [e.id, e.value, e.checked, e.disabled]), states[0]!.getAttribute("data-state")]);
  return { root, control, variantId, unitPriceCents: selected.price, fingerprint };
}

export function observeBluemercuryOffer(document: Document, url: string, variantId: string, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): LiveOfferObservation {
  const binding = bluemercuryOfferBinding(document, url, variantId, environment);
  return { contractVersion: 1, observedAt, url, pageKind: bluemercuryPageKind(url), retailerId: "bluemercury", retailerSku: binding?.variantId || "",
    availability: binding ? "in_stock" : "unknown", unitPriceCents: binding?.unitPriceCents ?? null, currency: "USD",
    sellerName: binding ? "Bluemercury" : "", sellerType: binding ? "first_party" : "unknown", fulfillment: binding ? "shipping" : "unknown",
    addControlActionable: Boolean(binding), securityChallenge: bluemercurySecurityChallenge(document, environment), interactiveBlock: bluemercuryInteractiveBlock(document, url, environment) };
}

/** Only assessed merchant metadata is accepted; customer/cart tokens and account data never enter evidence. */
export function bluemercuryCartInventory(value: unknown, observedAt = new Date().toISOString()): CartInventoryEvidence {
  const empty: CartInventoryEvidence = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
  if (!value || typeof value !== "object") return empty;
  const cart = value as Record<string, unknown>;
  if (cart.currency !== "USD" || !Array.isArray(cart.items) || cart.items.length > 25 || !Number.isSafeInteger(cart.item_count)) return empty;
  const lines = [];
  for (const item of cart.items as Array<Record<string, any>>) {
    if (!item || typeof item !== "object") return empty;
    const variantId = String(item.variant_id), properties = item.properties;
    let itemUrl: URL | null = null;
    try { itemUrl = bluemercuryUrl(new URL(String(item.url || ""), "https://bluemercury.com").href); } catch { return empty; }
    if (!VARIANT.test(variantId) || !SKU.test(String(item.sku)) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
      || !Number.isSafeInteger(item.final_price) || item.final_price <= 0 || !itemUrl || !handle(itemUrl)
      || bluemercuryUrlSku(itemUrl.href) !== variantId || item.selling_plan_allocation || item.requires_shipping !== true || item.gift_card !== false
      || !properties || typeof properties !== "object" || Array.isArray(properties)
      || Object.keys(properties).sort().join(",") !== "Brand,_noGiftBoxing,_sku,_skuLimit,_upc,_vendor"
      || properties._sku !== item.sku || !SKU.test(String(properties._upc)) || typeof properties._noGiftBoxing !== "boolean"
      || !Number.isSafeInteger(properties._skuLimit) || properties._skuLimit < item.quantity || properties._skuLimit > 99
      || typeof properties._vendor !== "string" || !properties._vendor || properties._vendor.length > 100 || properties.Brand !== properties._vendor
      || !Number.isSafeInteger(item.final_line_price) || item.final_line_price !== item.quantity * item.final_price) return empty;
    lines.push({ retailerSku: variantId, quantity: Number(item.quantity), unitPriceCents: Number(item.final_price), sellerName: "Bluemercury", sellerType: "first_party" as const });
  }
  if (new Set(lines.map(line => line.retailerSku)).size !== lines.length || lines.reduce((sum, line) => sum + line.quantity, 0) !== cart.item_count
    || !Number.isSafeInteger(cart.total_price) || lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0) !== cart.total_price) return empty;
  return { contractVersion: 1, observedAt, complete: true, independentlyCounted: true, independentLineCount: lines.length, lines };
}
