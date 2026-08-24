import { BROWSER_SAFETY_CONTRACT_VERSION, type LiveOfferObservation } from "../../browser-safety/src/index.js";
import {
  AMAZON_OBSERVER_VERSION,
  BESTBUY_OBSERVER_VERSION,
  RETAILER_OBSERVER_VERSIONS,
  WALMART_OBSERVER_VERSION,
  type Fulfillment,
  type RetailerAdapterLayoutEvidence,
  type RetailerObserverVersion,
  type SellerType,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { selectedOfferScope } from "./selected-offer.js";

export { AMAZON_OBSERVER_VERSION, BESTBUY_OBSERVER_VERSION, WALMART_OBSERVER_VERSION };

interface RetailerObserverConfig {
  retailerId: Exclude<SupportedRetailerId, "target">;
  domains: string[];
  skuPattern: RegExp;
  skuFromUrl: (url: URL) => string;
  addSelectors: string[];
  addIntentPattern?: RegExp;
  priceSelectors: string[];
  sellerSelectors: string[];
  firstPartyPattern: RegExp;
  marketplacePattern: RegExp;
  shippingPattern: RegExp;
  pickupPattern: RegExp;
  defaultShipping: boolean;
  implicitFirstParty: boolean;
  firstPartyName: string;
}

function fanaticsProductId(url: URL): string {
  return url.pathname.replace(/%2B/gi, "+").match(/(?:^|\+)p-(\d{6,20})(?:\+|$)/i)?.[1] || "";
}

const CONFIGS: Record<Exclude<SupportedRetailerId, "target">, RetailerObserverConfig> = {
  walmart: {
    retailerId: "walmart",
    domains: ["walmart.com"],
    skuPattern: /^\d{5,20}$/,
    skuFromUrl: (url) => url.pathname.match(/\/ip\/(?:[^/?#]+\/)?(\d{5,20})(?:\/|$)/i)?.[1]
      || url.searchParams.get("items")?.match(/^\d{5,20}$/)?.[0] || "",
    addSelectors: [
      "button[data-automation-id='atc']",
      "button[data-testid='add-to-cart-button']",
      "button[aria-label*='add to cart' i]"
    ],
    priceSelectors: [
      "[data-automation-id='product-price']",
      "[data-testid='price-wrap']",
      "meta[itemprop='price']",
      "[itemprop='price']"
    ],
    sellerSelectors: [
      "[data-testid='seller-display-name']",
      "[data-automation-id='seller-name']",
      "[data-testid*='seller' i]"
    ],
    firstPartyPattern: /sold\s+(?:and|&)\s+shipped\s+by\s+walmart(?:\.com)?|sold\s+by\s+walmart(?:\.com)?(?:\s+(?:and|&)\s+(?:shipped|fulfilled)\s+by\s+walmart(?:\.com)?)?/i,
    marketplacePattern: /sold\s+(?:and|&)\s+shipped\s+by\s+(?!walmart\b)|sold\s+by\s+(?!walmart\b)|marketplace\s+seller/i,
    shippingPattern: /shipping|ship to|delivery/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: false,
    implicitFirstParty: false,
    firstPartyName: "Walmart"
  },
  amazon: {
    retailerId: "amazon",
    domains: ["amazon.com"],
    skuPattern: /^[A-Z0-9]{10}$/,
    skuFromUrl: (url) => (url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]
      || url.searchParams.get("asin")?.match(/^[A-Z0-9]{10}$/i)?.[0] || "").toUpperCase(),
    addSelectors: [
      "#add-to-cart-button",
      "input[name='submit.add-to-cart']",
      "button[name='submit.add-to-cart']"
    ],
    priceSelectors: [
      "#corePrice_feature_div .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      ".a-price .a-offscreen",
      "meta[itemprop='price']"
    ],
    sellerSelectors: [
      "#merchant-info",
      "#sellerProfileTriggerId",
      "[data-feature-name='shipsFromSoldBy']",
      "#tabular-buybox"
    ],
    firstPartyPattern: /ships\s+from\s+amazon(?:\.com)?[\s\S]{0,160}sold\s+by\s+amazon(?:\.com)?|sold\s+by\s+amazon(?:\.com)?[\s\S]{0,160}ships\s+from\s+amazon(?:\.com)?/i,
    marketplacePattern: /sold\s+by\s+(?!amazon(?:\.com)?\b)|seller:\s*(?!amazon(?:\.com)?\b)/i,
    shippingPattern: /shipping|delivery|ships from/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: false,
    implicitFirstParty: false,
    firstPartyName: "Amazon.com"
  },
  bestbuy: {
    retailerId: "bestbuy",
    domains: ["bestbuy.com"],
    skuPattern: /^\d{5,20}$/,
    skuFromUrl: (url) => url.pathname.match(/^\/product\/[^/]+\/(?:[^/]+\/sku\/)?(\d{5,20})(?:\/|$)/i)?.[1]
      || url.pathname.match(/^\/site\/[^/]+\/(\d{5,20})\.p(?:\/|$)/i)?.[1]
      || url.searchParams.get("skuId")?.match(/^\d{5,20}$/)?.[0] || "",
    addSelectors: [
      "button.add-to-cart-button",
      "button[data-button-state='ADD_TO_CART']",
      "button[data-testid*='add-to-cart' i]",
      "button[data-test-id*='add-to-cart' i]",
      "button[data-automation-id*='add-to-cart' i]",
      "button[name*='add-to-cart' i]",
      "button[aria-label*='add to cart' i]",
      "input[type='submit'][value*='add to cart' i]",
      "button"
    ],
    priceSelectors: [
      "[data-testid='customer-price']",
      "[data-testid*='customer-price' i]",
      ".priceView-customer-price",
      ".priceView-hero-price",
      "meta[itemprop='price']",
      "[itemprop='price']"
    ],
    sellerSelectors: [
      "[data-testid='sold-by']",
      "[data-testid*='sold-by' i]",
      "[data-testid*='seller' i]",
      "[class*='seller' i]",
      "[data-track*='marketplace' i]"
    ],
    firstPartyPattern: /sold\s+(?:and|&)\s+shipped\s+by\s+best\s*buy|sold\s+by\s+best\s*buy/i,
    marketplacePattern: /sold\s+(?:and|&)\s+shipped\s+by\s+(?!best\s*buy\b)|sold\s+by\s+(?!best\s*buy\b)|marketplace\s+seller/i,
    shippingPattern: /shipping|ship to|delivery/i,
    pickupPattern: /pickup|pick-up|get it today/i,
    defaultShipping: false,
    implicitFirstParty: false,
    firstPartyName: "Best Buy"
  },
  disney: {
    retailerId: "disney",
    domains: ["disneystore.com"],
    skuPattern: /^\d{10,20}$/,
    skuFromUrl: (url) => url.pathname.match(/-(\d{10,20})\.html(?:\/|$)/i)?.[1] || "",
    addSelectors: [
      "button[data-testid*='add-to-cart' i]",
      "button[data-testid*='add-to-bag' i]",
      "button[name*='add-to-cart' i]",
      "button[aria-label*='add to bag' i]",
      "button[aria-label*='add to cart' i]",
      "button"
    ],
    priceSelectors: [
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='product-price' i]",
      "[class*='product-price' i]"
    ],
    sellerSelectors: [],
    firstPartyPattern: /sold\s+by\s+disney\s*store/i,
    marketplacePattern: /sold\s+by\s+(?!disney\s*store\b)/i,
    shippingPattern: /shipping|ship to|delivery/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: true,
    implicitFirstParty: true,
    firstPartyName: "Disney Store"
  },
  ravensburger: {
    retailerId: "ravensburger",
    domains: ["ravensburger.us"],
    skuPattern: /^\d{5,20}$/,
    skuFromUrl: (url) => /^\/en-US\/products\//i.test(url.pathname)
      ? url.pathname.match(/-(\d{5,20})(?:\/|$)/i)?.[1] || ""
      : "",
    addSelectors: [
      "button[data-testid*='add-to-cart' i]",
      "button[name*='add-to-cart' i]",
      "button[aria-label*='add to cart' i]",
      "button[class*='add-to-cart' i]",
      "button"
    ],
    priceSelectors: [
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='price' i]",
      "[class*='product-price' i]"
    ],
    sellerSelectors: [],
    firstPartyPattern: /sold\s+by\s+ravensburger/i,
    marketplacePattern: /sold\s+by\s+(?!ravensburger\b)/i,
    shippingPattern: /shipping|ship to|delivery/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: true,
    implicitFirstParty: true,
    firstPartyName: "Ravensburger"
  },
  riot: {
    retailerId: "riot",
    domains: ["merch.riotgames.com"],
    skuPattern: /^[A-Z0-9](?:[A-Z0-9-]{1,118}[A-Z0-9])?$/,
    skuFromUrl: (url) => url.pathname.match(/^\/en-us\/product\/([a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?)\/?$/i)?.[1] || "",
    addSelectors: [
      "button[data-testid*='add-to-cart' i]",
      "button[name*='add-to-cart' i]",
      "button[aria-label*='add to cart' i]",
      "button[class*='add-to-cart' i]",
      "button"
    ],
    priceSelectors: [
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='price' i]",
      "[class*='product-price' i]"
    ],
    sellerSelectors: [],
    firstPartyPattern: /sold\s+by\s+riot\s+games/i,
    marketplacePattern: /sold\s+by\s+(?!riot\s+games\b)/i,
    shippingPattern: /shipping|ships|delivery|fulfillment/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: true,
    implicitFirstParty: true,
    firstPartyName: "Riot Games Merch"
  },
  booksamillion: {
    retailerId: "booksamillion",
    domains: ["booksamillion.com"],
    skuPattern: /^[A-Z0-9]{10,20}$/,
    skuFromUrl: (url) => url.pathname.match(/^\/p\/-\/([a-z0-9]{10,20})(?:\/|$)/i)?.[1]
      || url.pathname.match(/^\/p\/([a-z0-9]{10,20})(?:\/|$)/i)?.[1] || "",
    addSelectors: [
      "button[data-testid*='add-to-cart' i]",
      "button[name*='add-to-cart' i]",
      "button[aria-label*='add to cart' i]",
      "input[type='submit'][value*='add to cart' i]",
      "button"
    ],
    priceSelectors: [
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='price' i]",
      "[class*='our-price' i]",
      "[class*='sale-price' i]"
    ],
    sellerSelectors: [],
    firstPartyPattern: /sold\s+by\s+(?:bam!?|books-a-million|books\s+a\s+million)/i,
    marketplacePattern: /sold\s+by\s+(?!(?:bam!?|books-a-million|books\s+a\s+million)\b)/i,
    shippingPattern: /shipping|ship to|delivery/i,
    pickupPattern: /pickup|pick-up|pick up in store/i,
    defaultShipping: false,
    implicitFirstParty: true,
    firstPartyName: "Books-A-Million"
  },
  fanatics: {
    retailerId: "fanatics",
    domains: ["fanatics.com"],
    skuPattern: /^\d{6,20}$/,
    skuFromUrl: fanaticsProductId,
    addSelectors: [
      "button[data-testid*='add-to-cart' i]",
      "button[name*='add-to-cart' i]",
      "button[aria-label*='add to cart' i]",
      "button[class*='add-to-cart' i]",
      "button"
    ],
    priceSelectors: [
      "[data-talos='pdpProductPrice'] .money-value",
      "[data-trk-id='pdp-price'] .money-value",
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='price' i]",
      "[class*='current-price' i]",
      "[class*='sale-price' i]"
    ],
    sellerSelectors: ["[data-testid*='seller' i]", "[class*='seller' i]", "[class*='shipping' i]"],
    firstPartyPattern: /sold\s+by\s+fanatics|ships?\s+(?:from|by)\s+fanatics/i,
    marketplacePattern: /ships?\s+directly\s+from\s+a\s+trusted\s+partner|sold\s+by\s+(?!fanatics\b)/i,
    shippingPattern: /shipping|ships|delivery/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: true,
    implicitFirstParty: false,
    firstPartyName: "Fanatics"
  },
  kohls: {
    retailerId: "kohls",
    domains: ["kohls.com"],
    skuPattern: /^\d{5,12}$/,
    skuFromUrl: (url) => url.pathname.match(/^\/product\/prd-(\d{5,12})\//i)?.[1] || "",
    addSelectors: [
      "button[data-testid*='add-to-cart' i]",
      "button[name*='add-to-cart' i]",
      "button[aria-label*='add to cart' i]",
      "button[class*='add-to-cart' i]",
      "button"
    ],
    priceSelectors: [
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='sale-price' i]",
      "[data-testid*='price' i]",
      "[class*='sale-price' i]"
    ],
    sellerSelectors: ["[data-testid*='seller' i]", "[class*='seller' i]"],
    firstPartyPattern: /sold\s+by\s+kohl'?s|ships?\s+(?:from|by)\s+kohl'?s/i,
    marketplacePattern: /sold\s+by\s+(?!kohl'?s\b)|marketplace\s+seller/i,
    shippingPattern: /ship to me|shipping|delivery/i,
    pickupPattern: /free store pickup|pickup|pick-up/i,
    defaultShipping: false,
    implicitFirstParty: false,
    firstPartyName: "Kohl's"
  },
  macys: {
    retailerId: "macys",
    domains: ["macys.com"],
    skuPattern: /^\d{5,20}$/,
    skuFromUrl: (url) => /^\/shop\/product\//i.test(url.pathname)
      ? url.searchParams.get("ID")?.match(/^\d{5,20}$/)?.[0] || url.searchParams.get("id")?.match(/^\d{5,20}$/)?.[0] || ""
      : "",
    addSelectors: [
      "button[data-testid*='add-to-bag' i]",
      "button[name*='add-to-bag' i]",
      "button[aria-label*='add to bag' i]",
      "button[class*='add-to-bag' i]",
      "button"
    ],
    priceSelectors: [
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='sale-price' i]",
      "[data-testid*='price' i]",
      "[class*='sale-price' i]"
    ],
    sellerSelectors: ["[data-testid*='seller' i]", "[class*='seller' i]", "[class*='marketplace' i]"],
    firstPartyPattern: /(?:shipped\s+and\s+)?sold\s+by\s+macy'?s/i,
    marketplacePattern: /(?:shipped\s+and\s+)?sold\s+by\s+(?!macy'?s\b)/i,
    shippingPattern: /shipping|ship to|delivery/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: false,
    implicitFirstParty: false,
    firstPartyName: "Macy's"
  },
  pbandai: {
    retailerId: "pbandai",
    domains: ["p-bandai.com"],
    skuPattern: /^[A-Z]\d{10}$/,
    skuFromUrl: (url) => url.pathname.match(/^\/us\/item\/([a-z]\d{10})(?:\/|$)/i)?.[1] || "",
    addSelectors: [
      "button[data-testid*='add-to-cart' i]",
      "button[data-automation-id*='add-to-cart' i]",
      "button[aria-label*='add to cart' i]",
      "button[class*='add-cart' i]",
      "button[class*='pre-order' i]",
      "a[class*='add-cart' i]",
      "a[class*='pre-order' i]",
      "button",
      "a[role='button']"
    ],
    addIntentPattern: /\b(?:add(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)|pre[ -]?order(?:\s+now|\s+(?:item\s+)?to\s+(?:cart|bag))?|atc)\b/i,
    priceSelectors: [
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='price' i]",
      "[class*='item-price' i]",
      "[class*='product-price' i]"
    ],
    sellerSelectors: [],
    firstPartyPattern: /sold\s+by\s+premium\s+bandai/i,
    marketplacePattern: /sold\s+by\s+(?!premium\s+bandai\b)/i,
    shippingPattern: /shipping|ships|delivery/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: true,
    implicitFirstParty: true,
    firstPartyName: "Premium Bandai"
  },
  pokemoncenter: {
    retailerId: "pokemoncenter",
    domains: ["pokemoncenter.com"],
    skuPattern: /^\d{2,3}-\d{5}(?:-\d{3})?$/,
    skuFromUrl: (url) => url.pathname.match(/^\/product\/(\d{2,3}-\d{5}(?:-\d{3})?)(?:\/|$)/i)?.[1] || "",
    addSelectors: [
      "button[data-testid*='add-to-cart' i]",
      "button[data-automation-id*='add-to-cart' i]",
      "button[name*='add-to-cart' i]",
      "button[aria-label*='add to cart' i]",
      "button[class*='add-to-cart' i]",
      "button"
    ],
    priceSelectors: [
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[itemprop='price']",
      "[data-testid*='price' i]",
      "[class*='product-price' i]",
      "[class*='sales-price' i]"
    ],
    sellerSelectors: [],
    firstPartyPattern: /sold\s+by\s+pok[eé]mon\s+center/i,
    marketplacePattern: /sold\s+by\s+(?!pok[eé]mon\s+center\b)/i,
    shippingPattern: /shipping|ships|delivery/i,
    pickupPattern: /pickup|pick-up/i,
    defaultShipping: true,
    implicitFirstParty: true,
    firstPartyName: "Pokémon Center"
  }
};

