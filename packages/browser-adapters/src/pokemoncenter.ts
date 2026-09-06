import { BROWSER_SAFETY_CONTRACT_VERSION, type CartInventoryEvidence, type LiveOfferObservation } from "../../browser-safety/src/index.js";
import type { AdapterEnvironment, Fulfillment } from "../../contracts/src/index.js";
import { extractRetailerSku, parseRetailerPriceElement, retailerInteractiveBlock, retailerSecurityChallenge } from "./retailers.js";

const SKU = /^\d{2,3}-\d{5}(?:-\d{3})?$/;
const PRODUCT_ROOT = "[data-testid='product-detail'], [data-testid='product-details'], .product-detail, .product-details, [itemtype$='/Product'], main";
const QUANTITY = "input[name*='quantity' i], select[name*='quantity' i], input[aria-label*='quantity' i], select[aria-label*='quantity' i], input[type='number'], [role='spinbutton']";
const PRICE = "[data-testid='product-price'], [data-testid='unit-price'], [itemprop='price']:not(meta), .product-price, .sales-price";
const MERCHANDISING = "aside, [data-testid*='recommend' i], [class*='recommend' i], [data-testid*='saved' i], [class*='saved-for-later' i]";

function visible(element: Element, environment?: AdapterEnvironment): boolean {
  if (environment?.isVisible) {
    try { return environment.isVisible(element); } catch { return false; }
  }
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute("hidden") || current.hasAttribute("inert") || current.getAttribute("aria-hidden") === "true") return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style && (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0")) return false;
  }
  return true;
}

function elements(root: ParentNode, selector: string, environment?: AdapterEnvironment): Element[] {
  return [...root.querySelectorAll(selector)].filter((el) => visible(el, environment));
}

function text(root: Element, environment?: AdapterEnvironment): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) parts.push(node.textContent || "");
    else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes((node as Element).tagName)
      && visible(node as Element, environment)) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 40_000);
}

function allowedUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["www.pokemoncenter.com", "pokemoncenter.com"].includes(url.hostname) ? url : null;
  } catch { return null; }
}

export function pokemonCenterPageKind(value: string): LiveOfferObservation["pageKind"] {
  const url = allowedUrl(value);
  if (!url) return "other";
  if (/^\/(?:login|signin|sign-in|account)(?:\/|$)/i.test(url.pathname)) return "auth";
  if (/^\/(?:queue|waiting-room)(?:\/|$)/i.test(url.pathname)) return "queue";
  if (/^\/cart\/?$/.test(url.pathname)) return "cart";
  if (/^\/(?:checkout|payment|order)(?:\/|$)/i.test(url.pathname)) return "checkout";
  return extractRetailerSku("pokemoncenter", value) ? "product" : "other";
}

export function pokemonCenterInteractiveBlock(document: Document, url: string, environment?: AdapterEnvironment): LiveOfferObservation["interactiveBlock"] {
  if (retailerSecurityChallenge(document, "pokemoncenter")) return "unknown";
  const kind = pokemonCenterPageKind(url);
  if (kind === "auth" || kind === "queue") return kind;
  const generic = retailerInteractiveBlock(document, url, environment);
  if (generic) return generic;
  // An overlay can intercept the Add click even if its text is unfamiliar.
  if (elements(document, "dialog[open], [role='dialog'][aria-modal='true']", environment).length) return "unknown";
  return "";
}

