import { exactRetailerProductLink, type ExactRetailerProductLink } from "./attribution.js";

/**
 * The store item a link in a chat message names. Restock servers post more
 * than product pages (Kevin, 2026-10-13: "the various types of discord
 * signals"): add-to-cart links, affiliate redirects that carry the store link
 * inside them, and short links. This reads every one that names exactly one
 * store item without opening it; a short link has to be followed first
 * (see isShortStoreLink), which this never does.
 */

const AMAZON_ITEM = /^[A-Z0-9]{10}$/;
const NUMERIC_ITEM = /^\d{5,20}$/;
const MAX_WRAPPER_DEPTH = 3;

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim().replace(/^http:\/\//i, "https://"));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function itemPage(template: string, retailerSku: string): ExactRetailerProductLink | null {
  return exactRetailerProductLink(template.replace("{sku}", retailerSku)) ?? null;
}

/** Add-to-cart and other single-item store links that aren't the product page. */
function storeCartLink(url: URL): ExactRetailerProductLink | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  if (onDomain(host, "amazon.com") || host === "amzn.com" || host === "www.amzn.com") {
    // amazon.com/gp/aws/cart/add.html?ASIN.1=B0…&Quantity.1=1 (one item only).
    if (/^\/gp\/aws\/cart\/add(?:\.html)?$/i.test(path)) {
      const asin = (url.searchParams.get("ASIN.1") ?? "").toUpperCase();
      return AMAZON_ITEM.test(asin) && !url.searchParams.has("ASIN.2")
        ? itemPage("https://www.amazon.com/dp/{sku}", asin) : null;
    }
    const asin = (path.match(/^\/(?:gp\/offer-listing|exec\/obidos\/ASIN|gp\/aw\/ol)\/([A-Z0-9]{10})$/i)?.[1]
      ?? (host.endsWith("amzn.com") ? path.match(/^\/(?:dp\/)?([A-Z0-9]{10})$/i)?.[1] : undefined) ?? "").toUpperCase();
    return AMAZON_ITEM.test(asin) ? itemPage("https://www.amazon.com/dp/{sku}", asin) : null;
  }
  if (onDomain(host, "walmart.com")) {
    // walmart.com/cart?items=123, affil.walmart.com/cart/addToCart?items=123|1, …/cart/buynow?items=123:1
    if (/^\/cart(?:\/(?:addToCart|buynow|add-to-cart))?$/i.test(path)) {
      const items = (url.searchParams.get("items") ?? url.searchParams.get("item") ?? "").split(",").filter(Boolean);
      const item = items.length === 1 ? items[0]!.split(/[|:]/)[0] ?? "" : "";
      return NUMERIC_ITEM.test(item) ? itemPage("https://www.walmart.com/ip/{sku}", item) : null;
    }
    return null;
  }
  if (onDomain(host, "bestbuy.com")) {
    // api.bestbuy.com/click/-/6601524/cart and /pdp; bestbuy.com/site/6601524.p
    const sku = path.match(/^\/click\/[^/]+\/(\d{5,20})\/(?:cart|pdp)$/i)?.[1]
      ?? path.match(/^\/site\/(\d{5,20})\.p$/i)?.[1]
      ?? (/^\/cart$/i.test(path) ? url.searchParams.get("skuId") ?? "" : "");
    return NUMERIC_ITEM.test(sku) ? itemPage("https://www.bestbuy.com/site/-/{sku}.p", sku) : null;
  }
  return null;
}

