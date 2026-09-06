import { audioAdviceUrlSku } from "../../browser-adapters/src/audioadvice.js";
import { bananarepublicUrlSku } from "../../browser-adapters/src/bananarepublic.js";
import { bananarepublicfactoryUrlSku } from "../../browser-adapters/src/bananarepublicfactory.js";
import { athletaUrlSku } from "../../browser-adapters/src/athleta.js";
import { asusUrlSku } from "../../browser-adapters/src/asus.js";
import { americanEagleUrlSku } from "../../browser-adapters/src/americaneagle.js";
import type {
  AttributionPlan,
  AttributionPolicyDefinition,
  AttributionProvider,
  ListingContext
} from "../../contracts/src/index.js";
import {
  buildHowlAffiliateRoute,
  howlAffiliateStoreForDestination,
  type HowlAffiliateStore
} from "./howl-affiliate-stores.js";
import { cleanText } from "./normalize.js";

const RETAILER_DOMAINS: Readonly<Record<string, string>> = Object.freeze({
  target: "target.com",
  walmart: "walmart.com",
  amazon: "amazon.com",
  bestbuy: "bestbuy.com",
  disney: "disneystore.com",
  ravensburger: "ravensburger.us",
  riot: "merch.riotgames.com",
  booksamillion: "booksamillion.com",
  fanatics: "fanatics.com",
  kohls: "kohls.com",
  macys: "macys.com",
  pbandai: "p-bandai.com",
  pokemoncenter: "pokemoncenter.com",
  asus: "eshop.asus.com",
  audioadvice: "www.audioadvice.com",
  bananarepublic: "bananarepublic.gap.com",
  bananarepublicfactory: "bananarepublicfactory.gapfactory.com",
  athleta: "athleta.gap.com",
  americaneagle: "ae.com",
  aninebing: "aninebing.com"
});
const RETAILER_SKU_FROM_URL: Readonly<Record<string, (url: URL) => string>> = Object.freeze({
  asus: url => asusUrlSku(url.href),
  audioadvice: url => audioAdviceUrlSku(url.href),
  bananarepublic: url => bananarepublicUrlSku(url.href),
  bananarepublicfactory: url => bananarepublicfactoryUrlSku(url.href),
  athleta: url => athletaUrlSku(url.href),
  americaneagle: url => americanEagleUrlSku(url.href),
  aninebing: url => /^\/products\/[a-z0-9-]+\/?$/.test(url.pathname) ? url.searchParams.get("variant")?.match(/^\d{10,20}$/)?.[0] || "" : "",
  target: (url) => url.pathname.match(/(?:\/|-)A-(\d{6,20})(?:\/|$)/i)?.[1] || "",
  walmart: (url) => url.pathname.match(/\/ip\/(?:[^/]+\/)?(\d{5,20})(?:\/|$)/i)?.[1] || "",
  amazon: (url) => (url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1] || "").toUpperCase(),
  bestbuy: (url) => url.pathname.match(/^\/product\/[^/]+\/(?:[^/]+\/sku\/)?(\d{5,20})(?:\/|$)/i)?.[1]
    || url.pathname.match(/^\/site\/[^/]+\/(\d{5,20})\.p(?:\/|$)/i)?.[1]
    || url.searchParams.get("skuId")?.match(/^\d{5,20}$/)?.[0] || "",
  disney: (url) => url.pathname.match(/-(\d{10,20})\.html(?:\/|$)/i)?.[1] || "",
  ravensburger: (url) => /^\/en-US\/products\//i.test(url.pathname)
    ? url.pathname.match(/-(\d{5,20})(?:\/|$)/i)?.[1] || "" : "",
  riot: (url) => (url.pathname.match(/^\/en-us\/product\/([a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?)\/?$/i)?.[1] || "").toUpperCase(),
  booksamillion: (url) => (url.pathname.match(/^\/p\/(?:-\/)?([a-z0-9]{10,20})(?:\/|$)/i)?.[1] || "").toUpperCase(),
  fanatics: (url) => url.pathname.replace(/%2B/gi, "+").match(/(?:^|\+)p-(\d{6,20})(?:\+|$)/i)?.[1] || "",
  kohls: (url) => url.pathname.match(/^\/product\/prd-(\d{5,12})\//i)?.[1] || "",
  macys: (url) => /^\/shop\/product\//i.test(url.pathname)
    ? (url.searchParams.get("ID") || url.searchParams.get("id") || "").match(/^\d{5,20}$/)?.[0] || "" : "",
  pbandai: (url) => (url.pathname.match(/^\/us\/item\/([A-Z]\d{10})(?:\/|$)/i)?.[1] || "").toUpperCase(),
  pokemoncenter: (url) => url.pathname.match(/^\/product\/(\d{2,3}-\d{5}(?:-\d{3})?)(?:\/|$)/i)?.[1] || ""
});
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/;

export interface ExactRetailerProductLink {
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
}

function cleanHttpsUrl(value: unknown): URL | null {
  try {
    const url = new URL(cleanText(value, 4_096));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function canonicalRetailerUrl(value: unknown, retailerId: string, retailerSku: string): string {
  const url = cleanHttpsUrl(value);
  const domain = RETAILER_DOMAINS[retailerId];
  if (!url || !domain || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))) return "";
  const sku = cleanText(retailerSku, 64).toUpperCase();
  if (!sku || RETAILER_SKU_FROM_URL[retailerId]?.(url).toUpperCase() !== sku) return "";
  if (retailerId === "target") return `https://www.target.com/p/-/A-${sku}`;
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
    return url.href;
  }
  if (retailerId === "asus") {
    url.search = "";
    return url.href;
  }
  if (retailerId === "audioadvice") {
    url.search = "";
    url.searchParams.set("variant", sku);
    return url.href;
  }
  if (retailerId === "bananarepublic") {
    url.search = "";
    url.searchParams.set("pid", sku);
    return url.href;
  }
  if (retailerId === "bananarepublicfactory") {
    url.search = "";
    url.searchParams.set("pid", sku);
    return url.href;
  }
  if (retailerId === "athleta") {
    url.search = "";
    url.searchParams.set("pid", sku);
    return url.href;
  }
  if (retailerId === "americaneagle") {
    url.hostname = "www.ae.com";
    url.search = "";
    url.searchParams.set("sku", sku);
    return url.href;
  }
  if (retailerId === "aninebing") {
    url.hostname = "www.aninebing.com";
    url.port = "";
    url.search = "";
    url.searchParams.set("variant", sku);
    return url.href;
  }
  url.hostname = retailerId === "disney" ? "www.disneystore.com"
    : retailerId === "ravensburger" ? "www.ravensburger.us"
      : retailerId === "fanatics" ? "www.fanatics.com"
        : retailerId === "kohls" ? "www.kohls.com" : "www.macys.com";
  url.port = "";
  url.search = "";
  if (retailerId === "macys") url.searchParams.set("ID", sku);
  return url.href;
}