function text(value: Element | Document | null | undefined, maximum = 2_000): string {
  return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function observableText(value: Element | Document | null | undefined, maximum = 2_000): string {
  if (!value || maximum < 1) return "";
  const fragments: string[] = [];
  let length = 0;
  const append = (candidate: unknown): void => {
    if (length >= maximum) return;
    const fragment = String(candidate || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!fragment) return;
    const bounded = fragment.slice(0, maximum - length);
    fragments.push(bounded);
    length += bounded.length + 1;
  };
  const visit = (node: Node): void => {
    if (length >= maximum) return;
    if (node.nodeType === 3) {
      append(node.textContent);
      return;
    }
    if (node.nodeType === 1) {
      const element = node as Element;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName)
        || element.classList.contains("aok-hidden") || !visible(element)) return;
    }
    for (const child of [...node.childNodes]) visit(child);
  };
  visit(value);
  return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function sellerElementText(value: Element | null, maximum = 2_000): string {
  if (!value || maximum < 1) return "";
  const fragments = [observableText(value, maximum)];
  const elements = [value, ...value.querySelectorAll("[aria-label], [alt], [title], [data-seller-name]")];
  for (const element of elements) {
    if (!visible(element)) continue;
    for (const attribute of ["aria-label", "alt", "title", "data-seller-name"]) {
      const candidate = String(element.getAttribute(attribute) || "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (candidate) fragments.push(candidate);
    }
  }
  return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, maximum);
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

function actionable(element: Element | null): element is Element {
  return visible(element)
    && !element.hasAttribute("disabled")
    && element.getAttribute("aria-disabled") !== "true"
    && !/sold out|out of stock|unavailable|currently unavailable|pre[ -]?order closed|order(?:ing)? period (?:has )?ended|sales? ended/i.test(text(element, 300));
}

function queryVisible(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const found = [...root.querySelectorAll(selector)].find(visible);
    if (found) return found;
  }
  return null;
}