/** Links carried inside an affiliate or tracking redirect: in a query value or after the path. */
function wrappedLinks(url: URL): string[] {
  const found: string[] = [];
  for (const value of url.searchParams.values()) {
    if (/^https?:\/\//i.test(value)) found.push(value);
    else if (/^https?%3A/i.test(value)) {
      // Encoded twice: the redirect's own redirect.
      try {
        found.push(decodeURIComponent(value));
      } catch {
        // A malformed escape hides no link.
      }
    }
  }
  const path = url.pathname;
  const embedded = path.search(/\/https?(?::|%3A)/i);
  if (embedded >= 0) {
    try {
      found.push(decodeURIComponent(`${path.slice(embedded + 1)}${url.search}`));
    } catch {
      // A malformed escape hides no link.
    }
  }
  return found;
}

/** The store item and the store page address that named it (before it was made canonical). */
function readStoreItem(value: string, depth: number): { item: ExactRetailerProductLink; page: string } | null {
  const url = httpsUrl(value);
  if (!url) return null;
  const direct = exactRetailerProductLink(url.href) ?? storeCartLink(url);
  if (direct) return { item: direct, page: url.href };
  if (depth >= MAX_WRAPPER_DEPTH) return null;
  const inner = wrappedLinks(url)
    .map((link) => readStoreItem(link, depth + 1))
    .filter((found): found is { item: ExactRetailerProductLink; page: string } => Boolean(found));
  const distinct = new Map(inner.map((found) => [`${found.item.retailerId}:${found.item.retailerSku}`, found]));
  return distinct.size === 1 ? [...distinct.values()][0] ?? null : null;
}

/**
 * The one store item a link names: a product page, an add-to-cart link, or
 * either of those inside affiliate redirects (Howl, Impact, Rakuten,
 * Skimlinks, CJ and the like). Null when it names none or more than one.
 */
export function storeItemFromLink(value: unknown): ExactRetailerProductLink | null {
  return typeof value === "string" ? readStoreItem(value, 0)?.item ?? null : null;
}

/**
 * The store page address a link names, as written (with the product's name in
 * it, "walmart.com/ip/Pokemon-ETB/170…"), inside any redirect; "" for none.
 */
export function storeItemPage(value: unknown): string {
  return typeof value === "string" ? readStoreItem(value, 0)?.page ?? "" : "";
}

// Short-link and redirect services restock servers use. Only these are ever
// followed, so a message can't make Yoink open any other site, or an address
// on the shopper's own network.
const SHORT_LINK_HOSTS = new Set([
  "amzn.to", "a.co", "walmrt.us", "bit.ly", "tinyurl.com", "rb.gy", "cutt.ly", "shorturl.at", "is.gd", "ow.ly", "t.co",
  "buff.ly", "tidd.ly", "geni.us", "howl.me", "howl.link", "goto.walmart.com", "goto.target.com", "click.linksynergy.com",
  "go.skimresources.com", "redirect.viglink.com", "anrdoezrs.net", "dpbolvw.net", "jdoqocy.com", "kqzyfj.com", "tkqlhce.com"
]);
// Branch (Mavely and other creator links) and Impact's tracking domains.
const SHORT_LINK_DOMAINS = ["app.link", "7tiv.net", "sjv.io", "pxf.io", "evyy.net", "i8h2.net", "ojrq.net", "8odi.net",
  "vzew.net", "mtko.net", "ryvx.net"];

/** A link Yoink may follow to see which store item it leads to: a known short-link or redirect service. */
export function isShortStoreLink(value: unknown): boolean {
  const url = typeof value === "string" ? httpsUrl(value) : null;
  if (!url || storeItemFromLink(url.href)) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return SHORT_LINK_HOSTS.has(host) || SHORT_LINK_DOMAINS.some((domain) => onDomain(host, domain));
}

export type StorePageKind = "product" | "search" | "category" | "drawing" | "queue" | "cart" | "home" | "other";

const STORE_HOSTS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ["walmart.com", "walmart"], ["target.com", "target"], ["amazon.com", "amazon"], ["bestbuy.com", "bestbuy"],
  ["pokemoncenter.com", "pokemoncenter"], ["queue-it.net", ""]
] as const);

/**
 * What kind of store page a link lands on (Kevin, 2026-10-13: "validate the
 * landing page to ensure that the signal is even an appropriate product").
 * Null for a page that isn't a store's: an article, a Discord post, a short
 * link not followed yet.
 */
export function storePageOf(value: unknown): { retailerId: string; kind: StorePageKind } | null {
  const url = typeof value === "string" ? httpsUrl(value) : null;
  if (!url) return null;
  const item = storeItemFromLink(url.href);
  if (item) return { retailerId: item.retailerId, kind: "product" };
  const host = url.hostname.toLowerCase();
  const store = STORE_HOSTS.find(([domain]) => onDomain(host, domain));
  if (!store) return null;
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  const query = url.searchParams;
  const kind: StorePageKind = store[0] === "queue-it.net" || /\/(?:queue|waiting-?room)\b/.test(path) ? "queue"
    : /draw(?:ing)?s?\b|\/raffle/.test(path) ? "drawing"
      : /^\/(?:s|search|site\/searchpage\.jsp)$/.test(path) || query.has("searchTerm") || query.has("k") || query.has("st")
        || (query.has("q") && !/^\/(?:ip|p|dp|site)\b/.test(path)) ? "search"
        : /^\/cart\b|\/co-cart\b|\/gp\/cart\b/.test(path) ? "cart"
          : path === "" ? "home"
            : /^\/(?:c|b|cp|browse|category|site\/[^/]+\/pcmcat|shop|s\/[^/]+|gp\/browse)\b/.test(path) || /\/n:\d+/.test(path) ? "category"
              : "other";
  return { retailerId: store[1], kind };
}
