import type { AdapterEnvironment } from "../../contracts/src/index.js";
import type { CartInventoryEvidence, LiveOfferObservation } from "../../browser-safety/src/index.js";
import { renderedVisible as visible } from "./dom.js";

export { BANANAREPUBLIC_ADD_ADAPTER_VERSION } from "../../contracts/src/index.js";
const CHILD_SKU = /^\d{9}0000$/;


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

export function bananarepublicUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["bananarepublic.gap.com", "secure-bananarepublic.gap.com"].includes(url.hostname) ? url : null;
  } catch { return null; }
}

export function bananarepublicUrlSku(value: string): string {
  const url = bananarepublicUrl(value);
  const sku = url?.searchParams.get("pid") || "";
  return url?.hostname === "bananarepublic.gap.com" && url.pathname === "/browse/product.do"
    && url.searchParams.getAll("pid").length === 1 && CHILD_SKU.test(sku)
    && (!url.searchParams.has("vid") || url.searchParams.getAll("vid").length === 1 && url.searchParams.get("vid") === "1") ? sku : "";
}

export function bananarepublicPageKind(value: string): LiveOfferObservation["pageKind"] {
  const url = bananarepublicUrl(value);
  if (!url) return "other";
  if (/^\/my-account\/(?:sign-in|register)(?:\/|$)/.test(url.pathname)) return "auth";
  if (url.hostname === "secure-bananarepublic.gap.com" && url.pathname === "/shopping-bag") return "cart";
  if (/^\/checkout(?:\/|$)/.test(url.pathname)) return "checkout";
  return bananarepublicUrlSku(value) ? "product" : "other";
}

export function bananarepublicSecurityChallenge(document: Document, environment?: AdapterEnvironment): boolean {
  return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment))
    || elements(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
}

export function bananarepublicInteractiveBlock(document: Document, url: string, environment?: AdapterEnvironment): LiveOfferObservation["interactiveBlock"] {
  if (bananarepublicPageKind(url) === "auth") return "auth";
  if (bananarepublicSecurityChallenge(document, environment)) return "unknown";
  if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
  if (elements(document, "dialog[open], [aria-modal='true'], input[type='password']", environment).length) return "unknown";
  return "";
}

export interface BananaRepublicOfferBinding {
  control: Element;
  root: Element;
  retailerSku: string;
  unitPriceCents: number;
  fingerprint: string;
}

// Initial scope: the assessed One Size child offers with US shipping selected.
export function bananarepublicOfferBinding(document: Document, urlValue: string, expectedSku?: string, environment?: AdapterEnvironment): BananaRepublicOfferBinding | null {
  const retailerSku = bananarepublicUrlSku(urlValue);
  if (!retailerSku || document.URL !== urlValue || expectedSku !== undefined && expectedSku !== retailerSku
    || bananarepublicInteractiveBlock(document, urlValue, environment)) return null;
  const roots = elements(document, "#buy-box-wrapper-id", environment);
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const controls = elements(root, "button#pdp-atb-btn[type=button]", environment);
  if (controls.length !== 1) return null;
  const control = controls[0]!;
  if (text(control, environment) !== "Add to Bag" || control.matches(":disabled")
    || control.closest("[aria-disabled=true], [aria-busy=true], [data-isdisabled=true], [data-isloading=true]")) return null;
  const quantities = [...root.querySelectorAll<HTMLSelectElement>("#AddToBag select")];
  const quantityLabels = elements(root, "#pdp-quantity-selector", environment);
  if (quantities.length !== 1 || quantities[0]!.value !== "1" || quantityLabels.length !== 1
    || text(quantityLabels[0]!, environment) !== "1") return null;
  const sizes = [...root.querySelectorAll<HTMLInputElement>("input[name=buybox-sizeDimension1]")];
  if (sizes.length !== 1 || !sizes[0]!.checked || sizes[0]!.disabled || sizes[0]!.getAttribute("aria-disabled") === "true"
    || root.querySelector("input[name=buybox-sizeDimension2]")) return null;
  const sizeLabels = elements(root, "label[for]", environment).filter(label => label.getAttribute("for") === sizes[0]!.id);
  if (sizeLabels.length !== 1 || text(sizeLabels[0]!, environment) !== "One Size") return null;
  const colors = [...root.querySelectorAll<HTMLInputElement>("input[name=buybox-color-swatch]:checked")];
  const colorLabels = elements(root, "[data-testid=pdp-color-value]", environment);
  if (colors.length !== 1 || colors[0]!.disabled || colors[0]!.getAttribute("data-testid") !== "pdp-color-swatch-instock"
    || colorLabels.length !== 1 || colors[0]!.getAttribute("aria-label") !== text(colorLabels[0]!, environment)) return null;
  const shipping = [...root.querySelectorAll<HTMLInputElement>("input#shipping[data-testid=pdp-fulfillment-shipping]")];
  const pickup = [...root.querySelectorAll<HTMLInputElement>("input#pickup[data-testid=pdp-fulfillment-pickup]")];
  const shippingStatus = elements(root, "[data-testid=shipping-inventory-status]", environment);
  if (shipping.length !== 1 || !shipping[0]!.checked || shipping[0]!.getAttribute("data-selected") !== "true"
    || pickup.length !== 1 || pickup[0]!.checked || pickup[0]!.getAttribute("data-selected") !== "false"
    || shippingStatus.length !== 1 || text(shippingStatus[0]!, environment) !== "In Stock") return null;
  const names = elements(root, "h1[data-testid=product-title]", environment);
  const prices = elements(root, "[data-testid=pdp-title-price-wrapper] .fds__core-web-purchase-price", environment);
  if (names.length !== 1 || prices.length !== 1) return null;
  const unitPriceCents = cents(text(prices[0]!, environment));
  if (!unitPriceCents) return null;
  const products: Array<Record<string, any>> = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent || "null");
      for (const entry of Array.isArray(data) ? data : [data]) if (entry?.["@type"] === "Product") products.push(entry);
    } catch { /* Missing structured evidence cannot qualify a product. */ }
  }
  if (products.length !== 1) return null;
  const product = products[0]!;
  const offers = product.offers;
  if (!Array.isArray(offers) || offers.length !== 1) return null;
  const offer = offers[0];
  const content = text(root, environment);
  if (product.productID !== retailerSku.slice(0, 9) || String(product.name).toLocaleLowerCase("en-US") !== text(names[0]!, environment).toLocaleLowerCase("en-US")
    || product.brand?.name !== "Banana Republic" || product.color !== text(colorLabels[0]!, environment)
    || !offer || offer.sku !== retailerSku || bananarepublicUrlSku(String(offer.url)) !== retailerSku
    || offer.priceCurrency !== "USD" || cents(`$${offer.price}`) !== unitPriceCents
    || offer.seller?.name !== "Banana Republic" || offer.availability !== "https://schema.org/InStock"
    || offer.itemCondition !== "https://schema.org/NewCondition"
    || /pre[ -]?order|subscription|sold (?:and shipped )?by|\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/i.test(content)) return null;
  const fingerprint = JSON.stringify([retailerSku, unitPriceCents, product.name, product.color, "One Size", "shipping",
    sizes[0]!.id, colors[0]!.id, quantities[0]!.value]);
  return { root, control, retailerSku, unitPriceCents, fingerprint };
}