function exactSku(root: Element, links: boolean, environment?: AdapterEnvironment): string {
  const candidates: string[] = [];
  const nodes = [root, ...elements(root, "[data-sku], [data-product-id], [itemprop='sku']", environment)];
  for (const node of nodes) {
    for (const name of ["data-sku", "data-product-id"]) {
      const value = node.getAttribute(name);
      if (value) candidates.push(value.trim());
    }
    if (node.getAttribute("itemprop") === "sku") candidates.push(node.getAttribute("content") || text(node, environment));
  }
  for (const match of text(root, environment).matchAll(/\b(?:SKU|Item\s+(?:Number|No\.?|#))\s*:?\s*(\d[\d-]+)/gi)) candidates.push(match[1]!);
  if (links) for (const link of elements(root, "a[href*='/product/']", environment)) {
    const href = new URL(link.getAttribute("href")!, "https://www.pokemoncenter.com").href;
    candidates.push(allowedUrl(href) ? extractRetailerSku("pokemoncenter", href) : "");
  }
  const unique = [...new Set(candidates)];
  return unique.length === 1 && SKU.test(unique[0]!) ? unique[0]! : "";
}

function quantity(root: Element, environment?: AdapterEnvironment): number | null {
  const controls = elements(root, QUANTITY, environment);
  if (controls.length !== 1) return null;
  const control = controls[0]!;
  const value = control.getAttribute("role") === "spinbutton" ? control.getAttribute("aria-valuenow")
    : (control as HTMLInputElement).value;
  if (!/^\d{1,2}$/.test(value || "")) return null;
  const count = Number(value);
  for (const [attribute, lower] of [["min", true], ["max", false], ["aria-valuemin", true], ["aria-valuemax", false]] as const) {
    const bound = control.getAttribute(attribute);
    if (bound !== null && (!/^\d{1,2}$/.test(bound) || (lower ? count < Number(bound) : count > Number(bound)))) return null;
  }
  return count >= 1 && count <= 99 ? count : null;
}

function price(root: Element, environment?: AdapterEnvironment): number | null {
  const nodes = elements(root, PRICE, environment).filter((node) => !node.closest("del, s"));
  const values = nodes.map((node) => /(?:\$|USD)/.test(text(node, environment)) ? parseRetailerPriceElement(node) : null);
  return values.length > 0 && values.every((value) => value !== null && value === values[0]) ? values[0]! : null;
}

function usd(root: Element, environment?: AdapterEnvironment): boolean {
  const currencies = [...root.querySelectorAll("[itemprop='priceCurrency'], [data-currency]")]
    .map((node) => node.getAttribute("content") || node.getAttribute("data-currency") || text(node, environment));
  return currencies.every((value) => value.trim() === "USD")
    && !/\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/.test(text(root, environment));
}

function firstParty(root: Element, environment?: AdapterEnvironment): boolean {
  const value = text(root, environment);
  return !/\b(?:sold|fulfilled|shipped)\s+(?:and\s+shipped\s+)?by\s+(?!pok[eé]mon\s+center\b)/i.test(value)
    && !/\b(?:marketplace|third[ -]party seller)\b/i.test(value);
}

export interface PokemonCenterOfferBinding {
  control: Element;
  root: Element;
  unitPriceCents: number;
  fingerprint: string;
}

export function pokemonCenterOfferBinding(document: Document, url: string, sku: string, environment?: AdapterEnvironment): PokemonCenterOfferBinding | null {
  if (document.URL !== url || pokemonCenterPageKind(url) !== "product" || extractRetailerSku("pokemoncenter", url) !== sku
    || pokemonCenterInteractiveBlock(document, url, environment)) return null;
  const controls = elements(document, "button, input[type='submit'], [role='button']", environment)
    .filter((node) => !node.closest(MERCHANDISING)
      && /^add\s+to\s+(?:cart|bag)$/i.test((node.tagName === "INPUT" ? (node as HTMLInputElement).value : text(node, environment)).trim()));
  if (controls.length !== 1) return null;
  const control = controls[0]!;
  if (control.matches(":disabled") || control.closest("[aria-disabled='true']")) return null;
  let root = control.closest(PRODUCT_ROOT);
  // A nested product-details container may omit its sibling quantity/price.
  // Only move outward through known product roots with the same exact SKU.
  while (root && !exactSku(root, false, environment)) root = root.parentElement?.closest(PRODUCT_ROOT) || null;
  if (!root || exactSku(root, false, environment) !== sku || quantity(root, environment) !== 1) return null;
  const unitPriceCents = price(root, environment);
  const content = text(root, environment);
  if (!unitPriceCents || !usd(root, environment) || !usd(document.documentElement, environment) || !firstParty(root, environment)
    || /sold out|out of stock|unavailable|pre[ -]?order|subscription|subscribe|pickup|pick-up/i.test(content)
    || !/\b(?:shipping|ships|delivery)\b/i.test(content)
    || /(?:shipping|delivery)\s+(?:is\s+)?(?:not available|unavailable)|cannot (?:be )?ship/i.test(content)) return null;
  const variants = elements(root, "select, input[type='radio']", environment).filter((node) => !node.matches(QUANTITY));
  if (variants.some((node) => node.tagName === "SELECT" && (!(node as HTMLSelectElement).value
    || (node as HTMLSelectElement).selectedOptions[0]?.disabled))) return null;
  const radios = variants.filter((node) => node.tagName === "INPUT") as HTMLInputElement[];
  if ([...new Set(radios.map((node) => node.name))].some((name) => !name || radios.filter((node) => node.name === name && node.checked).length !== 1)) return null;
  const fingerprint = JSON.stringify([sku, unitPriceCents, 1, variants.map((node) => [
    (node as HTMLInputElement).name, (node as HTMLInputElement).value, (node as HTMLInputElement).checked ?? null
  ])]);
  return { control, root, unitPriceCents, fingerprint };
}

export function observePokemonCenterOffer(document: Document, url: string, sku: string, fulfillment: Fulfillment,
  observedAt = new Date().toISOString(), environment?: AdapterEnvironment): LiveOfferObservation {
  const binding = fulfillment === "shipping" ? pokemonCenterOfferBinding(document, url, sku, environment) : null;
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION, observedAt, url,
    pageKind: pokemonCenterPageKind(url), retailerId: "pokemoncenter",
    retailerSku: extractRetailerSku("pokemoncenter", url),
    availability: binding ? "in_stock" : "unknown", unitPriceCents: binding?.unitPriceCents ?? null,
    currency: "USD", sellerName: binding ? "Pokémon Center" : "", sellerType: binding ? "first_party" : "unknown",
    fulfillment: binding ? "shipping" : "unknown", addControlActionable: Boolean(binding),
    securityChallenge: retailerSecurityChallenge(document, "pokemoncenter"),
    interactiveBlock: pokemonCenterInteractiveBlock(document, url, environment)
  };
}

export function observePokemonCenterCart(document: Document, observedAt = new Date().toISOString(), environment?: AdapterEnvironment): CartInventoryEvidence {
  const roots = elements(document, "[data-testid='cart-items'], [data-testid='shopping-cart'], .shopping-cart, main", environment);
  const scoped = roots.filter((candidate) => !roots.some((other) => other !== candidate && candidate.contains(other)));
  const root = scoped.length === 1 ? scoped[0] : null;
  const empty: CartInventoryEvidence = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
  if (!root || !usd(root, environment)) return empty;
  const candidates = elements(root, "[data-testid='cart-item'], [data-testid^='cart-item-'], .cart-item, [data-cart-item]", environment)
    .filter((node) => !node.closest(MERCHANDISING));
  const rows = candidates.filter((node) => !candidates.some((parent) => parent !== node && parent.contains(node)));
  const lines = rows.map((row) => ({
    retailerSku: exactSku(row, true, environment), quantity: quantity(row, environment), unitPriceCents: price(row, environment),
    sellerName: firstParty(row, environment) ? "Pokémon Center" : "", sellerType: firstParty(row, environment) ? "first_party" as const : "unknown" as const
  }));
  // A separate cart item count must agree with the sum of all row quantities.
  // Never infer an empty baseline just because selectors found no rows.
  const counters = elements(document, "[data-cart-quantity], [data-testid='cart-count'], [data-testid='cart-item-count']", environment);
  const counts = counters.map((node) => {
    const raw = node.getAttribute("data-cart-quantity") ?? text(node, environment);
    const match = raw.match(/^\s*(?:(?:shopping )?(?:cart|bag)\s*\(?\s*)?(\d{1,3})(?:\s*items?)?\)?\s*$/i);
    return match ? Number(match[1]) : null;
  });
  const total = lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
  const independentlyCounted = counts.length > 0 && counts.every((count) => count === total);
  const unboundLinks = elements(root, "a[href*='/product/']", environment)
    .some((link) => !link.closest(MERCHANDISING) && !rows.some((row) => row.contains(link)));
  const complete = independentlyCounted && !unboundLinks && lines.length <= 25
    && lines.every((line) => line.retailerSku && line.quantity !== null && line.unitPriceCents !== null && line.sellerType === "first_party")
    && (rows.length > 0 || /(?:your (?:shopping )?)?(?:cart|bag) is empty|no items in (?:your )?(?:cart|bag)/i.test(text(root, environment)));
  return { contractVersion: 1, observedAt, complete, independentlyCounted, independentLineCount: rows.length, lines };
}