function parseUsPrice(value: unknown): number | null {
  const source = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!source || /(?:C|CA|MX|SG|HK|AU|A|R)\s*\$/i.test(source)) return null;
  const match = source.match(/(?:US\s*)?\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i)
    ?? (/^[0-9]{1,7}(?:\.[0-9]{1,2})?$/.test(source) ? [source, source] : null);
  if (!match?.[1]) return null;
  const dollars = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
}

function explicitFraction(value: unknown): boolean {
  const source = String(value ?? "").replace(/\s+/g, " ").trim();
  return /(?:^|\$\s*)[0-9]{1,7}(?:,[0-9]{3})*\.[0-9]{1,2}(?:\D|$)/.test(source);
}

function priceFragments(element: Element): string[] {
  const fragments: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const fragment = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (fragment) fragments.push(fragment);
      return;
    }
    if (node.nodeType !== 1) return;
    for (const child of [...node.childNodes]) visit(child);
  };
  visit(element);
  return fragments;
}

function splitDollarPrice(element: Element): number | null {
  const segmented = priceFragments(element).join("\u001f");
  const match = segmented.match(/(?:US\s*)?\$\s*(?:\u001f\s*)?([0-9]{1,7}(?:,[0-9]{3})*)\s*\u001f\s*([0-9]{2})(?!\d)/i);
  if (!match?.[1] || !match[2]) return null;
  const dollars = Number(match[1].replaceAll(",", ""));
  const cents = Number(match[2]);
  return Number.isSafeInteger(dollars) && dollars >= 0 && Number.isSafeInteger(cents)
    ? (dollars * 100) + cents
    : null;
}

export function parseRetailerPriceElement(element: Element): number | null {
  const nodes = [element, ...element.querySelectorAll("*")];
  const semanticCandidates = nodes.flatMap((node) => [
    node.getAttribute("content"),
    node.getAttribute("value"),
    node.getAttribute("aria-label"),
    node.getAttribute("data-price"),
    node.getAttribute("data-value")
  ]).filter((candidate): candidate is string => Boolean(candidate?.trim()));
  const leafCandidates = nodes
    .filter((node) => node.childElementCount === 0)
    .map((node) => text(node, 300))
    .filter(Boolean);

  // Walmart visually separates whole dollars and cents. Prefer any explicit
  // semantic decimal before looking at visual fragments so "$119" + "95"
  // cannot be mistaken for $11,995.
  for (const candidate of [...semanticCandidates, ...leafCandidates]) {
    if (!explicitFraction(candidate)) continue;
    const parsed = parseUsPrice(candidate);
    if (parsed !== null) return parsed;
  }
  const split = splitDollarPrice(element);
  if (split !== null) return split;
  for (const candidate of semanticCandidates) {
    const parsed = parseUsPrice(candidate);
    if (parsed !== null) return parsed;
  }
  if (element.childElementCount === 0) return parseUsPrice(text(element, 300));
  return null;
}

function readPrice(root: ParentNode, selectors: string[]): number | null {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (element.tagName !== "META" && !visible(element)) continue;
      const price = parseRetailerPriceElement(element);
      if (price !== null) return price;
    }
  }
  return null;
}

function config(retailerId: SupportedRetailerId): RetailerObserverConfig | null {
  return retailerId === "target" ? null : CONFIGS[retailerId];
}

function hostAllowed(url: URL, domains: string[]): boolean {
  return url.protocol === "https:" && !url.username && !url.password
    && domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}

export function extractRetailerSku(retailerId: Exclude<SupportedRetailerId, "target">, urlValue: string): string {
  try {
    const retailer = config(retailerId);
    const url = new URL(urlValue);
    if (!retailer || !hostAllowed(url, retailer.domains)) return "";
    const sku = retailer.skuFromUrl(url).toUpperCase();
    return retailer.skuPattern.test(sku) ? sku : "";
  } catch {
    return "";
  }
}

export function canonicalRetailerProductUrl(
  retailerId: Exclude<SupportedRetailerId, "target">,
  urlValue: string
): string {
  try {
    const retailer = config(retailerId);
    const url = new URL(urlValue);
    if (!retailer || !hostAllowed(url, retailer.domains) || url.pathname.length > 1_000) return "";
    const sku = extractRetailerSku(retailerId, url.href);
    if (!sku) return "";
    if (retailerId === "walmart") return `https://www.walmart.com/ip/${sku}`;
    if (retailerId === "amazon") return `https://www.amazon.com/dp/${sku}`;
    if (retailerId === "bestbuy") return `https://www.bestbuy.com/site/-/${sku}.p`;
    if (retailerId === "riot") return `https://merch.riotgames.com/en-us/product/${sku.toLocaleLowerCase("en-US")}/`;
    if (retailerId === "booksamillion") return `https://www.booksamillion.com/p/-/${sku}`;
    if (retailerId === "pbandai") return `https://p-bandai.com/us/item/${sku}`;
    if (retailerId === "pokemoncenter") {
      url.hostname = "www.pokemoncenter.com";
      url.port = "";
      url.search = "";
      url.hash = "";
      return url.href;
    }
    const canonical = new URL(`https://${retailerId === "disney" ? "www.disneystore.com"
      : retailerId === "ravensburger" ? "www.ravensburger.us"
        : retailerId === "fanatics" ? "www.fanatics.com"
          : retailerId === "kohls" ? "www.kohls.com"
            : "www.macys.com"}${url.pathname}`);
    if (retailerId === "macys") canonical.searchParams.set("ID", sku);
    return canonical.href;
  } catch {
    return "";
  }
}

export function retailerSecurityChallenge(document: Document): boolean {
  const title = String(document.title || "").replace(/\s+/g, " ").trim();
  if (/^(?:access denied(?:\s*-\s*.*)?|just a moment(?:\.\.\.)?)$/i.test(title)) return true;
  return Boolean(queryVisible(document, [
    "iframe[src*='captcha' i]",
    "iframe[src*='_Incapsula_Resource' i]",
    "[data-testid*='captcha' i]",
    "[id*='captcha' i]",
    "[class*='captcha' i]",
    "#challenge-running",
    "#challenge-stage",
    "[class*='cf-chl-' i]"
  ])) || /verify you are human|unusual traffic|security challenge|additional security check is required|protected and accelerated by imperva|enter the characters you see|checking your browser|performing security verification|enable javascript and cookies to continue|sorry, you have been blocked/i.test(text(document.body, 80_000));
}

