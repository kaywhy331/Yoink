import type { Availability, CatalogListingInput, ListingSellerType } from "../../contracts/src/index.js";
import { cleanText, normalizeRetailerId, normalizeRetailerSku, positiveCents, safeHttpsUrl } from "./normalize.js";
import { nowIso } from "./ids.js";
import { canonicalRetailerUrl } from "./attribution.js";
import { InputValidationError } from "./input-validation-error.js";

const AVAILABILITY = new Set<Availability>(["in_stock", "preorder", "out_of_stock", "unknown"]);
const LIBRARY_PRODUCT_AVAILABILITY = new Set(["", "in_stock", "preorder", "out_of_stock"] as const);
const LIBRARY_PRODUCT_PLAN = new Set(["", "planned", "unplanned"] as const);
const LIBRARY_PRODUCT_CATEGORY = new Set(["", "needoh", "pokemon", "disney_lorcana", "one_piece"] as const);
const LIBRARY_PRODUCT_SORT = new Set(["newest", "oldest", "price_asc", "price_desc", "active", "title"] as const);

export type LibraryProductAvailabilityFilter = "" | "in_stock" | "preorder" | "out_of_stock";
export type LibraryProductPlanFilter = "" | "planned" | "unplanned";
export type LibraryProductCategoryFilter = "" | "needoh" | "pokemon" | "disney_lorcana" | "one_piece";
export type LibraryProductSort = "newest" | "oldest" | "price_asc" | "price_desc" | "active" | "title";

export interface LibraryProductFilterInput {
  search?: unknown;
  retailerId?: unknown;
  availability?: unknown;
  plan?: unknown;
  category?: unknown;
  priceMinCents?: unknown;
  priceMaxCents?: unknown;
  sort?: unknown;
}

export interface LibraryProductFilters {
  search: string;
  retailerId: string;
  availability: LibraryProductAvailabilityFilter;
  plan: LibraryProductPlanFilter;
  category: LibraryProductCategoryFilter;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  sort: LibraryProductSort;
}

function optionalLibraryPrice(value: unknown, label: string): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000) {
    throw new InputValidationError(`${label} must be a whole number of cents from zero through 100000000.`);
  }
  return cents;
}

export function normalizeLibraryProductFilters(input: LibraryProductFilterInput = {}): LibraryProductFilters {
  const retailerId = cleanText(input.retailerId, 60).toLocaleLowerCase("en-US");
  if (retailerId && !/^[a-z0-9][a-z0-9_-]{1,59}$/.test(retailerId)) {
    throw new InputValidationError("Choose a valid product store filter.");
  }
  const availabilityInput = cleanText(input.availability, 30);
  const availability = (availabilityInput === "unavailable" ? "out_of_stock" : availabilityInput) as LibraryProductAvailabilityFilter;
  if (!LIBRARY_PRODUCT_AVAILABILITY.has(availability)) {
    throw new InputValidationError("Choose In stock, Preorder, or Out of stock for the product availability filter.");
  }
  const plan = cleanText(input.plan, 30) as LibraryProductPlanFilter;
  if (!LIBRARY_PRODUCT_PLAN.has(plan)) throw new InputValidationError("Choose a valid product-plan filter.");
  const category = cleanText(input.category, 40).toLocaleLowerCase("en-US") as LibraryProductCategoryFilter;
  if (!LIBRARY_PRODUCT_CATEGORY.has(category)) throw new InputValidationError("Choose a valid popular product category.");
  const sortInput = cleanText(input.sort, 30) || "newest";
  if (!LIBRARY_PRODUCT_SORT.has(sortInput as LibraryProductSort)) throw new InputValidationError("Choose a valid product sort order.");
  const priceMinCents = optionalLibraryPrice(input.priceMinCents, "The minimum product price");
  const priceMaxCents = optionalLibraryPrice(input.priceMaxCents, "The maximum product price");
  if (priceMaxCents !== null && priceMaxCents === 0) {
    throw new InputValidationError("The maximum product price must be greater than zero.");
  }
  if (priceMinCents !== null && priceMaxCents !== null && priceMaxCents <= priceMinCents) {
    throw new InputValidationError("The maximum product price must be greater than the minimum product price.");
  }
  return {
    search: cleanText(input.search, 200),
    retailerId,
    availability,
    plan,
    category,
    priceMinCents,
    priceMaxCents,
    sort: sortInput as LibraryProductSort
  };
}