export function observeBananaRepublicOffer(document: Document, url: string, retailerSku: string, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): LiveOfferObservation {
  const binding = bananarepublicOfferBinding(document, url, retailerSku, environment);
  return { contractVersion: 1, observedAt, url, pageKind: bananarepublicPageKind(url), retailerId: "bananarepublic", retailerSku: bananarepublicUrlSku(url),
    availability: binding ? "in_stock" : "unknown", unitPriceCents: binding?.unitPriceCents ?? null, currency: "USD",
    sellerName: binding ? "Banana Republic" : "", sellerType: binding ? "first_party" : "unknown", fulfillment: binding ? "shipping" : "unknown",
    addControlActionable: Boolean(binding), securityChallenge: bananarepublicSecurityChallenge(document, environment), interactiveBlock: bananarepublicInteractiveBlock(document, url, environment) };
}

export function observeBananaRepublicCart(document: Document, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): CartInventoryEvidence {
  const incomplete: CartInventoryEvidence = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
  if (bananarepublicPageKind(document.URL) !== "cart" || bananarepublicInteractiveBlock(document, document.URL, environment)) return incomplete;
  const counters = elements(document, "button#shopping-bag[aria-label]", environment);
  const countMatch = counters.length === 1 ? counters[0]!.getAttribute("aria-label")?.match(/^(\d{1,3}) items? in your shopping bag$/) : null;
  if (!countMatch) return incomplete;
  const count = Number(countMatch[1]);
  const rows = elements(document, 'li[data-testid^="active-item-"]', environment);
  if (rows.length > 25) return incomplete;
  const lines: Array<{ retailerSku: string; quantity: number; unitPriceCents: number; sellerName: string; sellerType: "first_party" }> = [];
  for (const row of rows) {
    const links = elements(row, "[data-testid=product-name] a[href]", environment);
    if (links.length !== 1) return incomplete;
    const retailerSku = bananarepublicUrlSku((links[0] as HTMLAnchorElement).href);
    const quantities = elements(row, "[data-testid=product-quantity]", environment);
    const priceRoots = elements(row, "[data-testid=product-price]", environment);
    const sizes = elements(row, "[data-testid=product-size]", environment);
    const shipping = [...row.querySelectorAll<HTMLInputElement>("[data-testid=ship-to-address] input[type=radio]")];
    const pickup = [...row.querySelectorAll<HTMLInputElement>("[data-testid=find-store] input[type=radio]")];
    if (!retailerSku || quantities.length !== 1 || !/^[1-9]\d?$/.test(text(quantities[0]!, environment))
      || priceRoots.length !== 1 || sizes.length !== 1 || text(sizes[0]!, environment) !== "One Size"
      || shipping.length !== 1 || !shipping[0]!.checked || pickup.length !== 1 || pickup[0]!.checked
      || /pre[ -]?order|subscription|out of stock|sold out/i.test(text(row, environment))) return incomplete;
    const currentPrices = elements(priceRoots[0]!, "span", environment).filter(element => !element.closest(".line-through, s, del"));
    if (currentPrices.length !== 1) return incomplete;
    const unitPriceCents = cents(text(currentPrices[0]!, environment));
    if (!unitPriceCents || lines.some(line => line.retailerSku === retailerSku)) return incomplete;
    lines.push({ retailerSku, quantity: Number(text(quantities[0]!, environment)), unitPriceCents, sellerName: "Banana Republic", sellerType: "first_party" as const });
  }
  const emptyText = /Your bag is currently empty[.]/.test(text(document.body, environment));
  if (lines.reduce((sum, line) => sum + line.quantity, 0) !== count
    || (lines.length === 0 ? !emptyText || count !== 0 : emptyText)) return incomplete;
  return { contractVersion: 1, observedAt, complete: true, independentlyCounted: true, independentLineCount: lines.length, lines };
}