/**
 * Resolve only an exact product-detail URL for one of Yoink's registered
 * retailers. Category, search, drawing-hub, and credential-bearing URLs are
 * deliberately rejected so a user-pasted link cannot manufacture an item
 * identity from query text or an unrelated page.
 */
export function exactRetailerProductLink(value: unknown): ExactRetailerProductLink | null {
  const url = cleanHttpsUrl(value);
  if (!url) return null;
  const matches = Object.entries(RETAILER_DOMAINS).flatMap(([retailerId, domain]) => {
    if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return [];
    const retailerSku = RETAILER_SKU_FROM_URL[retailerId]?.(url) ?? "";
    if (!retailerSku) return [];
    const canonicalUrl = canonicalRetailerUrl(url.href, retailerId, retailerSku);
    return canonicalUrl ? [{ retailerId, retailerSku, canonicalUrl }] : [];
  });
  return matches.length === 1 ? matches[0] ?? null : null;
}

export function normalizedArticleBaseUrl(value: unknown): string {
  const raw = cleanText(value, 4_096);
  if (raw.includes("#")) return "";
  const url = cleanHttpsUrl(raw);
  if (!url || url.search) return "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.href;
}

export function productArticleSlug(title: unknown): string {
  const slug = cleanText(title, 200)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return slug || "product";
}