export function isPurchasableAvailability(value: unknown): boolean {
  return value === "in_stock" || value === "preorder";
}

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
  sellerType: ListingSellerType;
  msrpCents: number | null;
  observedPriceCents: number | null;
  currency: string;
  observedAt: string;
}

const SELLER_TYPES = new Set<ListingSellerType>(["first_party", "third_party", "unknown"]);

export function normalizeSellerType(value: unknown): ListingSellerType {
  return SELLER_TYPES.has(value as ListingSellerType) ? value as ListingSellerType : "unknown";
}

// Retailer names that mean the store itself is the seller on a marketplace page.
const FIRST_PARTY_SELLER_NAMES: Record<string, RegExp> = {
  walmart: /^walmart(?:\.com)?$/i,
  amazon: /^amazon(?:\.com)?$/i,
  target: /^target(?:\.com)?$/i,
  bestbuy: /^best ?buy(?:\.com)?$/i
};

// Classifies a marketplace seller name relative to the retailer hosting the listing.
// An empty name is unknown, never assumed first party.
export function sellerTypeForName(retailerId: string, sellerName: unknown): ListingSellerType {
  const name = cleanText(sellerName, 160);
  if (!name) return "unknown";
  const pattern = FIRST_PARTY_SELLER_NAMES[cleanText(retailerId, 60).toLocaleLowerCase("en-US")];
  if (pattern?.test(name)) return "first_party";
  return "third_party";
}

// Brand prefixes seen in TrackaLacker titles. The source sends no brand field, so
// the family brand is inferred from the title until an identifier-backed source does.
const BRAND_TITLE_PATTERNS: Array<[RegExp, string]> = [
  [/^pok[eé]mon\b/i, "Pokémon"],
  [/\blorcana\b/i, "Disney Lorcana"],
  [/^(?:mtg\b|magic:? the gathering\b)/i, "Magic: The Gathering"],
  [/^one piece\b/i, "One Piece"],
  [/^yu-?gi-?oh\b/i, "Yu-Gi-Oh!"],
  [/^topps\b/i, "Topps"],
  [/^panini\b/i, "Panini"],
  [/\bneedoh\b/i, "NeeDoh"],
  [/^funko\b/i, "Funko"],
  [/^lego\b/i, "LEGO"],
  [/^hot wheels\b/i, "Hot Wheels"],
  [/^squishmallows?\b/i, "Squishmallows"],
  [/^(?:pop mart|labubu)\b/i, "Pop Mart"],
  [/^ravensburger\b/i, "Ravensburger"],
  [/^star wars\b/i, "Star Wars"]
];

export function inferBrandFromTitle(title: unknown): string {
  const text = cleanText(title, 300);
  if (!text) return "";
  for (const [pattern, brand] of BRAND_TITLE_PATTERNS) {
    if (pattern.test(text)) return brand;
  }
  return "";
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
  if (!input || typeof input !== "object") throw new InputValidationError("A catalog listing object is required.");
  const sourceConnectionId = cleanText(input.sourceConnectionId, 120);
  const source = cleanText(input.source, 60).toLocaleLowerCase("en-US").replace(/[^a-z0-9_-]/g, "");
  const sourceProductId = cleanText(input.sourceProductId, 120);
  const sourceListingId = cleanText(input.sourceListingId, 120);
  const title = cleanText(input.title, 300);
  if (!sourceConnectionId || !source || !sourceProductId || !title) {
    throw new InputValidationError("Source connection, product ID, and title are required.");
  }
  const observed = input.observedAt ? new Date(input.observedAt) : new Date(now);
  if (Number.isNaN(observed.getTime()) || observed.getTime() > now + 5 * 60_000) {
    throw new InputValidationError("The catalog observation timestamp is invalid.");
  }
  const listingStatus = AVAILABILITY.has(input.listingStatus as Availability)
    ? input.listingStatus as Availability
    : "unknown";
  const currency = cleanText(input.currency || "USD", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new InputValidationError("A three-letter currency code is required.");
  const retailerId = normalizeRetailerId(input.retailerId);
  const retailerSku = normalizeRetailerSku(input.retailerSku);
  const canonicalUrl = canonicalRetailerUrl(input.canonicalUrl, retailerId, retailerSku);
  if (!canonicalUrl) {
    throw new InputValidationError("The canonical URL must identify the exact selected retailer item.");
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
    sellerType: normalizeSellerType(input.sellerType),
    msrpCents: positiveCents(input.msrpCents, true),
    observedPriceCents: positiveCents(input.observedPriceCents, true),
    currency,
    observedAt: observed.toISOString() || nowIso(now)
  };
}
