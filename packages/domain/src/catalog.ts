import type { Availability, CatalogListingInput } from "../../contracts/src/index.js";
import { cleanText, normalizeRetailerId, normalizeRetailerSku, positiveCents, safeHttpsUrl } from "./normalize.js";
import { nowIso } from "./ids.js";
import { canonicalRetailerUrl } from "./attribution.js";

const AVAILABILITY = new Set<Availability>(["in_stock", "preorder", "out_of_stock", "unknown"]);

export interface NormalizedCatalogListing {
  sourceConnectionId: string;
  source: string;
  sourceProductId: string;
  sourceListingId: string;
  sourceProductAliases: Record<string, string>;
  sourceProductUrl: string;
  sourceListingUrl: string;
  title: string;
  brand: string;
  variantAttributes: Record<string, string>;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  listingStatus: Availability;
  requestedExecutionSupport: boolean;
  msrpCents: number | null;
  observedPriceCents: number | null;
  currency: string;
  observedAt: string;
}

function normalizedAttributes(input: Record<string, string> | undefined): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [rawKey, rawValue] of Object.entries(input ?? {})) {
    const key = cleanText(rawKey, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_-]/g, "");
    const value = cleanText(rawValue, 160);
    if (key && value) entries.push([key, value]);
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function normalizedAliases(input: Record<string, string> | undefined): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [rawKind, rawValue] of Object.entries(input ?? {})) {
    const kind = cleanText(rawKind, 40).toLocaleLowerCase("en-US").replace(/[^a-z0-9_-]/g, "");
    const value = cleanText(rawValue, 240).normalize("NFKC").toLocaleLowerCase("en-US");
    if (kind && value) entries.push([kind, value]);
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export function hostnameAllowed(urlValue: string, allowedDomains: string[]): boolean {
  const hostname = new URL(urlValue).hostname.toLocaleLowerCase("en-US");
  return allowedDomains.some((domainValue) => {
    const domain = String(domainValue).toLocaleLowerCase("en-US").replace(/^\.+/, "");
    return Boolean(domain) && (hostname === domain || hostname.endsWith(`.${domain}`));
  });
}

export function normalizeCatalogListing(input: CatalogListingInput, now = Date.now()): NormalizedCatalogListing {
  if (!input || typeof input !== "object") throw new Error("A catalog listing object is required.");
  const sourceConnectionId = cleanText(input.sourceConnectionId, 120);
  const source = cleanText(input.source, 60).toLocaleLowerCase("en-US").replace(/[^a-z0-9_-]/g, "");
  const sourceProductId = cleanText(input.sourceProductId, 120);
  const sourceListingId = cleanText(input.sourceListingId, 120);
  const title = cleanText(input.title, 300);
  if (!sourceConnectionId || !source || !sourceProductId || !title) {
    throw new Error("Source connection, product ID, and title are required.");
  }
  const observed = input.observedAt ? new Date(input.observedAt) : new Date(now);
  if (Number.isNaN(observed.getTime()) || observed.getTime() > now + 5 * 60_000) {
    throw new Error("The catalog observation timestamp is invalid.");
  }
  const listingStatus = AVAILABILITY.has(input.listingStatus as Availability)
    ? input.listingStatus as Availability
    : "unknown";
  const currency = cleanText(input.currency || "USD", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("A three-letter currency code is required.");
  const retailerId = normalizeRetailerId(input.retailerId);
  const retailerSku = normalizeRetailerSku(input.retailerSku);
  const canonicalUrl = canonicalRetailerUrl(input.canonicalUrl, retailerId, retailerSku);
  if (!canonicalUrl) {
    throw new Error("The canonical URL must identify the exact selected retailer item.");
  }
  return {
    sourceConnectionId,
    source,
    sourceProductId,
    sourceListingId,
    sourceProductAliases: normalizedAliases(input.sourceProductAliases),
    sourceProductUrl: input.sourceProductUrl ? safeHttpsUrl(input.sourceProductUrl) : "",
    sourceListingUrl: input.sourceListingUrl ? safeHttpsUrl(input.sourceListingUrl) : "",
    title,
    brand: cleanText(input.brand, 120),
    variantAttributes: normalizedAttributes(input.variantAttributes),
    retailerId,
    retailerSku,
    canonicalUrl,
    listingStatus,
    requestedExecutionSupport: input.executionSupported === true,
    msrpCents: positiveCents(input.msrpCents, true),
    observedPriceCents: positiveCents(input.observedPriceCents, true),
    currency,
    observedAt: observed.toISOString() || nowIso(now)
  };
}