export function attributionPolicyValidity(
  policy: Pick<AttributionPolicyDefinition, "enabled" | "provider" | "retailerId" | "publisherSlug" | "articleBaseUrl" | "associateTag">
): { valid: boolean; reason: string } {
  if (!policy.enabled) return { valid: true, reason: "Policy is disabled; canonical fallback remains available." };
  if (policy.provider === "canonical") return { valid: true, reason: "Canonical retailer routing selected." };
  if (policy.provider === "howl") {
    if (!howlAffiliateStoreForRetailer(policy.retailerId)) {
      return { valid: false, reason: "Howl is not available for this store; use its direct retailer URL." };
    }
    if (!SLUG_PATTERN.test(policy.publisherSlug)) return { valid: false, reason: "Howl requires a valid publisher slug." };
    if (!normalizedArticleBaseUrl(policy.articleBaseUrl)) return { valid: false, reason: "Howl requires a credential-free HTTPS article base URL." };
    return { valid: true, reason: "Howl route configuration is valid." };
  }
  if (policy.provider === "amazon_associates") {
    if (policy.retailerId !== "amazon") return { valid: false, reason: "Amazon Associates routing is valid only for Amazon." };
    if (!TAG_PATTERN.test(policy.associateTag)) return { valid: false, reason: "Amazon Associates requires a valid associate tag." };
    return { valid: true, reason: "Amazon Associates route configuration is valid." };
  }
  return { valid: false, reason: "The attribution provider is unsupported." };
}

export function howlAffiliateStoreForRetailer(retailerId: string): HowlAffiliateStore | null {
  const domain = RETAILER_DOMAINS[cleanText(retailerId, 60).toLocaleLowerCase("en-US")];
  return domain ? howlAffiliateStoreForDestination(`https://${domain}${retailerId === "americaneagle" ? "/us/en" : retailerId === "asus" ? "/us" : "/"}`) : null;
}

function unavailablePlan(
  listing: ListingContext,
  mode: "prefer_fallback" | "require" | "disabled",
  policyId: string,
  reasonCode: string,
  canonicalUrl: string
): AttributionPlan {
  const blocked = mode === "require";
  return {
    policyId,
    retailerId: listing.retailerId,
    provider: "canonical",
    outcome: blocked ? "required_route_unavailable" : "canonical_fallback",
    reasonCode,
    routeUrl: canonicalUrl,
    metadata: {},
    blocked
  };
}

export function buildAttributionPlan(
  listing: ListingContext,
  title: string,
  mode: "prefer_fallback" | "require" | "disabled",
  policy: AttributionPolicyDefinition | null
): AttributionPlan {
  const canonicalUrl = canonicalRetailerUrl(listing.canonicalUrl, listing.retailerId, listing.retailerSku);
  if (!canonicalUrl) throw new Error("The exact canonical retailer URL is invalid for attribution routing.");
  if (mode === "disabled") {
    return {
      policyId: policy?.id ?? "",
      retailerId: listing.retailerId,
      provider: "canonical",
      outcome: "canonical_disabled",
      reasonCode: "attribution_disabled",
      routeUrl: canonicalUrl,
      metadata: {},
      blocked: false
    };
  }
  if (!policy?.enabled || policy.provider === "canonical") {
    return unavailablePlan(listing, mode, policy?.id ?? "", policy?.enabled ? "canonical_policy" : "policy_disabled", canonicalUrl);
  }
  const validity = attributionPolicyValidity(policy);
  if (!validity.valid) return unavailablePlan(listing, mode, policy.id, "invalid_policy", canonicalUrl);

  if (policy.provider === "howl") {
    const articleBase = normalizedArticleBaseUrl(policy.articleBaseUrl);
    const articleUrl = new URL(productArticleSlug(title), articleBase).href;
    const routeUrl = buildHowlAffiliateRoute({
      destinationUrl: canonicalUrl,
      publisherSlug: policy.publisherSlug,
      articleName: cleanText(title, 200) || "Product",
      articleUrl
    });
    if (!routeUrl) return unavailablePlan(listing, mode, policy.id, "howl_store_not_eligible", canonicalUrl);
    return {
      policyId: policy.id,
      retailerId: listing.retailerId,
      provider: "howl",
      outcome: "affiliate_route",
      reasonCode: "howl_route_ready",
      routeUrl,
      metadata: { publisherSlug: policy.publisherSlug, articleUrl },
      blocked: false
    };
  }

  const route = new URL(`https://www.amazon.com/dp/${encodeURIComponent(listing.retailerSku)}`);
  route.searchParams.set("tag", policy.associateTag);
  return {
    policyId: policy.id,
    retailerId: listing.retailerId,
    provider: "amazon_associates",
    outcome: "affiliate_route",
    reasonCode: "amazon_associate_route_ready",
    routeUrl: route.href,
    metadata: { associateTag: policy.associateTag },
    blocked: false
  };
}

export function isAttributionProvider(value: unknown): value is AttributionProvider {
  return ["canonical", "howl", "amazon_associates"].includes(String(value));
}