function retailerUnavailableShell(document: Document): boolean {
  const title = String(document.title || "").replace(/\s+/g, " ").trim();
  if (/^page not available(?:\s*[|｜-].*)?$/i.test(title)) return true;
  return /\bpage you have attempted to access can not be displayed\b|\bpage (?:is|was) temporarily unavailable\b/i
    .test(text(document.body, 20_000));
}

export function retailerInteractiveBlock(document: Document, urlValue: string): LiveOfferObservation["interactiveBlock"] {
  const page = observableText(document.body, 100_000);
  if (retailerUnavailableShell(document)) return "unknown";
  if (queryVisible(document, ["input[autocomplete='one-time-code']", "input[name*='otp' i]"])) return "mfa";
  if (queryVisible(document, ["form[action*='login' i] input[type='password']", "input[autocomplete='current-password']"])) return "auth";
  const dialog = queryVisible(document, ["[role='dialog']", "dialog[open]"]);
  const dialogText = text(dialog, 12_000);
  if (dialog && /choose|select|set/i.test(dialogText) && /store|location|zip code/i.test(dialogText)) return "location";
  const bestBuyPage = (() => {
    try {
      const url = new URL(urlValue);
      return hostAllowed(url, CONFIGS.bestbuy.domains);
    } catch {
      return false;
    }
  })();
  if (bestBuyPage && /\b(?:available\s+)?in[ -]store only\b/i.test(page)
    && genericAddIntentControls(document).length === 0) return "location";
  const membershipEvidence = dialogText || page;
  if (/membership (?:is )?(?:required|needed)|invitation[- ]only|invite required|(?:prime|walmart\+) members? only|requires? (?:a )?(?:prime|walmart\+) membership/i.test(membershipEvidence)
    || (dialog && /\bjoin (?:walmart\+|prime)\b/i.test(dialogText))
    || /\bjoin (?:walmart\+|prime)\b.{0,80}\b(?:to|in order to)\b.{0,80}\b(?:add|buy|purchase|continue)\b/i.test(page)) return "membership";
  if (/you(?:’|')?re in line|virtual queue|waiting room|high demand|place in line/i.test(page)
    || (() => { try { return new URL(urlValue).pathname === "/qp"; } catch { return false; } })()) return "queue";
  if (retailerSecurityChallenge(document)) return "unknown";
  return "";
}

function sellerEvidence(
  document: Document,
  control: Element | null,
  retailer: RetailerObserverConfig,
  boundRoot: Element | null = null
): { sellerName: string; sellerType: SellerType } {
  const root = boundRoot || control?.closest("form, [data-testid*='buy-box' i], [data-automation-id*='buy-box' i], #buybox, main") || document;
  if (retailer.retailerId === "amazon") {
    const offerDisplaySeller = amazonOfferDisplaySeller(root);
    if (offerDisplaySeller) return offerDisplaySeller;
  }
  const element = queryVisible(root, retailer.sellerSelectors)
    || (boundRoot ? null : queryVisible(document, retailer.sellerSelectors));
  const sellerText = retailer.retailerId === "bestbuy"
    ? sellerElementText(element, 1_000)
    : text(element, 1_000);
  const scopedText = retailer.retailerId === "bestbuy"
    ? observableText(root, 80_000)
    : text(root, 80_000);
  const pageText = retailer.retailerId === "bestbuy"
    ? `${sellerText} ${scopedText}`.trim()
    : sellerText || scopedText;
  if (retailer.firstPartyPattern.test(pageText)) return { sellerName: retailer.firstPartyName, sellerType: "first_party" };
  if (retailer.retailerId === "fanatics" && /ships?\s+directly\s+from\s+a\s+trusted\s+partner/i.test(pageText)) {
    return { sellerName: "", sellerType: "unknown" };
  }
  if (sellerText && retailer.marketplacePattern.test(sellerText)) {
    const sellerName = sellerText
      .replace(/^.*?sold\s+(?:and|&)\s+shipped\s+by\s*/i, "")
      .replace(/^.*?sold\s+by\s*/i, "")
      .replace(/\s+(?:and|&)\s+(?:shipped|fulfilled)\s+by.*$/i, "")
      .trim()
      .slice(0, 160);
    return sellerName ? { sellerName, sellerType: "third_party" } : { sellerName: "", sellerType: "unknown" };
  }
  if (retailer.marketplacePattern.test(scopedText)) return { sellerName: "", sellerType: "unknown" };
  if (retailer.implicitFirstParty && control) return { sellerName: retailer.firstPartyName, sellerType: "first_party" };
  return { sellerName: "", sellerType: "unknown" };
}

function fulfillmentEvidence(root: Element | Document, control: Element | null, retailer: RetailerObserverConfig): "shipping" | "pickup" | "unknown" {
  const selected = [...root.querySelectorAll("[aria-selected='true'], [data-selected='true'], input:checked")]
    .filter(visible)
    .map((element) => text(element.closest("label, [role='tab'], [data-testid*='fulfillment' i], [data-automation-id*='fulfillment' i]") || element, 800));
  const evidence = [text(control, 500), ...selected].join(" ");
  const shipping = retailer.shippingPattern.test(evidence);
  const pickup = retailer.pickupPattern.test(evidence);
  if (shipping !== pickup) return shipping ? "shipping" : "pickup";
  return control && retailer.defaultShipping ? "shipping" : "unknown";
}

const ADD_CONTROL_INTENT = /\b(?:add|pre[ -]?order)(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)\b|\batc\b/i;
const GENERIC_ADD_CONTROL_INTENT = /\b(?:add|pre[ -]?order)(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)\b|\bpre[ -]?order(?:\s+now)?\b|\batc\b/i;
const MERCHANDISING_CONTROL_SCOPE = "[data-testid*='recommend' i], [data-automation-id*='recommend' i], [aria-label*='similar' i], [aria-label*='sponsored' i], [class*='carousel' i], [class*='related-products' i]";

function controlIntent(element: Element): string {
  return [
    element.getAttribute("aria-label"),
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test-id"),
    element.getAttribute("data-automation-id"),
    element.getAttribute("data-button-state"),
    element.getAttribute("value"),
    text(element, 300)
  ].filter(Boolean).join(" ");
}

function merchandisingControl(element: Element): boolean {
  return Boolean(element.closest(MERCHANDISING_CONTROL_SCOPE));
}

function candidateControls(root: ParentNode, retailer: RetailerObserverConfig): Element[] {
  const candidates = retailer.addSelectors.flatMap((selector) => [...root.querySelectorAll(selector)]);
  const intentPattern = retailer.addIntentPattern ?? ADD_CONTROL_INTENT;
  return [...new Set(candidates)].filter((element) => visible(element)
    && intentPattern.test(controlIntent(element))
    && !merchandisingControl(element));
}

function genericAddIntentControls(root: ParentNode): Element[] {
  return [...root.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")]
    .filter((element) => visible(element)
      && GENERIC_ADD_CONTROL_INTENT.test(controlIntent(element))
      && !merchandisingControl(element));
}

interface SelectedRetailerControl {
  control: Element | null;
  fulfillment: "shipping" | "pickup" | "unknown";
  offerRoot: Element | null;
}

interface WalmartScopedControl extends SelectedRetailerControl {
  control: Element;
  offerRoot: Element;
  identityBound: boolean;
  primaryScope: boolean;
}

interface AmazonScopedControl extends SelectedRetailerControl {
  control: Element;
  offerRoot: Element;
  offerListingId: string;
}

interface BestBuyScopedControl extends SelectedRetailerControl {
  control: Element;
  offerRoot: Element;
}

const WALMART_PRIMARY_SCOPE = [
  "[data-testid*='buy-box' i]",
  "[data-automation-id*='buy-box' i]",
  "[data-testid*='purchase' i]",
  "[data-automation-id*='purchase' i]",
  "[data-testid*='add-to-cart-section' i]"
].join(", ");

const WALMART_MERCHANDISING_SCOPE = [
  "[data-testid*='recommend' i]",
  "[data-automation-id*='recommend' i]",
  "[aria-label*='similar' i]",
  "[aria-label*='sponsored' i]",
  "[data-testid*='sponsored' i]",
  "[class*='carousel' i]",
  "[class*='related-products' i]"
].join(", ");

const AMAZON_MERCHANDISING_SCOPE = [
  "[data-cel-widget*='recommend' i]",
  "[data-feature-name*='recommend' i]",
  "[aria-label*='sponsored' i]",
  "[class*='carousel' i]",
  "#similarities_feature_div",
  "#sp_detail"
].join(", ");

const BESTBUY_PRIMARY_SCOPE = [
  "[data-testid*='buy-box' i]",
  "[data-testid*='fulfillment' i]",
  "[data-testid*='purchase' i]",
  "[class*='fulfillment-add-to-cart' i]",
  "[class*='buy-box' i]",
  "[class*='purchase' i]"
].join(", ");

const BESTBUY_MERCHANDISING_SCOPE = [
  "[data-testid*='recommend' i]",
  "[aria-label*='similar' i]",
  "[aria-label*='sponsored' i]",
  "[class*='carousel' i]",
  "[class*='related-products' i]",
  "[class*='recommend' i]"
].join(", ");

const AMAZON_CANONICAL_OFFER_INPUT_SELECTOR = [
  "input[name='offerListingID']",
  "input[name='offerListingId']",
  "input[name='items[0.base][offerListingID]']",
  "input[name='items[0.base][offerListingId]']"
].join(", ");

const AMAZON_ALTERNATE_OFFER_INPUT_SELECTOR = "input[name='offeringID.1']";

const AMAZON_EXPLICIT_ASIN_SELECTOR = [
  "input[name='ASIN']",
  "input[name='asin']",
  "input[name='items[0.base][asin]']"
].join(", ");

function amazonOfferDisplayField(
  root: ParentNode,
  kind: "merchant" | "fulfiller"
): { label: string; value: string } | null {
  const featureName = kind === "merchant" ? "merchantInfoFeature" : "fulfillerInfoFeature";
  const desktopName = kind === "merchant" ? "desktop-merchant-info" : "desktop-fulfiller-info";
  const features = [...root.querySelectorAll(
    `#${featureName}_feature_div, [data-feature-name='${featureName}']`
  )].filter(visible);
  for (const feature of features) {
    const label = text(queryVisible(feature, [
      `.offer-display-feature-label[offer-display-feature-name='${desktopName}']`,
      `[data-csa-c-slot-id='odf-feature-label-${desktopName}']`
    ]), 300);
    const value = text(queryVisible(feature, [
      `.offer-display-feature-text[offer-display-feature-name='${desktopName}'] .offer-display-feature-text-message`,
      `[data-csa-c-slot-id='odf-feature-text-${desktopName}'] .offer-display-feature-text-message`,
      `.offer-display-feature-text[offer-display-feature-name='${desktopName}']`
    ]), 160);
    if (label && value) return { label, value };
  }
  return null;
}

function amazonOfferDisplaySeller(root: ParentNode): { sellerName: string; sellerType: SellerType } | null {
  const merchant = amazonOfferDisplayField(root, "merchant");
  if (!merchant) return null;
  if (/^shipper\s*\/\s*seller$/i.test(merchant.label)) {
    return /^amazon(?:\.com)?$/i.test(merchant.value)
      ? { sellerName: CONFIGS.amazon.firstPartyName, sellerType: "first_party" }
      : { sellerName: merchant.value, sellerType: "third_party" };
  }
  if (!/^sold\s+by$/i.test(merchant.label)) return null;
  if (!/^amazon(?:\.com)?$/i.test(merchant.value)) {
    return { sellerName: merchant.value, sellerType: "third_party" };
  }
  const fulfiller = amazonOfferDisplayField(root, "fulfiller");
  const amazonShips = fulfiller
    && /^ships?\s+from$/i.test(fulfiller.label)
    && /^amazon(?:\.com)?$/i.test(fulfiller.value);
  return amazonShips
    ? { sellerName: CONFIGS.amazon.firstPartyName, sellerType: "first_party" }
    : { sellerName: CONFIGS.amazon.firstPartyName, sellerType: "unknown" };
}

function amazonAsinEvidence(root: Element): Set<string> {
  const explicit = new Set<string>();
  const explicitElements = [
    ...(root.matches(AMAZON_EXPLICIT_ASIN_SELECTOR) ? [root] : []),
    ...root.querySelectorAll(AMAZON_EXPLICIT_ASIN_SELECTOR)
  ];
  for (const element of explicitElements) {
    const candidate = String(
      (element as HTMLInputElement).value ?? ""
    ).toUpperCase();
    if (CONFIGS.amazon.skuPattern.test(candidate)) explicit.add(candidate);
  }
  // Explicit form fields are the checkout identity. Variation swatches often
  // carry many data-asin values inside that same form and must not make the
  // selected offer look ambiguous.
  if (explicit.size > 0) return explicit;

  const asins = new Set<string>();
  for (const element of [root, ...root.querySelectorAll("[data-asin]")]) {
    const candidate = String(element.getAttribute("data-asin") || "").toUpperCase();
    if (CONFIGS.amazon.skuPattern.test(candidate)) asins.add(candidate);
  }
  return asins;
}

function amazonOfferIds(root: Element): Set<string> {
  const collect = (selector: string): Set<string> => {
    const offers = new Set<string>();
    for (const input of root.querySelectorAll(selector)) {
      const offer = cleanAmazonOfferId((input as HTMLInputElement).value);
      if (offer) offers.add(offer);
    }
    return offers;
  };
  const canonical = collect(AMAZON_CANONICAL_OFFER_INPUT_SELECTOR);
  if (canonical.size > 0) return canonical;
  const offers = new Set<string>();
  for (const input of root.querySelectorAll(AMAZON_ALTERNATE_OFFER_INPUT_SELECTOR)) {
    const offer = cleanAmazonOfferId((input as HTMLInputElement).value);
    if (offer) offers.add(offer);
  }
  return offers;
}

function boundedCount(value: number): number {
  return Math.max(0, Math.min(50, Math.trunc(value)));
}

function visibleSelectorCount(root: ParentNode, selector: string): number {
  return boundedCount([...root.querySelectorAll(selector)].filter((element) => element.tagName === "META" || visible(element)).length);
}

function fulfillmentShape(root: Element | Document): RetailerAdapterLayoutEvidence["fulfillmentShape"] {
  const evidence = observableText(root, 30_000);
  const shipping = /\bships?\s+from\b|\bshipper\b|\bshipping\b|\bdeliver(?:y|ies|ed|ing)?\b/i.test(evidence);
  const pickup = /\bpick[ -]?up\b/i.test(evidence);
  return shipping && pickup ? "mixed" : shipping ? "shipping" : pickup ? "pickup" : "none";
}

function amazonScopeKind(control: Element | null): RetailerAdapterLayoutEvidence["scopeKind"] {
  if (!control) return "none";
  if (control.closest("[id^='newAccordionRow_'], [data-a-accordion-row-name], .a-accordion-active")) return "accordion";
  if (control.closest("#qualifiedBuybox, #desktop_qualifiedBuyBox, [data-feature-name*='qualifiedBuyBox' i]")) return "qualified_buybox";
  if (control.closest("#buybox, #desktop_buybox, [data-feature-name='buybox']")) return "buybox";
  if (control.closest("form")) return "form";
  return "other";
}

function amazonSellerShape(root: ParentNode): RetailerAdapterLayoutEvidence["sellerShape"] {
  const merchant = amazonOfferDisplayField(root, "merchant");
  if (merchant && /^shipper\s*\/\s*seller$/i.test(merchant.label)) return "offer_display_combined";
  if (merchant && /^sold\s+by$/i.test(merchant.label)) return "offer_display_split";
  return queryVisible(root, CONFIGS.amazon.sellerSelectors) ? "legacy" : "none";
}

function amazonLayoutEvidence(
  document: Document,
  urlValue: string,
  expectedSku: string
): RetailerAdapterLayoutEvidence {
  const retailer = CONFIGS.amazon;
  const pageSku = extractRetailerSku("amazon", urlValue);
  const controls = candidateControls(document, retailer);
  const control = controls.length === 1 ? controls[0] ?? null : null;
  const selected = pageSku === expectedSku
    ? selectedAmazonControl(document, retailer, expectedSku, "either")
    : { control: null, fulfillment: "unknown" as const, offerRoot: null };
  const form = control?.closest("form") || null;
  const buybox = control?.closest("#buybox, #desktop_buybox, [data-feature-name='buybox']") || null;
  const identityRoot: ParentNode = form || buybox || document;
  const evidenceRoot: Element | Document = selected.offerRoot || form || buybox || document;
  const explicitSkuInputs = [...identityRoot.querySelectorAll(AMAZON_EXPLICIT_ASIN_SELECTOR)];
  const exactSkuInputs = explicitSkuInputs.filter((element) => String((element as HTMLInputElement).value || "").toUpperCase() === expectedSku);
  const variationSkus = new Set(
    [...identityRoot.querySelectorAll("[data-asin]")]
      .map((element) => String(element.getAttribute("data-asin") || "").toUpperCase())
      .filter((value) => CONFIGS.amazon.skuPattern.test(value))
  );
  const canonicalInputs = [...identityRoot.querySelectorAll(AMAZON_CANONICAL_OFFER_INPUT_SELECTOR)];
  const canonicalOffers = new Set(canonicalInputs.map((element) => cleanAmazonOfferId((element as HTMLInputElement).value)).filter(Boolean));
  const alternateInputs = [...identityRoot.querySelectorAll(AMAZON_ALTERNATE_OFFER_INPUT_SELECTOR)];
  const alternateOffers = new Set(alternateInputs.map((element) => cleanAmazonOfferId((element as HTMLInputElement).value)).filter(Boolean));
  const scopedControlCount = pageSku === expectedSku
    ? controls.map((candidate) => amazonOfferScope(candidate, retailer, expectedSku)).filter(Boolean).length
    : 0;
  return {
    schemaVersion: 1,
    pageKind: pageSku ? "product" : "other",
    scopeKind: amazonScopeKind(control),
    sellerShape: amazonSellerShape(evidenceRoot),
    fulfillmentShape: fulfillmentShape(evidenceRoot),
    addControlCount: boundedCount(controls.length),
    genericAddIntentCount: boundedCount(genericAddIntentControls(document).length),
    scopedControlCount: boundedCount(scopedControlCount),
    explicitSkuInputCount: boundedCount(explicitSkuInputs.length),
    exactSkuInputCount: boundedCount(exactSkuInputs.length),
    variationSkuCount: boundedCount(variationSkus.size),
    canonicalOfferInputCount: boundedCount(canonicalInputs.length),
    canonicalOfferDistinctCount: boundedCount(canonicalOffers.size),
    alternateOfferInputCount: boundedCount(alternateInputs.length),
    alternateOfferDistinctCount: boundedCount(alternateOffers.size),
    priceCandidateCount: visibleSelectorCount(evidenceRoot, retailer.priceSelectors.join(", ")),
    quantityControlCount: visibleSelectorCount(
      evidenceRoot,
      "select#quantity, select[name='quantity'], input[name='quantity'], input[name='items[0.base][quantity]']"
    ),
    securityChallenge: retailerSecurityChallenge(document),
    interactiveBlock: retailerInteractiveBlock(document, urlValue)
  };
}

export function retailerAdapterLayoutEvidence(
  document: Document,
  urlValue: string,
  retailerId: Exclude<SupportedRetailerId, "target">,
  expectedSku: string
): RetailerAdapterLayoutEvidence {
  if (retailerId === "amazon") return amazonLayoutEvidence(document, urlValue, expectedSku);
  const retailer = CONFIGS[retailerId];
  const pageSku = extractRetailerSku(retailerId, urlValue);
  const controls = candidateControls(document, retailer);
  const control = controls.length === 1 ? controls[0] ?? null : null;
  const selected = pageSku === expectedSku
    ? selectedControl(document, retailer, "either", expectedSku)
    : { control: null, fulfillment: "unknown" as const, offerRoot: null };
  const root: Element | Document = selected.offerRoot || control?.closest("form, main") || document;
  return {
    schemaVersion: 1,
    pageKind: pageSku ? "product" : "other",
    scopeKind: control?.closest("form") ? "form"
      : retailerId === "bestbuy" && selected.offerRoot ? "buybox"
        : control ? "other" : "none",
    sellerShape: queryVisible(root, retailer.sellerSelectors)
      || (retailerId === "bestbuy" && selected.offerRoot && bestBuySellerBound(selected.offerRoot, retailer))
      ? "legacy" : "none",
    fulfillmentShape: fulfillmentShape(root),
    addControlCount: boundedCount(controls.length),
    genericAddIntentCount: boundedCount(genericAddIntentControls(document).length),
    scopedControlCount: selected.control ? 1 : 0,
    explicitSkuInputCount: 0,
    exactSkuInputCount: 0,
    variationSkuCount: 0,
    canonicalOfferInputCount: 0,
    canonicalOfferDistinctCount: 0,
    alternateOfferInputCount: 0,
    alternateOfferDistinctCount: 0,
    priceCandidateCount: visibleSelectorCount(root, retailer.priceSelectors.join(", ")),
    quantityControlCount: visibleSelectorCount(root, "select[name='quantity'], input[name='quantity']"),
    securityChallenge: retailerSecurityChallenge(document),
    interactiveBlock: retailerInteractiveBlock(document, urlValue)
  };
}

function amazonSellerBound(root: Element, retailer: RetailerObserverConfig): boolean {
  if (amazonOfferDisplaySeller(root)) return true;
  const sellerText = text(queryVisible(root, retailer.sellerSelectors), 2_000) || text(root, 30_000);
  return retailer.firstPartyPattern.test(sellerText) || retailer.marketplacePattern.test(sellerText);
}

function amazonFulfillment(root: Element): "shipping" | "pickup" | "unknown" {
  const evidence = observableText(root, 30_000);
  const shipping = /\bships?\s+from\b|\bshipper\b|\bshipping\b|\bdeliver(?:y|ies|ed|ing)?\b/i.test(evidence);
  const pickup = /\bpick[ -]?up\b/i.test(evidence);
  return shipping !== pickup ? shipping ? "shipping" : "pickup" : "unknown";
}

function amazonQuantityOne(root: Element): boolean {
  const controls = [...root.querySelectorAll(
    "select#quantity, select[name='quantity'], input[name='quantity'], input[name='items[0.base][quantity]']"
  )].filter((element) => element.tagName === "INPUT" || visible(element));
  if (!controls.length) return true;
  return controls.every((control) => {
    const value = String((control as HTMLInputElement | HTMLSelectElement).value || "").trim();
    return value === "1";
  });
}

function amazonOfferScope(
  control: Element,
  retailer: RetailerObserverConfig,
  expectedSku: string
): AmazonScopedControl | null {
  if (control.closest(AMAZON_MERCHANDISING_SCOPE)) return null;
  const roots: Element[] = [];
  const exactForm = control.closest("form");
  if (exactForm) roots.push(exactForm);
  let current = control.parentElement;
  for (let depth = 0; depth < 14 && current; depth += 1) {
    if (["MAIN", "BODY", "HTML"].includes(current.tagName)) break;
    if (!roots.includes(current)) roots.push(current);
    current = current.parentElement;
  }
  for (const root of roots) {
    const controls = candidateControls(root, retailer);
    const asins = amazonAsinEvidence(root);
    const offers = amazonOfferIds(root);
    const price = readPrice(root, retailer.priceSelectors);
    const fulfillment = amazonFulfillment(root);
    if (controls.length === 1 && controls[0] === control
      && asins.size === 1 && asins.has(expectedSku)
      && offers.size === 1 && price !== null
      && fulfillment !== "unknown" && amazonSellerBound(root, retailer)) {
      return {
        control,
        fulfillment,
        offerRoot: root,
        offerListingId: [...offers][0] ?? ""
      };
    }
  }
  return null;
}

function selectedAmazonControl(
  document: Document,
  retailer: RetailerObserverConfig,
  expectedSku: string,
  requiredFulfillment: Fulfillment
): SelectedRetailerControl {
  const scoped = candidateControls(document, retailer)
    .map((control) => amazonOfferScope(control, retailer, expectedSku))
    .filter((candidate): candidate is AmazonScopedControl => Boolean(candidate));
  const matching = scoped.filter((candidate) => requiredFulfillment === "either"
    ? ["shipping", "pickup"].includes(candidate.fulfillment)
    : candidate.fulfillment === requiredFulfillment);
  return matching.length === 1 && matching[0]
    ? matching[0]
    : { control: null, fulfillment: "unknown", offerRoot: null };
}

function walmartSkuEvidence(root: Element): Set<string> {
  const skus = new Set<string>();
  for (const element of [root, ...root.querySelectorAll("[data-us-item-id], [data-item-id], [data-product-id]")]) {
    for (const name of ["data-us-item-id", "data-item-id", "data-product-id"]) {
      const candidate = String(element.getAttribute(name) || "");
      if (CONFIGS.walmart.skuPattern.test(candidate)) skus.add(candidate);
    }
  }
  for (const anchor of root.querySelectorAll("a[href]")) {
    let href = "";
    try { href = new URL(anchor.getAttribute("href") || "", root.ownerDocument.baseURI || "https://www.walmart.com").href; } catch { href = ""; }
    const sku = extractRetailerSku("walmart", href);
    if (sku) skus.add(sku);
  }
  return skus;
}

function walmartSellerBound(root: Element, retailer: RetailerObserverConfig): boolean {
  if (queryVisible(root, retailer.sellerSelectors)) return true;
  const scopedText = text(root, 30_000);
  return retailer.firstPartyPattern.test(scopedText) || retailer.marketplacePattern.test(scopedText);
}

function walmartOfferScope(
  control: Element,
  retailer: RetailerObserverConfig,
  expectedSku: string
): WalmartScopedControl | null {
  if (control.closest(WALMART_MERCHANDISING_SCOPE)) return null;
  const primaryScope = Boolean(control.closest(WALMART_PRIMARY_SCOPE));
  let current = control.parentElement;
  for (let depth = 0; depth < 14 && current; depth += 1) {
    if (["MAIN", "BODY", "HTML"].includes(current.tagName)) break;
    const controls = candidateControls(current, retailer);
    const price = readPrice(current, retailer.priceSelectors);
    const fulfillment = fulfillmentEvidence(current, control, retailer);
    if (controls.length === 1 && controls[0] === control && price !== null
      && fulfillment !== "unknown" && walmartSellerBound(current, retailer)) {
      const skus = walmartSkuEvidence(current);
      if ([...skus].some((sku) => sku !== expectedSku)) return null;
      return {
        control,
        fulfillment,
        offerRoot: current,
        identityBound: skus.has(expectedSku),
        primaryScope
      };
    }
    current = current.parentElement;
  }
  return null;
}

function selectedWalmartControl(
  document: Document,
  retailer: RetailerObserverConfig,
  expectedSku: string,
  requiredFulfillment: Fulfillment
): SelectedRetailerControl {
  const scoped = candidateControls(document, retailer)
    .map((control) => walmartOfferScope(control, retailer, expectedSku))
    .filter((candidate): candidate is WalmartScopedControl => Boolean(candidate));
  const exact = scoped.filter((candidate) => candidate.identityBound);
  const primary = scoped.filter((candidate) => candidate.primaryScope);
  const pool = exact.length > 0 ? exact : primary.length > 0 ? primary : scoped;
  const matching = pool.filter((candidate) => requiredFulfillment === "either"
    ? ["shipping", "pickup"].includes(candidate.fulfillment)
    : candidate.fulfillment === requiredFulfillment);
  const selected = matching.length === 1 ? matching[0] : pool.length === 1 ? pool[0] : null;
  return selected || { control: null, fulfillment: "unknown", offerRoot: null };
}

function bestBuySkuEvidence(root: Element): Set<string> {
  const skus = new Set<string>();
  const add = (value: unknown): void => {
    const candidate = String(value || "").trim();
    if (CONFIGS.bestbuy.skuPattern.test(candidate)) skus.add(candidate);
  };
  for (const element of [root, ...root.querySelectorAll(
    "[data-sku-id], [data-sku], [data-product-id], input[name*='sku' i]"
  )]) {
    add(element.getAttribute("data-sku-id"));
    add(element.getAttribute("data-sku"));
    add(element.getAttribute("data-product-id"));
    if (element.tagName === "INPUT") add((element as HTMLInputElement).value);
  }
  for (const anchor of root.querySelectorAll("a[href]")) {
    let href = "";
    try { href = new URL(anchor.getAttribute("href") || "", root.ownerDocument.baseURI || "https://www.bestbuy.com").href; } catch { href = ""; }
    add(extractRetailerSku("bestbuy", href));
  }
  for (const match of observableText(root, 40_000).matchAll(/\bSKU\s*:?\s*(\d{5,20})\b/gi)) add(match[1]);
  return skus;
}

function bestBuySellerBound(root: Element, retailer: RetailerObserverConfig): boolean {
  const seller = queryVisible(root, retailer.sellerSelectors);
  const evidence = `${sellerElementText(seller, 2_000)} ${observableText(root, 30_000)}`.trim();
  return retailer.firstPartyPattern.test(evidence) || retailer.marketplacePattern.test(evidence);
}

function bestBuyFulfillment(root: Element, control: Element): "shipping" | "pickup" | "unknown" {
  const evidenceFor = (element: Element): string => {
    const scope = element.closest(
      "label, [role='tab'], [role='radio'], [data-testid*='fulfillment' i], [data-automation-id*='fulfillment' i], [class*='fulfillment' i]"
    ) || element;
    return [
      scope.getAttribute("aria-label"),
      scope.getAttribute("data-testid"),
      scope.getAttribute("data-automation-id"),
      scope.getAttribute("data-fulfillment"),
      scope.getAttribute("data-fulfillment-type"),
      observableText(scope, 2_000)
    ].filter(Boolean).join(" ");
  };
  const selected = [...root.querySelectorAll(
    "[aria-selected='true'], [aria-checked='true'], [data-selected='true'], [data-state='selected'], input:checked"
  )].filter(visible).map(evidenceFor);
  const selectedShipping = selected.some((value) => CONFIGS.bestbuy.shippingPattern.test(value));
  const selectedPickup = selected.some((value) => CONFIGS.bestbuy.pickupPattern.test(value));
  if (selectedShipping !== selectedPickup) return selectedShipping ? "shipping" : "pickup";

  const directScope = control.closest(
    "[data-fulfillment], [data-fulfillment-type], [data-testid*='shipping' i], [data-testid*='pickup' i], [class*='shipping-option' i], [class*='pickup-option' i]"
  );
  if (directScope && root.contains(directScope)) {
    const evidence = evidenceFor(directScope);
    const shipping = CONFIGS.bestbuy.shippingPattern.test(evidence);
    const pickup = CONFIGS.bestbuy.pickupPattern.test(evidence);
    if (shipping !== pickup) return shipping ? "shipping" : "pickup";
  }
  return "unknown";
}

function bestBuyQuantityOne(root: Element): boolean {
  const controls = [...root.querySelectorAll(
    "select[name*='quantity' i], select[aria-label*='quantity' i], input[name*='quantity' i], input[aria-label*='quantity' i]"
  )].filter((element) => element.tagName === "INPUT" || visible(element));
  if (!controls.length) return true;
  return controls.every((control) => String((control as HTMLInputElement | HTMLSelectElement).value || "").trim() === "1");
}

function bestBuyOfferScope(
  control: Element,
  retailer: RetailerObserverConfig,
  expectedSku: string
): BestBuyScopedControl | null {
  if (control.closest(BESTBUY_MERCHANDISING_SCOPE)) return null;
  const roots: Element[] = [];
  const primary = control.closest(BESTBUY_PRIMARY_SCOPE);
  const form = control.closest("form");
  if (primary) roots.push(primary);
  if (form && !roots.includes(form)) roots.push(form);
  let current = control.parentElement;
  for (let depth = 0; depth < 14 && current; depth += 1) {
    if (["MAIN", "BODY", "HTML"].includes(current.tagName)) break;
    if (!roots.includes(current)) roots.push(current);
    current = current.parentElement;
  }
  for (const root of roots) {
    const controls = candidateControls(root, retailer);
    if (controls.length !== 1 || controls[0] !== control) continue;
    if (readPrice(root, retailer.priceSelectors) === null || !bestBuySellerBound(root, retailer)) continue;
    const fulfillment = bestBuyFulfillment(root, control);
    if (fulfillment === "unknown" || !bestBuyQuantityOne(root)) continue;
    const skus = bestBuySkuEvidence(root);
    if (skus.size > 0 && (skus.size !== 1 || !skus.has(expectedSku))) continue;
    return { control, fulfillment, offerRoot: root };
  }
  return null;
}

function selectedBestBuyControl(
  document: Document,
  retailer: RetailerObserverConfig,
  expectedSku: string,
  requiredFulfillment: Fulfillment
): SelectedRetailerControl {
  const scoped = candidateControls(document, retailer)
    .map((control) => bestBuyOfferScope(control, retailer, expectedSku))
    .filter((candidate): candidate is BestBuyScopedControl => Boolean(candidate));
  const matching = scoped.filter((candidate) => requiredFulfillment === "either"
    ? candidate.fulfillment === "shipping" || candidate.fulfillment === "pickup"
    : candidate.fulfillment === requiredFulfillment);
  return matching.length === 1 && matching[0]
    ? matching[0]
    : { control: null, fulfillment: "unknown", offerRoot: null };
}

function selectedControl(
  document: Document,
  retailer: RetailerObserverConfig,
  requiredFulfillment: Fulfillment,
  expectedSku = ""
): SelectedRetailerControl {
  if (retailer.retailerId === "walmart" && CONFIGS.walmart.skuPattern.test(expectedSku)) {
    return selectedWalmartControl(document, retailer, expectedSku, requiredFulfillment);
  }
  if (retailer.retailerId === "amazon" && CONFIGS.amazon.skuPattern.test(expectedSku)) {
    return selectedAmazonControl(document, retailer, expectedSku, requiredFulfillment);
  }
  if (retailer.retailerId === "bestbuy" && CONFIGS.bestbuy.skuPattern.test(expectedSku)) {
    return selectedBestBuyControl(document, retailer, expectedSku, requiredFulfillment);
  }
  const candidates = candidateControls(document, retailer)
    .map((control) => ({ control, fulfillment: fulfillmentEvidence(document, control, retailer) }));
  const matching = candidates.filter((candidate) => requiredFulfillment === "either"
    ? ["shipping", "pickup"].includes(candidate.fulfillment)
    : candidate.fulfillment === requiredFulfillment);
  const selected = matching.length === 1 && matching[0]
    ? matching[0]
    : { control: null, fulfillment: "unknown" as const };
  return { ...selected, offerRoot: null };
}

export function retailerAddControl(
  document: Document,
  urlValue: string,
  retailerId: Exclude<SupportedRetailerId, "target">,
  expectedSku: string,
  requiredFulfillment: Fulfillment
): Element | null {
  const retailer = CONFIGS[retailerId];
  if (extractRetailerSku(retailerId, urlValue) !== expectedSku) return null;
  const selected = selectedControl(document, retailer, requiredFulfillment, expectedSku);
  const fulfillmentAllowed = requiredFulfillment === "either"
    ? selected.fulfillment === "shipping" || selected.fulfillment === "pickup"
    : selected.fulfillment === requiredFulfillment;
  return fulfillmentAllowed && actionable(selected.control) ? selected.control : null;
}

export function amazonOfferBinding(
  document: Document,
  urlValue: string,
  expectedAsin: string,
  requiredFulfillment: Fulfillment = "shipping"
): { control: Element; offerListingId: string } | null {
  if (extractRetailerSku("amazon", urlValue) !== expectedAsin) return null;
  const selected = selectedAmazonControl(document, CONFIGS.amazon, expectedAsin, requiredFulfillment);
  if (!actionable(selected.control) || !selected.offerRoot) return null;
  const quantityScope = selected.control.closest("#buybox, #desktop_buybox, [data-feature-name='buybox']")
    || selected.control.closest("form")
    || selected.offerRoot;
  if (!amazonQuantityOne(quantityScope)) return null;
  const offers = amazonOfferIds(selected.offerRoot);
  if (offers.size !== 1) return null;
  return { control: selected.control, offerListingId: [...offers][0] ?? "" };
}

export function observeRetailerOffer(
  document: Document,
  urlValue: string,
  retailerId: Exclude<SupportedRetailerId, "target">,
  expectedSku: string,
  requiredFulfillment: Fulfillment = "either",
  observedAt = new Date().toISOString()
): LiveOfferObservation {
  const retailer = CONFIGS[retailerId];
  const pageSku = extractRetailerSku(retailerId, urlValue);
  const blocked = retailerInteractiveBlock(document, urlValue);
  const selected = pageSku === expectedSku
    ? selectedControl(document, retailer, requiredFulfillment, expectedSku)
    : { control: null, fulfillment: "unknown" as const, offerRoot: null };
  const seller = blocked
    ? { sellerName: "", sellerType: "unknown" as const }
    : sellerEvidence(document, selected.control, retailer, selected.offerRoot);
  const priceRoot = selected.offerRoot
    || selected.control?.closest("form, [data-testid*='buy-box' i], [data-automation-id*='buy-box' i], #buybox, main")
    || null;
  const unitPriceCents = !blocked && priceRoot
    ? readPrice(priceRoot, retailer.priceSelectors) ?? readPrice(document, retailer.priceSelectors)
    : null;
  const canAdd = pageSku === expectedSku && actionable(selected.control) && !blocked;
  const controlText = text(selected.control, 300);
  const availability = blocked
    ? "unknown"
    : canAdd ? /pre[ -]?order/i.test(controlText) ? "preorder" : "in_stock" : "out_of_stock";
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    url: urlValue,
    pageKind: pageSku ? "product" : "other",
    retailerId,
    retailerSku: pageSku,
    availability,
    unitPriceCents,
    currency: "USD",
    sellerName: seller.sellerName,
    sellerType: seller.sellerType,
    fulfillment: blocked ? "unknown" : selected.fulfillment,
    addControlActionable: canAdd,
    securityChallenge: retailerSecurityChallenge(document),
    interactiveBlock: blocked
  };
}

export function observeRetailerSelectedOfferScope(
  document: Document,
  urlValue: string,
  retailerId: Exclude<SupportedRetailerId, "target">,
  expectedSku: string,
  requiredFulfillment: Fulfillment = "either"
) {
  const pageSku = extractRetailerSku(retailerId, urlValue);
  if (!pageSku || pageSku !== expectedSku) throw new Error("The exact retailer listing identity is unavailable.");
  const selected = selectedControl(document, CONFIGS[retailerId], requiredFulfillment, expectedSku);
  return selectedOfferScope(
    document,
    retailerId,
    pageSku,
    selected.offerRoot || selected.control?.closest("form, main") || document
  );
}

function cleanAmazonOfferId(value: unknown): string {
  const candidate = String(value ?? "").replace(/^`+|`+$/g, "").trim();
  return candidate && candidate.length <= 2_048 && !/[`\u0000-\u001f\u007f]/.test(candidate) ? candidate : "";
}

export function extractAmazonOfferListingId(document: Document, expectedAsin: string): string {
  const asin = String(expectedAsin || "").toUpperCase();
  if (!CONFIGS.amazon.skuPattern.test(asin)) return "";
  const binding = amazonOfferBinding(document, document.URL || document.baseURI, asin, "shipping");
  return binding?.offerListingId ?? "";
}

export function buildAmazonBuyNowUrl(input: {
  asin: string;
  offerListingId: string;
  quantity: number;
  associateTag?: string;
}): string {
  const asin = String(input.asin || "").toUpperCase();
  const offerListingId = cleanAmazonOfferId(input.offerListingId);
  const quantity = Number(input.quantity);
  const associateTag = String(input.associateTag || "");
  if (!CONFIGS.amazon.skuPattern.test(asin) || !offerListingId) throw new Error("An exact Amazon ASIN and live offer ID are required.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) throw new Error("Amazon Buy Now quantity must be 1 through 5.");
  if (associateTag && !/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(associateTag)) throw new Error("The Amazon Associate tag is invalid.");
  const url = new URL("https://www.amazon.com/checkout/entry/buynow");
  url.searchParams.set("items[0.base][asin]", asin);
  url.searchParams.set("ASIN", asin);
  url.searchParams.set("offerListingID", offerListingId);
  url.searchParams.set("items[0.base][quantity]", String(quantity));
  url.searchParams.set("quantity", String(quantity));
  url.searchParams.set("clientName", "OffersX_OfferDisplay_DetailPage");
  url.searchParams.set("pipelineType", "Chewbacca");
  url.searchParams.set("isBuyNow", "1");
  url.searchParams.set("isEligibilityLogicDisabled", "1");
  url.searchParams.set("submit.buy-now", "Submit");
  url.searchParams.set("referrer", "detail");
  url.searchParams.set("ref_", "dp_start-bbf_1_glance_chw");
  if (associateTag) url.searchParams.set("tag", associateTag);
  return url.href;
}

export function retailerObserverVersion(retailerId: SupportedRetailerId): RetailerObserverVersion {
  return RETAILER_OBSERVER_VERSIONS[retailerId];
}
