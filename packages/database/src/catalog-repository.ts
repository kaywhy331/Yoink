import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { DomainConflictError } from "../../domain/src/domain-request-error.js";
import type {
  Availability,
  CatalogListingInput,
  LibraryProduct,
  LibraryProductListing,
  LibraryProductOtherStore,
  LibraryProductStore,
  ListingContext,
  ListingSellerType,
  NormalizedSignal,
  SupportedRetailerId,
  TrackalackerCatalogItemInput,
  TrackalackerKnownListing,
  CollectionWant,
  TrackalackerMsrpReference
} from "../../contracts/src/index.js";
import {
  hostnameAllowed,
  inferBrandFromTitle,
  isPurchasableAvailability,
  normalizeCatalogListing,
  normalizeLibraryProductFilters,
  normalizeSellerType,
  sellerTypeForName
} from "../../domain/src/catalog.js";
import type {
  LibraryProductFilterInput,
  LibraryProductFilters,
  NormalizedCatalogListing
} from "../../domain/src/catalog.js";
import { cleanText, positiveCents, safeHttpsUrl } from "../../domain/src/normalize.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { historyTimeOrder, validateHistoryReference } from "../../domain/src/trackalacker-history.js";
import { fallbackItemTitle, isAllNewCollectionTitle, isFallbackItemTitle, itemTitleFromUrl, sameCollectionItem } from "../../domain/src/collections.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope, scopedSourceConnectionId } from "./request-scope.js";

function storedHistoryReference(row: Record<string, unknown>): TrackalackerMsrpReference | null {
  try {
    const reference = JSON.parse(String(row.msrpHistoryJson ?? "{}")) as TrackalackerMsrpReference;
    const cents = reference.kind === "reported_msrp" ? row.msrpCents : row.estimatedMsrpCents;
    return Number(cents) === reference.priceCents ? reference : null;
  } catch { return null; }
}

// Price and stock may be reported by different updates. Keep each value tied
// to its own timestamp, including deterministic ordering for simultaneous calls.
const libraryObservationColumns = `
  price_observation.unit_price_cents AS currentPriceCents,
  price_observation.observed_at AS priceObservedAt,
  price_source.source AS priceSource,
  stock_observation.availability AS observedAvailability,
  stock_observation.observed_at AS availabilityObservedAt,
  stock_source.source AS availabilitySource`;
const libraryObservationJoins = `
  LEFT JOIN offer_observations price_observation ON price_observation.id = (
    SELECT oo.id FROM offer_observations oo
    WHERE oo.listing_id = l.id AND oo.unit_price_cents IS NOT NULL
    ORDER BY oo.observed_at DESC, oo.id DESC LIMIT 1
  )
  LEFT JOIN offer_observations stock_observation ON stock_observation.id = (
    SELECT oo.id FROM offer_observations oo WHERE oo.listing_id = l.id
    ORDER BY oo.observed_at DESC, oo.id DESC LIMIT 1
  )
  LEFT JOIN source_connections price_source ON price_source.id = price_observation.source_connection_id
    AND price_source.tenant_id = ? AND price_source.user_id = ?
  LEFT JOIN source_connections stock_source ON stock_source.id = stock_observation.source_connection_id
    AND stock_source.tenant_id = ? AND stock_source.user_id = ?`;

function libraryObservationParameters(): string[] {
  const { tenantId, userId } = currentRequestScope();
  return [tenantId, userId, tenantId, userId];
}

function publicObservationSource(source: unknown): string | null {
  // Never expose connection names, private channel identifiers, or custom
  // source names through the shared product catalog.
  return ["trackalacker", "discord", "api", "browser"].includes(String(source)) ? String(source) : null;
}

interface SourceConnectionRow {
  id: string;
  source: string;
  auto_create_missions: number;
  trust_level: string;
}

interface RetailerRow {
  id: string;
  display_name: string;
  execution_supported: number;
  domains_json: string;
}

interface ListingRow {
  id: string;
  variant_id: string;
  title: string;
  retailer_id: string;
  retailer_sku: string;
  canonical_url: string;
  execution_supported: number;
  msrp_cents: number | null;
  currency: string;
}

export interface CatalogUpsertResult {
  listing: ListingContext;
  createdVariant: boolean;
  createdListing: boolean;
}

export interface TrackalackerCatalogUpsertResult {
  sourceProductId: string;
  variantId: string;
  candidatesAccepted: number;
  listingsMapped: number;
  listingsCreated: number;
}

export interface ResolutionResult {
  status: "matched" | "unresolved" | "ambiguous";
  method: string;
  reason: string;
  listing: ListingContext | null;
}

// Folds a product's listings into one entry per store: the primary offer represents
// the store, alternates (marketplace sellers, pack variations) sit beneath it.
function groupListingsByStore(listings: LibraryProductListing[]): LibraryProductStore[] {
  const stores = new Map<string, LibraryProductStore>();
  for (const listing of listings) {
    const store = stores.get(listing.retailerId);
    if (!store) {
      stores.set(listing.retailerId, {
        retailerId: listing.retailerId,
        retailerName: listing.retailerName,
        executionSupported: listing.executionSupported,
        listingCount: 1,
        primary: listing,
        alternates: []
      });
      continue;
    }
    store.listingCount += 1;
    store.executionSupported = store.executionSupported || listing.executionSupported;
    if (listing.offerRole === "primary" && store.primary.offerRole !== "primary") {
      store.alternates.push(store.primary);
      store.primary = listing;
    } else {
      store.alternates.push(listing);
    }
  }
  return [...stores.values()];
}

function listingContext(row: ListingRow): ListingContext {
  return {
    id: row.id,
    variantId: row.variant_id,
    title: row.title,
    retailerId: row.retailer_id,
    retailerSku: row.retailer_sku,
    canonicalUrl: row.canonical_url,
    executionSupported: row.execution_supported === 1,
    msrpCents: row.msrp_cents === null ? null : Number(row.msrp_cents),
    currency: row.currency
  };
}

interface LibraryProductQueryParts {
  filters: LibraryProductFilters;
  cte: string;
  where: string;
  parameters: Array<string | number>;
  orderBy: string;
}

const LIBRARY_PRODUCT_ORDER: Record<LibraryProductFilters["sort"], string> = {
  newest: "v.created_at DESC, v.title COLLATE NOCASE, v.id",
  oldest: "v.created_at, v.title COLLATE NOCASE, v.id",
  price_asc: "facts.bestPriceCents IS NULL, facts.bestPriceCents, v.title COLLATE NOCASE, v.id",
  price_desc: "facts.bestPriceCents IS NULL, facts.bestPriceCents DESC, v.title COLLATE NOCASE, v.id",
  active: "facts.lastActivityAt DESC, v.title COLLATE NOCASE, v.id",
  title: "v.title COLLATE NOCASE, v.id"
};

function libraryProductQueryParts(input: LibraryProductFilterInput | string, variantId = ""): LibraryProductQueryParts {
  const filters = normalizeLibraryProductFilters(typeof input === "string" ? { search: input } : input);
  const scope = currentRequestScope();
  const where: string[] = [];
  const parameters: Array<string | number> = [
    filters.retailerId,
    filters.retailerId,
    filters.retailerId,
    filters.retailerId,
    filters.retailerId,
    filters.retailerId,
    filters.retailerId,
    filters.retailerId,
    filters.retailerId,
    filters.retailerId
  ];
  // Source-only product shells are useful while identity reconciliation runs,
  // but they are not shopper products until at least one exact store listing
  // has been approved and mapped.
  // An "All New …" entry shows even before any item has appeared: wanting it
  // wants every item that will (Kevin, 2026-10-09).
  where.push(`(EXISTS (SELECT 1 FROM listings visible_listing WHERE visible_listing.variant_id = v.id)
    OR (v.collection_variant_id = '' AND v.title LIKE 'All New %'))`);
  if (variantId) { where.push("v.id = ?"); parameters.push(variantId); }
  if (filters.search) {
    const pattern = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
    where.push(`(v.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR EXISTS (
      SELECT 1 FROM listings search_listing
      JOIN retailers search_retailer ON search_retailer.id = search_listing.retailer_id
      WHERE search_listing.variant_id = v.id
        AND (search_retailer.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR search_listing.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE)
    ))`);
    parameters.push(pattern, pattern, pattern);
  }
  if (filters.retailerId) {
    where.push("EXISTS (SELECT 1 FROM listings store_listing WHERE store_listing.variant_id = v.id AND store_listing.retailer_id = ?)");
    parameters.push(filters.retailerId);
  }
  if (filters.category) {
    const patterns: Record<Exclude<LibraryProductFilters["category"], "">, string[]> = {
      needoh: ["%needoh%"],
      pokemon: ["%pokemon%", "%pokémon%"],
      disney_lorcana: ["%lorcana%"],
      one_piece: ["%one piece%"]
    };
    const categoryPatterns = patterns[filters.category];
    const clauses = categoryPatterns.map(() => `(v.title LIKE ? COLLATE NOCASE OR EXISTS (
      SELECT 1 FROM product_families category_family
      WHERE category_family.id = v.family_id AND category_family.brand LIKE ? COLLATE NOCASE
    ))`);
    where.push(`(${clauses.join(" OR ")})`);
    for (const pattern of categoryPatterns) parameters.push(pattern, pattern);
  }
  if (filters.availability === "in_stock" || filters.availability === "preorder") {
    where.push(`EXISTS (
      SELECT 1 FROM listings availability_listing
      WHERE availability_listing.variant_id = v.id AND availability_listing.status = ?
        ${filters.retailerId ? "AND availability_listing.retailer_id = ?" : ""}
    )`);
    parameters.push(filters.availability);
    if (filters.retailerId) parameters.push(filters.retailerId);
  } else if (filters.availability === "out_of_stock") {
    where.push(`EXISTS (
      SELECT 1 FROM listings unavailable_listing
      WHERE unavailable_listing.variant_id = v.id AND unavailable_listing.status = 'out_of_stock'
        ${filters.retailerId ? "AND unavailable_listing.retailer_id = ?" : ""}
    )`);
    if (filters.retailerId) parameters.push(filters.retailerId);
    if (!filters.retailerId) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM listings purchasable_listing
        WHERE purchasable_listing.variant_id = v.id
          AND purchasable_listing.status IN ('in_stock', 'preorder')
      )`);
    }
  }
  if (filters.plan === "planned") {
    where.push(`EXISTS (
      SELECT 1 FROM missions planned_mission
      WHERE planned_mission.variant_id = v.id
        AND planned_mission.tenant_id = ? AND planned_mission.user_id = ?
        AND planned_mission.status <> 'deleted'
    )`);
    parameters.push(scope.tenantId, scope.userId);
  } else if (filters.plan === "unplanned") {
    where.push(`NOT EXISTS (
      SELECT 1 FROM missions planned_mission
      WHERE planned_mission.variant_id = v.id
        AND planned_mission.tenant_id = ? AND planned_mission.user_id = ?
        AND planned_mission.status <> 'deleted'
    )`);
    parameters.push(scope.tenantId, scope.userId);
  }
  if (filters.priceMinCents !== null) {
    where.push("facts.bestPriceCents >= ?");
    parameters.push(filters.priceMinCents);
  }
  if (filters.priceMaxCents !== null) {
    where.push("facts.bestPriceCents < ?");
    parameters.push(filters.priceMaxCents);
  }
  const inStockOnly = filters.availability === "in_stock" ? "status = 'in_stock'" : "1 = 1";
  return {
    filters,
    cte: `WITH listing_facts AS (
      SELECT l.variant_id AS variantId, l.retailer_id AS retailerId, l.status, l.offer_role AS offerRole,
             COALESCE((
               SELECT observed.unit_price_cents FROM offer_observations observed
               WHERE observed.listing_id = l.id AND observed.unit_price_cents IS NOT NULL
               ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1
             ), l.msrp_cents) AS effectivePriceCents,
             MAX(l.updated_at, COALESCE((
               SELECT activity.observed_at FROM offer_observations activity
               WHERE activity.listing_id = l.id AND activity.unit_price_cents IS NOT NULL
               ORDER BY activity.observed_at DESC, activity.id DESC LIMIT 1
             ), '')) AS activityAt
      FROM listings l
      WHERE l.offer_role <> 'hidden'
    ), variant_facts AS (
      SELECT variant.id AS variantId,
             -- The price a product browses at is its cheapest primary offer, in stock or
             -- not (Kevin, 2026-10-09: "pricing > availability"); with In stock only, its
             -- cheapest in-stock offer. Marketplace alternates only fill in when no
             -- primary offer carries a price at all.
             COALESCE(
               MIN(CASE WHEN (? = '' OR retailerId = ?) AND offerRole = 'primary' AND ${inStockOnly} THEN effectivePriceCents END),
               MIN(CASE WHEN (? = '' OR retailerId = ?) AND ${inStockOnly} THEN effectivePriceCents END),
               MIN(CASE WHEN (? = '' OR retailerId = ?) AND offerRole = 'primary' THEN effectivePriceCents END),
               MIN(CASE WHEN (? = '' OR retailerId = ?) THEN effectivePriceCents END)
             ) AS bestPriceCents,
             MAX(CASE WHEN (? = '' OR retailerId = ?) THEN activityAt END) AS lastActivityAt
      FROM variants variant
      LEFT JOIN listing_facts ON listing_facts.variantId = variant.id
      GROUP BY variant.id
    )`,
    where: where.length ? `WHERE ${where.join(" AND ")}` : "",
    parameters,
    orderBy: LIBRARY_PRODUCT_ORDER[filters.sort]
  };
}

/** The "All New …" entries the current shopper wants every item of. */
export function collectionWants(db: YoinkDatabase): CollectionWant[] {
  const row = db.get<{ value: string }>("SELECT collection_wants_json AS value FROM app_settings WHERE user_id = ?", currentRequestScope().userId);
  try {
    const parsed = JSON.parse(row?.value || "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is CollectionWant => Boolean(item) && typeof item === "object"
        && typeof (item as CollectionWant).variantId === "string" && ["add_to_cart", "notify"].includes((item as CollectionWant).mode))
      : [];
  } catch {
    return [];
  }
}

export class CatalogRepository {
  constructor(private readonly db: YoinkDatabase) {}

  exactRetailerListing(retailerId: SupportedRetailerId, retailerSku: string): ListingContext | null {
    const normalizedSku = cleanText(retailerSku, 64).toUpperCase();
    if (!normalizedSku) return null;
    const row = this.db.get<ListingRow>(
      `SELECT l.id, l.variant_id, v.title, l.retailer_id, l.retailer_sku,
              l.canonical_url, l.execution_supported, l.msrp_cents, l.currency
       FROM listings l
       JOIN variants v ON v.id = l.variant_id
       WHERE l.retailer_id = ? AND l.retailer_sku = ?`,
      retailerId,
      normalizedSku
    );
    return row ? listingContext(row) : null;
  }

  sourceConnection(id: string): SourceConnectionRow | null {
    return this.db.get<SourceConnectionRow>(
      "SELECT id, source, auto_create_missions, trust_level FROM source_connections WHERE id = ? AND user_id = ?",
      id,
      currentRequestScope().userId
    ) ?? null;
  }

  normalizedListingInput(input: CatalogListingInput, now = Date.now()): CatalogListingInput {
    const normalized = this.validateListing(input, now);
    return {
      sourceConnectionId: normalized.sourceConnectionId,
      source: normalized.source,
      sourceProductId: normalized.sourceProductId,
      sourceListingId: normalized.sourceListingId,
      sourceProductAliases: normalized.sourceProductAliases,
      sourceProductUrl: normalized.sourceProductUrl,
      sourceListingUrl: normalized.sourceListingUrl,
      title: normalized.title,
      brand: normalized.brand,
      variantAttributes: normalized.variantAttributes,
      retailerId: normalized.retailerId,
      retailerSku: normalized.retailerSku,
      canonicalUrl: normalized.canonicalUrl,
      listingStatus: normalized.listingStatus,
      executionSupported: normalized.requestedExecutionSupport,
      msrpCents: normalized.msrpCents,
      observedPriceCents: normalized.observedPriceCents,
      currency: normalized.currency,
      observedAt: normalized.observedAt
    };
  }

  private validateListing(input: CatalogListingInput, now: number): NormalizedCatalogListing {
    const normalized = normalizeCatalogListing(input, now);
    const sourceConnection = this.sourceConnection(normalized.sourceConnectionId);
    if (!sourceConnection || sourceConnection.source !== normalized.source) {
      throw new InputValidationError("The catalog source does not match a configured source connection.");
    }
    if (sourceConnection.source === "user_link"
      && (normalized.listingStatus !== "unknown"
        || normalized.observedPriceCents !== null
        || normalized.msrpCents !== null)) {
      throw new Error("A user-pasted product link cannot assert availability or price evidence.");
    }
    const retailer = this.db.get<RetailerRow>(
      "SELECT id, display_name, execution_supported, domains_json FROM retailers WHERE id = ?",
      normalized.retailerId
    );
    if (!retailer) throw new Error("The retailer is not registered in the commerce graph.");
    const allowedDomains = JSON.parse(retailer.domains_json) as string[];
    if (!hostnameAllowed(normalized.canonicalUrl, allowedDomains)) {
      throw new Error("The canonical listing URL does not belong to the selected retailer.");
    }
    return normalized;
  }

  /** An "All New …" entry: its title says so and it is not itself an item. */
  isCollectionVariant(variantId: string): boolean {
    const row = this.db.get<{ title: string; collectionVariantId: string }>(
      "SELECT title, collection_variant_id AS collectionVariantId FROM variants WHERE id = ?", variantId);
    return Boolean(row && !row.collectionVariantId && isAllNewCollectionTitle(row.title));
  }

  private createCollectionVariant(title: string, timestamp: string): string {
    const familyId = newId("family");
    const variantId = newId("variant");
    this.db.run("INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      familyId, title, inferBrandFromTitle(title), timestamp, timestamp);
    this.db.run("INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)",
      variantId, familyId, title, timestamp, timestamp);
    return variantId;
  }

  /**
   * The product of one item of an "All New …" entry: the one it already has,
   * or a new one linked to the entry. An item filed under the entry itself
   * (before 1.30.26) moves to its own product; a plan on the entry stops
   * targeting it, since wanting the entry now wants each item on its own.
   */
  private collectionItemVariant(
    collectionVariantId: string,
    item: { itemTitle: string; retailerId: string; retailerName: string; retailerSku: string; priceCents: number | null },
    existingListing: { id: string; variant_id: string } | null | undefined,
    timestamp: string
  ): string {
    const collectionTitle = this.db.get<{ title: string }>("SELECT title FROM variants WHERE id = ?", collectionVariantId)?.title ?? "";
    const title = item.itemTitle || fallbackItemTitle(collectionTitle, item.retailerName, item.retailerSku);
    // The same item at another store is the same product, with one listing per store.
    const twin = existingListing && existingListing.variant_id !== collectionVariantId
      ? "" : this.collectionItemTwin(collectionVariantId, collectionTitle, { ...item, title });
    if (twin) {
      if (existingListing) {
        this.db.run("UPDATE listings SET variant_id = ?, offer_role = 'primary', updated_at = ? WHERE id = ?", twin, timestamp, existingListing.id);
        this.db.run(`UPDATE mission_targets SET enabled = 0
          WHERE listing_id = ? AND mission_id IN (SELECT id FROM missions WHERE variant_id = ?)`, existingListing.id, collectionVariantId);
      }
      return twin;
    }
    if (existingListing && existingListing.variant_id !== collectionVariantId) {
      const current = this.db.get<{ title: string; collectionVariantId: string; familyId: string }>(
        "SELECT title, collection_variant_id AS collectionVariantId, family_id AS familyId FROM variants WHERE id = ?",
        existingListing.variant_id);
      if (current && !current.collectionVariantId && !this.isCollectionVariant(existingListing.variant_id)) {
        this.db.run("UPDATE variants SET collection_variant_id = ?, updated_at = ? WHERE id = ?", collectionVariantId, timestamp, existingListing.variant_id);
      }
      // A name from the store link replaces a placeholder one.
      if (current && item.itemTitle && isFallbackItemTitle(current.title)) {
        this.db.run("UPDATE variants SET title = ?, updated_at = ? WHERE id = ?", item.itemTitle, timestamp, existingListing.variant_id);
        this.db.run("UPDATE product_families SET title = ?, updated_at = ? WHERE id = ?", item.itemTitle, timestamp, current.familyId);
      }
      return existingListing.variant_id;
    }
    const familyId = newId("family");
    const variantId = newId("variant");
    this.db.run("INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      familyId, title, inferBrandFromTitle(title) || inferBrandFromTitle(collectionTitle), timestamp, timestamp);
    this.db.run(`INSERT INTO variants(id, family_id, title, attributes_json, collection_variant_id, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, ?, ?)`, variantId, familyId, title, collectionVariantId, timestamp, timestamp);
    if (existingListing) {
      this.db.run("UPDATE listings SET variant_id = ?, offer_role = 'primary', updated_at = ? WHERE id = ?", variantId, timestamp, existingListing.id);
      this.db.run(`UPDATE mission_targets SET enabled = 0
        WHERE listing_id = ? AND mission_id IN (SELECT id FROM missions WHERE variant_id = ?)`, existingListing.id, collectionVariantId);
    }
    return variantId;
  }

  /** The entry's item that is this one at another store, when exactly one is. */
  private collectionItemTwin(collectionVariantId: string, collectionTitle: string,
    item: { title: string; retailerId: string; priceCents: number | null }): string {
    const candidates = this.db.all<{ id: string; title: string; retailers: string; priceCents: number | null }>(
      `SELECT v.id, v.title,
              COALESCE((SELECT group_concat(l.retailer_id, ',') FROM listings l WHERE l.variant_id = v.id), '') AS retailers,
              (SELECT oo.unit_price_cents FROM offer_observations oo JOIN listings l ON l.id = oo.listing_id
               WHERE l.variant_id = v.id AND oo.unit_price_cents IS NOT NULL AND oo.seller_type <> 'third_party'
               ORDER BY oo.observed_at DESC, oo.id DESC LIMIT 1) AS priceCents
       FROM variants v WHERE v.collection_variant_id = ?`, collectionVariantId)
      .filter((candidate) => !candidate.retailers.split(",").includes(item.retailerId)
        && sameCollectionItem(collectionTitle, { title: candidate.title, priceCents: candidate.priceCents },
          { title: item.title, priceCents: item.priceCents }));
    return candidates.length === 1 ? candidates[0]!.id : "";
  }

  /**
   * Items an "All New …" entry carried as its own listings before 1.30.26 move
   * to their own products, named from their store links. Runs at startup, so
   * the entry can be wanted before the next sync files them the same way.
   */
  refileCollectionListings(now = Date.now()): number {
    const rows = this.db.all<{ id: string; variantId: string; retailerId: string; retailerName: string; retailerSku: string;
      canonicalUrl: string; outboundUrl: string; priceCents: number | null }>(
      `SELECT l.id, l.variant_id AS variantId, l.retailer_id AS retailerId, r.display_name AS retailerName, l.retailer_sku AS retailerSku,
              l.canonical_url AS canonicalUrl,
              (SELECT oo.unit_price_cents FROM offer_observations oo
               WHERE oo.listing_id = l.id AND oo.unit_price_cents IS NOT NULL AND oo.seller_type <> 'third_party'
               ORDER BY oo.observed_at DESC, oo.id DESC LIMIT 1) AS priceCents,
              COALESCE((SELECT c.outbound_url FROM source_listing_refs sr
                JOIN source_listing_candidates c
                  ON c.source_connection_id = sr.source_connection_id AND c.external_listing_id = sr.external_listing_id
                WHERE sr.listing_id = l.id AND c.outbound_url <> '' ORDER BY c.updated_at DESC LIMIT 1), '') AS outboundUrl
       FROM listings l JOIN variants v ON v.id = l.variant_id JOIN retailers r ON r.id = l.retailer_id
       WHERE v.collection_variant_id = '' AND v.title LIKE 'All New %'
       ORDER BY l.created_at, l.id`).filter((row) => this.isCollectionVariant(row.variantId));
    if (!rows.length) return 0;
    return this.db.transaction(() => {
      for (const row of rows) {
        this.collectionItemVariant(row.variantId, {
          itemTitle: itemTitleFromUrl(row.outboundUrl) || itemTitleFromUrl(row.canonicalUrl),
          retailerId: row.retailerId,
          retailerName: row.retailerName,
          retailerSku: row.retailerSku,
          priceCents: row.priceCents === null ? null : Number(row.priceCents)
        }, { id: row.id, variant_id: row.variantId }, nowIso(now));
      }
      return rows.length;
    });
  }

  upsertListing(input: CatalogListingInput, now = Date.now()): CatalogUpsertResult {
    const normalized = this.validateListing(input, now);
    const retailer = this.db.get<RetailerRow>(
      "SELECT id, display_name, execution_supported, domains_json FROM retailers WHERE id = ?",
      normalized.retailerId
    );
    if (!retailer) throw new Error("The retailer is not registered in the commerce graph.");
    return this.db.transaction(() => {
      const timestamp = nowIso(now);
      const productRef = this.db.get<{ variant_id: string }>(
        `SELECT variant_id FROM source_product_refs
         WHERE source_connection_id = ? AND external_product_id = ?`,
        normalized.sourceConnectionId,
        normalized.sourceProductId
      );
      const existingListing = this.db.get<{
        id: string;
        variant_id: string;
        canonical_url: string;
        status: string;
        execution_supported: number;
        currency: string;
      }>(
        `SELECT id, variant_id, canonical_url, status, execution_supported, currency
         FROM listings WHERE retailer_id = ? AND retailer_sku = ?`,
        normalized.retailerId,
        normalized.retailerSku
      );
      // "All New …" entries (Kevin, 2026-10-09): each item is its own product,
      // linked to its entry; the entry keeps the source product's mapping.
      const collectionVariantId = productRef && this.isCollectionVariant(productRef.variant_id) ? productRef.variant_id
        : !productRef && isAllNewCollectionTitle(normalized.title) ? this.createCollectionVariant(normalized.title, timestamp) : "";
      const itemVariantId = collectionVariantId
        ? this.collectionItemVariant(collectionVariantId, {
          itemTitle: cleanText(input.itemTitle, 200) || itemTitleFromUrl(normalized.canonicalUrl),
          retailerId: normalized.retailerId,
          retailerName: retailer.display_name,
          retailerSku: normalized.retailerSku,
          priceCents: normalized.observedPriceCents
        }, existingListing, timestamp)
        : "";
      if (!collectionVariantId && productRef && existingListing && productRef.variant_id !== existingListing.variant_id) {
        throw new DomainConflictError("variant_conflict", "The source product and retailer SKU currently map to different exact variants.");
      }

      let variantId = itemVariantId || (productRef?.variant_id ?? existingListing?.variant_id ?? "");
      let createdVariant = false;
      if (!variantId) {
        const familyId = newId("family");
        variantId = newId("variant");
        this.db.run(
          "INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          familyId,
          normalized.title,
          normalized.brand || inferBrandFromTitle(normalized.title),
          timestamp,
          timestamp
        );
        this.db.run(
          "INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          variantId,
          familyId,
          normalized.title,
          JSON.stringify(normalized.variantAttributes),
          timestamp,
          timestamp
        );
        createdVariant = true;
      }
      // The source product (and its aliases) stay mapped to the entry, not the item.
      const sourceVariantId = collectionVariantId || variantId;

      const existingProductRef = this.db.get<{ variant_id: string }>(
        "SELECT variant_id FROM source_product_refs WHERE source_connection_id = ? AND external_product_id = ?",
        normalized.sourceConnectionId,
        normalized.sourceProductId
      );
      if (existingProductRef && existingProductRef.variant_id !== sourceVariantId) {
        throw new Error("The source product is already mapped to another exact variant.");
      }
      this.db.run(
        `INSERT INTO source_product_refs(
           id, source_connection_id, external_product_id, variant_id,
           source_url, source_title, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_connection_id, external_product_id) DO UPDATE SET
           source_url = excluded.source_url,
           source_title = excluded.source_title,
           observed_at = excluded.observed_at`,
        newId("source_product"),
        normalized.sourceConnectionId,
        normalized.sourceProductId,
        sourceVariantId,
        normalized.sourceProductUrl,
        normalized.title,
        normalized.observedAt
      );

      for (const [aliasKind, aliasValue] of Object.entries(normalized.sourceProductAliases)) {
        const existingAlias = this.db.get<{ variant_id: string }>(
          `SELECT variant_id FROM source_product_aliases
           WHERE source_connection_id = ? AND alias_kind = ? AND alias_value = ?`,
          normalized.sourceConnectionId,
          aliasKind,
          aliasValue
        );
        if (existingAlias && existingAlias.variant_id !== sourceVariantId) {
          throw new Error("The source product alias is already mapped to another exact variant.");
        }
        this.db.run(
          `INSERT INTO source_product_aliases(
             id, source_connection_id, alias_kind, alias_value, variant_id, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_connection_id, alias_kind, alias_value) DO UPDATE SET
             observed_at = excluded.observed_at`,
          newId("source_alias"),
          normalized.sourceConnectionId,
          aliasKind,
          aliasValue,
          sourceVariantId,
          normalized.observedAt
        );
      }

      const listingId = existingListing?.id ?? newId("listing");
      const createdListing = !existingListing;
      const preserveObservedListing = normalized.source === "user_link" && Boolean(existingListing);
      const canonicalUrl = preserveObservedListing ? existingListing!.canonical_url : normalized.canonicalUrl;
      const listingStatus = preserveObservedListing ? existingListing!.status : normalized.listingStatus;
      const executionSupported = preserveObservedListing
        ? existingListing!.execution_supported
        : retailer.execution_supported === 1 && normalized.requestedExecutionSupport ? 1 : 0;
      const currency = preserveObservedListing ? existingListing!.currency : normalized.currency;
      this.db.run(
        `INSERT INTO listings(
           id, variant_id, retailer_id, retailer_sku, canonical_url, status,
           execution_supported, msrp_cents, currency, seller_type, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(retailer_id, retailer_sku) DO UPDATE SET
           canonical_url = excluded.canonical_url,
           status = excluded.status,
           execution_supported = excluded.execution_supported,
           seller_type = CASE WHEN excluded.seller_type <> 'unknown' THEN excluded.seller_type ELSE listings.seller_type END,
           estimated_msrp_cents = CASE WHEN excluded.msrp_cents IS NOT NULL THEN NULL ELSE listings.estimated_msrp_cents END,
           msrp_history_json = CASE WHEN excluded.msrp_cents IS NOT NULL
             AND (listings.msrp_cents IS NULL OR listings.msrp_cents <> excluded.msrp_cents)
             THEN '{}' ELSE listings.msrp_history_json END,
           msrp_cents = COALESCE(excluded.msrp_cents, listings.msrp_cents),
           currency = excluded.currency,
           updated_at = excluded.updated_at`,
        listingId,
        variantId,
        normalized.retailerId,
        normalized.retailerSku,
        canonicalUrl,
        listingStatus,
        executionSupported,
        normalized.msrpCents,
        currency,
        normalized.sellerType,
        timestamp,
        timestamp
      );
      this.db.run(
        `INSERT OR IGNORE INTO listing_urls(id, listing_id, kind, url, active, observed_at)
         VALUES (?, ?, 'canonical', ?, 1, ?)`,
        newId("listing_url"),
        listingId,
        normalized.canonicalUrl,
        normalized.observedAt
      );
      if (normalized.sourceListingUrl) {
        this.db.run(
          `INSERT OR IGNORE INTO listing_urls(id, listing_id, kind, url, active, observed_at)
           VALUES (?, ?, 'source_listing', ?, 1, ?)`,
          newId("listing_url"),
          listingId,
          normalized.sourceListingUrl,
          normalized.observedAt
        );
      }

      if (normalized.sourceListingId) {
        const existingSourceListing = this.db.get<{ listing_id: string }>(
          `SELECT listing_id FROM source_listing_refs
           WHERE source_connection_id = ? AND external_listing_id = ?`,
          normalized.sourceConnectionId,
          normalized.sourceListingId
        );
        if (existingSourceListing && existingSourceListing.listing_id !== listingId) {
          throw new DomainConflictError("listing_already_mapped", "The source listing is already mapped to another retailer listing.", {
            sourceListingId: normalized.sourceListingId,
            mappedListingId: existingSourceListing.listing_id
          });
        }
        this.db.run(
          `INSERT INTO source_listing_refs(
             id, source_connection_id, external_listing_id, external_product_id,
             listing_id, source_url, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_connection_id, external_listing_id) DO UPDATE SET
             external_product_id = excluded.external_product_id,
             source_url = excluded.source_url,
             observed_at = excluded.observed_at`,
          newId("source_listing"),
          normalized.sourceConnectionId,
          normalized.sourceListingId,
          normalized.sourceProductId,
          listingId,
          normalized.sourceListingUrl,
          normalized.observedAt
        );
      }
      const existingMission = this.db.get<{ id: string }>(
        "SELECT id FROM missions WHERE user_id = ? AND variant_id = ?",
        currentRequestScope().userId,
        variantId
      );
      if (existingMission) {
        this.db.run(
          `INSERT OR IGNORE INTO mission_targets(
             id, mission_id, listing_id, enabled, max_unit_price_cents,
             currency, seller_policy, fulfillment, created_at, updated_at
           ) VALUES (?, ?, ?, 0, NULL, ?, 'inherit', 'inherit', ?, ?)`,
          newId("mission_target"),
          existingMission.id,
          listingId,
          normalized.currency,
          timestamp,
          timestamp
        );
      }
      if (normalized.source !== "user_link") {
        this.db.run(
          `INSERT INTO offer_observations(
             id, listing_id, source_connection_id, availability, unit_price_cents,
             currency, seller_type, observed_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId("offer_observation"),
          listingId,
          normalized.sourceConnectionId,
          normalized.listingStatus,
          normalized.observedPriceCents,
          normalized.currency,
          normalized.sellerType,
          normalized.observedAt,
          timestamp
        );
        this.db.run(
          `UPDATE source_connections SET status = 'connected', last_event_at = ?, updated_at = ? WHERE id = ?`,
          normalized.observedAt,
          timestamp,
          normalized.sourceConnectionId
        );
      }
      return {
        listing: this.requireListing(listingId),
        createdVariant,
        createdListing
      };
    });
  }

  resolve(signal: NormalizedSignal): ResolutionResult {
    if (signal.identity.sourceListingId) {
      const row = this.db.get<ListingRow>(
        `SELECT l.id, l.variant_id, v.title, l.retailer_id, l.retailer_sku,
                l.canonical_url, l.execution_supported, l.msrp_cents, l.currency
         FROM source_listing_refs ref
         JOIN listings l ON l.id = ref.listing_id
         JOIN variants v ON v.id = l.variant_id
         WHERE ref.source_connection_id = ? AND ref.external_listing_id = ?`,
        signal.sourceConnectionId,
        signal.identity.sourceListingId
      );
      if (row) return { status: "matched", method: "source_listing_id", reason: "Matched the exact source listing reference.", listing: listingContext(row) };
    }
    if (signal.identity.retailerId && signal.identity.retailerSku) {
      const row = this.db.get<ListingRow>(
        `SELECT l.id, l.variant_id, v.title, l.retailer_id, l.retailer_sku,
                l.canonical_url, l.execution_supported, l.msrp_cents, l.currency
         FROM listings l JOIN variants v ON v.id = l.variant_id
         WHERE l.retailer_id = ? AND l.retailer_sku = ?`,
        signal.identity.retailerId,
        signal.identity.retailerSku
      );
      if (row) return { status: "matched", method: "retailer_sku", reason: "Matched the exact retailer and SKU.", listing: listingContext(row) };
    }
    if (signal.identity.sourceProductId && signal.identity.retailerId) {
      const preferred = this.db.get<ListingRow>(
        `SELECT l.id, l.variant_id, v.title, l.retailer_id, l.retailer_sku,
                l.canonical_url, l.execution_supported, l.msrp_cents, l.currency
         FROM source_product_refs product_ref
         JOIN source_variant_retailer_refs preferred
           ON preferred.source_connection_id = product_ref.source_connection_id
          AND preferred.variant_id = product_ref.variant_id
          AND preferred.retailer_id = ?
         JOIN listings l ON l.id = preferred.listing_id
         JOIN variants v ON v.id = l.variant_id
         WHERE product_ref.source_connection_id = ? AND product_ref.external_product_id = ?`,
        signal.identity.retailerId,
        signal.sourceConnectionId,
        signal.identity.sourceProductId
      );
      if (preferred) {
        return { status: "matched", method: "source_product_preferred_retailer", reason: "Matched the preferred exact retailer route for this source product.", listing: listingContext(preferred) };
      }
      const rows = this.db.all<ListingRow>(
        `SELECT l.id, l.variant_id, v.title, l.retailer_id, l.retailer_sku,
                l.canonical_url, l.execution_supported, l.msrp_cents, l.currency
         FROM source_product_refs ref
         JOIN variants v ON v.id = ref.variant_id
         JOIN listings l ON l.variant_id = v.id
         WHERE ref.source_connection_id = ? AND ref.external_product_id = ?
           AND l.retailer_id = ?`,
        signal.sourceConnectionId,
        signal.identity.sourceProductId,
        signal.identity.retailerId
      );
      if (rows.length === 1 && rows[0]) {
        return { status: "matched", method: "source_product_retailer", reason: "Matched the unique source product and retailer listing.", listing: listingContext(rows[0]) };
      }
      if (rows.length > 1) {
        return { status: "ambiguous", method: "source_product_retailer", reason: "Multiple same-retailer listings exist for this source product; an exact listing ID or SKU is required.", listing: null };
      }
    }
    const trackalackerSlug = signal.identity.globalIdentifiers.trackalacker_slug?.toLocaleLowerCase("en-US") ?? "";
    if (trackalackerSlug && signal.identity.retailerId) {
      const preferred = this.db.get<ListingRow>(
        `SELECT l.id, l.variant_id, v.title, l.retailer_id, l.retailer_sku,
                l.canonical_url, l.execution_supported, l.msrp_cents, l.currency
         FROM source_product_aliases alias
         JOIN source_variant_retailer_refs preferred
           ON preferred.source_connection_id = alias.source_connection_id
          AND preferred.variant_id = alias.variant_id
          AND preferred.retailer_id = ?
         JOIN listings l ON l.id = preferred.listing_id
         JOIN variants v ON v.id = l.variant_id
         WHERE alias.source_connection_id = ? AND alias.alias_kind = 'trackalacker_slug'
           AND alias.alias_value = ?`,
        signal.identity.retailerId,
        signal.sourceConnectionId,
        trackalackerSlug
      );
      if (preferred) {
        return { status: "matched", method: "source_product_slug_preferred_retailer", reason: "Matched the preferred exact retailer route for this TrackaLacker product slug.", listing: listingContext(preferred) };
      }
      const rows = this.db.all<ListingRow>(
        `SELECT l.id, l.variant_id, v.title, l.retailer_id, l.retailer_sku,
                l.canonical_url, l.execution_supported, l.msrp_cents, l.currency
         FROM source_product_aliases alias
         JOIN variants v ON v.id = alias.variant_id
         JOIN listings l ON l.variant_id = v.id
         WHERE alias.source_connection_id = ? AND alias.alias_kind = 'trackalacker_slug'
           AND alias.alias_value = ? AND l.retailer_id = ?`,
        signal.sourceConnectionId,
        trackalackerSlug,
        signal.identity.retailerId
      );
      if (rows.length === 1 && rows[0]) {
        return { status: "matched", method: "source_product_slug_retailer", reason: "Matched the unique TrackaLacker product slug and retailer listing.", listing: listingContext(rows[0]) };
      }
      if (rows.length > 1) {
        return { status: "ambiguous", method: "source_product_slug_retailer", reason: "Multiple same-retailer listings exist for this TrackaLacker product slug; an exact listing ID or SKU is required.", listing: null };
      }
    }
    return { status: "unresolved", method: "none", reason: "No exact source-listing or retailer-SKU mapping matched the signal.", listing: null };
  }

  requireListing(id: string): ListingContext {
    const row = this.db.get<ListingRow>(
      `SELECT l.id, l.variant_id, v.title, l.retailer_id, l.retailer_sku,
              l.canonical_url, l.execution_supported, l.msrp_cents, l.currency
       FROM listings l JOIN variants v ON v.id = l.variant_id WHERE l.id = ?`,
      id
    );
    if (!row) throw new Error("The retailer listing no longer exists.");
    return listingContext(row);
  }

  listLibrary(limit = 500, offset = 0, search = "", listingIds?: string[]): Array<Record<string, unknown>> {
    const ids = listingIds ? [...new Set(listingIds)].slice(0, 500) : null;
    if (ids && !ids.length) return [];
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 500)));
    const safeOffset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT v.id AS variantId, v.title, l.id AS listingId, l.retailer_id AS retailerId,
              r.display_name AS retailerName, l.retailer_sku AS retailerSku,
              l.canonical_url AS canonicalUrl, l.status,
              l.execution_supported AS executionSupported, l.msrp_cents AS msrpCents,
              l.estimated_msrp_cents AS estimatedMsrpCents, l.msrp_history_json AS msrpHistoryJson,
              l.currency, l.seller_type AS sellerType, l.offer_role AS offerRole,
              v.image_url AS imageUrl, v.attributes_json AS variantAttributesJson,
              v.msrp_cents AS productMsrpCents, f.brand,
              ${libraryObservationColumns},
              l.updated_at AS updatedAt,
              COUNT(slr.id) AS sourceMappingCount
       FROM variants v
       JOIN product_families f ON f.id = v.family_id
       JOIN listings l ON l.variant_id = v.id
       JOIN retailers r ON r.id = l.retailer_id
       LEFT JOIN source_listing_refs slr ON slr.listing_id = l.id
       ${libraryObservationJoins}
       WHERE (? = '' OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR r.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE)
       ${ids ? `AND l.id IN (${ids.map(() => "?").join(",")})` : ""}
       GROUP BY l.id
       ORDER BY v.title COLLATE NOCASE, r.display_name COLLATE NOCASE, l.retailer_sku
       LIMIT ? OFFSET ?`,
      ...libraryObservationParameters(),
      query,
      pattern,
      pattern,
      pattern,
      ...(ids ?? []),
      safeLimit,
      safeOffset
    );
    return rows.map((row) => {
      let variantAttributes: Record<string, string> = {};
      try {
        const parsed = JSON.parse(String(row.variantAttributesJson ?? "{}")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          variantAttributes = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          );
        }
      } catch {
        variantAttributes = {};
      }
      const { variantAttributesJson: _discarded, msrpHistoryJson: _history, ...item } = row;
      return {
        ...item,
        msrpReference: storedHistoryReference(row),
        priceSource: publicObservationSource(row.priceSource),
        availabilitySource: publicObservationSource(row.availabilitySource),
        executionSupported: Number(row.executionSupported) === 1,
        variantAttributes
      };
    });
  }

  libraryCount(search = ""): number {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM listings l
       JOIN variants v ON v.id = l.variant_id
       JOIN retailers r ON r.id = l.retailer_id
       WHERE (? = '' OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR r.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      query,
      pattern,
      pattern,
      pattern
    )?.count ?? 0);
  }

  listLibraryProducts(
    limit = 100,
    offset = 0,
    input: LibraryProductFilterInput | string = {},
    variantId = ""
  ): LibraryProduct[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
    const safeOffset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
    const query = libraryProductQueryParts(input, variantId);
    const variants = this.db.all<{
      variantId: string;
      familyId: string;
      title: string;
      brand: string;
      imageUrl: string;
      variantAttributesJson: string;
      msrpCents: number | null;
      createdAt: string;
      bestPriceCents: number | null;
      lastActivityAt: string | null;
      collectionVariantId: string;
    }>(
      `${query.cte}
       SELECT v.id AS variantId, v.family_id AS familyId, v.title, f.brand,
              v.image_url AS imageUrl, v.attributes_json AS variantAttributesJson,
              v.msrp_cents AS msrpCents, v.collection_variant_id AS collectionVariantId,
              v.created_at AS createdAt, facts.bestPriceCents, facts.lastActivityAt
       FROM variants v
       JOIN product_families f ON f.id = v.family_id
       JOIN variant_facts facts ON facts.variantId = v.id
       ${query.where}
       ORDER BY ${query.orderBy}
       LIMIT ? OFFSET ?`,
      ...query.parameters,
      safeLimit,
      safeOffset
    );
    if (!variants.length) return [];
    const variantIds = variants.map((variant) => variant.variantId);
    const placeholders = variantIds.map(() => "?").join(", ");
    const listingRows = this.db.all<Record<string, unknown>>(
      `SELECT l.variant_id AS variantId, l.id AS listingId, l.retailer_id AS retailerId,
              r.display_name AS retailerName, l.retailer_sku AS retailerSku,
              l.canonical_url AS canonicalUrl, l.status,
              l.execution_supported AS executionSupported, l.msrp_cents AS msrpCents,
              l.estimated_msrp_cents AS estimatedMsrpCents, l.msrp_history_json AS msrpHistoryJson,
              l.currency, l.seller_type AS sellerType, l.offer_role AS offerRole,
              l.updated_at AS updatedAt,
              ${libraryObservationColumns}
       FROM listings l
       JOIN retailers r ON r.id = l.retailer_id
       ${libraryObservationJoins}
       WHERE l.variant_id IN (${placeholders})
         AND l.offer_role <> 'hidden'
         ${query.filters.retailerId ? "AND l.retailer_id = ?" : ""}
       ORDER BY r.display_name COLLATE NOCASE,
                CASE l.offer_role WHEN 'primary' THEN 0 ELSE 1 END, l.retailer_sku`,
      ...libraryObservationParameters(),
      ...variantIds,
      ...(query.filters.retailerId ? [query.filters.retailerId] : [])
    );
    const listingsByVariant = new Map<string, LibraryProductListing[]>();
    for (const row of listingRows) {
      const key = String(row.variantId);
      const listing: LibraryProductListing = {
        listingId: String(row.listingId),
        retailerId: String(row.retailerId),
        retailerName: String(row.retailerName),
        retailerSku: String(row.retailerSku),
        canonicalUrl: String(row.canonicalUrl),
        status: String(row.status) as Availability,
        purchasable: isPurchasableAvailability(row.status),
        executionSupported: Number(row.executionSupported) === 1,
        sellerType: normalizeSellerType(row.sellerType),
        offerRole: row.offerRole === "alternate" ? "alternate" : "primary",
        msrpCents: row.msrpCents === null ? null : Number(row.msrpCents),
        estimatedMsrpCents: row.estimatedMsrpCents === null ? null : Number(row.estimatedMsrpCents),
        msrpReference: storedHistoryReference(row),
        currency: String(row.currency),
        currentPriceCents: row.currentPriceCents === null ? null : Number(row.currentPriceCents),
        priceObservedAt: row.priceObservedAt === null ? null : String(row.priceObservedAt),
        priceSource: publicObservationSource(row.priceSource),
        observedAvailability: row.observedAvailability === null ? null : String(row.observedAvailability) as Availability,
        availabilityObservedAt: row.availabilityObservedAt === null ? null : String(row.availabilityObservedAt),
        availabilitySource: publicObservationSource(row.availabilitySource),
        updatedAt: String(row.updatedAt)
      };
      const bucket = listingsByVariant.get(key);
      if (bucket) bucket.push(listing);
      else listingsByVariant.set(key, [listing]);
    }
    const otherStoresByVariant = this.otherStoresForVariants(variantIds, query.filters.retailerId);
    const collectionFacts = this.collectionFacts(variantIds, variants.map((variant) => variant.collectionVariantId).filter(Boolean));
    return variants.map((variant) => {
      let variantAttributes: Record<string, string> = {};
      try {
        const parsed = JSON.parse(String(variant.variantAttributesJson ?? "{}")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          variantAttributes = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          );
        }
      } catch {
        variantAttributes = {};
      }
      const listings = listingsByVariant.get(variant.variantId) ?? [];
      const inStock = listings.filter((listing) => listing.status === "in_stock");
      const preorder = listings.filter((listing) => listing.status === "preorder");
      const outOfStock = listings.filter((listing) => listing.status === "out_of_stock");
      const purchasable = listings.filter((listing) => isPurchasableAvailability(listing.status));
      const stores = groupListingsByStore(listings);
      const otherStores = otherStoresByVariant.get(variant.variantId) ?? [];
      const collection = !variant.collectionVariantId && isAllNewCollectionTitle(variant.title)
        ? { itemCount: collectionFacts.itemCounts.get(variant.variantId) ?? 0,
          wanted: collectionFacts.wants.has(variant.variantId), mode: collectionFacts.wants.get(variant.variantId)?.mode ?? "" as const }
        : null;
      return {
        ...(collection ? { collection } : {}),
        ...(variant.collectionVariantId ? { collectionVariantId: variant.collectionVariantId,
          collectionTitle: collectionFacts.titles.get(variant.collectionVariantId) ?? "" } : {}),
        variantId: variant.variantId,
        familyId: variant.familyId,
        title: variant.title,
        brand: variant.brand,
        // An item with no picture of its own yet shows its entry's.
        imageUrl: variant.imageUrl || (variant.collectionVariantId ? collectionFacts.images.get(variant.collectionVariantId) ?? "" : ""),
        variantAttributes,
        msrpCents: variant.msrpCents === null ? null : Number(variant.msrpCents),
        createdAt: variant.createdAt,
        storeCount: stores.length,
        listingCount: listings.length,
        availableListingCount: purchasable.length,
        inStockListingCount: inStock.length,
        preorderListingCount: preorder.length,
        outOfStockListingCount: outOfStock.length,
        bestPriceCents: variant.bestPriceCents === null ? null : Number(variant.bestPriceCents),
        currency: String(listings[0]?.currency ?? "USD"),
        lastActivityAt: variant.lastActivityAt || null,
        stores,
        otherStores,
        otherStoreCount: otherStores.length,
        listings
      };
    });
  }

  /** "All New …" entries on this page: their item counts, the entries the shopper wants, and items' entry names. */
  private collectionFacts(variantIds: string[], parentIds: string[]): {
    itemCounts: Map<string, number>; titles: Map<string, string>; images: Map<string, string>; wants: Map<string, CollectionWant>;
  } {
    const itemCounts = new Map<string, number>();
    const titles = new Map<string, string>();
    const images = new Map<string, string>();
    if (variantIds.length) {
      for (const row of this.db.all<{ id: string; count: number }>(
        `SELECT collection_variant_id AS id, COUNT(*) AS count FROM variants
         WHERE collection_variant_id IN (${variantIds.map(() => "?").join(", ")}) GROUP BY collection_variant_id`, ...variantIds)) {
        itemCounts.set(row.id, Number(row.count));
      }
    }
    if (parentIds.length) {
      for (const row of this.db.all<{ id: string; title: string; imageUrl: string }>(
        `SELECT id, title, image_url AS imageUrl FROM variants WHERE id IN (${parentIds.map(() => "?").join(", ")})`, ...parentIds)) {
        titles.set(row.id, row.title);
        images.set(row.id, row.imageUrl);
      }
    }
    return { itemCounts, titles, images, wants: new Map(collectionWants(this.db).map((want) => [want.variantId, want])) };
  }

  // Stores the source reports for these products that have no registered retailer
  // listing yet. They are monitor-only, scoped to the caller's own source connection,
  // and collapsed to one row per store name so the product's store list stays honest.
  private otherStoresForVariants(variantIds: string[], retailerId = ""): Map<string, LibraryProductOtherStore[]> {
    const grouped = new Map<string, LibraryProductOtherStore[]>();
    if (!variantIds.length || retailerId) return grouped;
    const placeholders = variantIds.map(() => "?").join(", ");
    const rows = this.db.all<{
      variantId: string;
      storeName: string;
      availability: string;
      unitPriceCents: number | null;
      outboundUrl: string;
      sourceUrl: string;
      observedAt: string;
    }>(
      `SELECT c.variant_id AS variantId, c.store_name AS storeName, c.availability,
              c.unit_price_cents AS unitPriceCents, c.outbound_url AS outboundUrl,
              c.source_url AS sourceUrl, c.observed_at AS observedAt
       FROM source_listing_candidates c
       WHERE c.variant_id IN (${placeholders})
         AND c.source_connection_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM source_listing_refs mapped
           WHERE mapped.source_connection_id = c.source_connection_id
             AND mapped.external_listing_id = c.external_listing_id
         )
         -- Only stores the source still reported in its latest sync of this product.
         AND c.observed_at >= (
           SELECT MAX(latest.observed_at) FROM source_listing_candidates latest
           WHERE latest.variant_id = c.variant_id AND latest.source_connection_id = c.source_connection_id
         )
       ORDER BY c.variant_id, c.store_name COLLATE NOCASE, c.observed_at DESC, c.id`,
      ...variantIds,
      scopedSourceConnectionId("trackalacker")
    );
    const rank = (availability: string, price: number | null): number =>
      (isPurchasableAvailability(availability) ? 0 : availability === "unknown" ? 1 : 2) * 1_000_000_000
      + (price ?? 999_999_999);
    for (const row of rows) {
      const bucket = grouped.get(row.variantId) ?? [];
      const key = row.storeName.toLocaleLowerCase("en-US");
      const existing = bucket.find((store) => store.storeName.toLocaleLowerCase("en-US") === key);
      const candidate: LibraryProductOtherStore = {
        storeName: row.storeName,
        availability: (["in_stock", "preorder", "out_of_stock"].includes(row.availability) ? row.availability : "unknown") as Availability,
        unitPriceCents: row.unitPriceCents === null ? null : Number(row.unitPriceCents),
        currency: "USD",
        url: row.outboundUrl || row.sourceUrl,
        observedAt: row.observedAt
      };
      if (!existing) bucket.push(candidate);
      else if (rank(candidate.availability, candidate.unitPriceCents) < rank(existing.availability, existing.unitPriceCents)) {
        bucket[bucket.indexOf(existing)] = candidate;
      }
      grouped.set(row.variantId, bucket);
    }
    return grouped;
  }

  libraryProductCount(input: LibraryProductFilterInput | string = {}, variantId = ""): number {
    const query = libraryProductQueryParts(input, variantId);
    return Number(this.db.get<{ count: number }>(
      `${query.cte}
       SELECT COUNT(*) AS count
       FROM variants v
       JOIN variant_facts facts ON facts.variantId = v.id
       ${query.where}`,
      ...query.parameters
    )?.count ?? 0);
  }

  libraryProductStoreFacets(): Array<{ retailerId: string; retailerName: string; productCount: number }> {
    return this.db.all<{ retailerId: string; retailerName: string; productCount: number }>(
      `SELECT r.id AS retailerId, r.display_name AS retailerName,
              COUNT(DISTINCT l.variant_id) AS productCount
       FROM listings l JOIN retailers r ON r.id = l.retailer_id
       WHERE l.offer_role <> 'hidden'
       GROUP BY r.id, r.display_name
       ORDER BY r.display_name COLLATE NOCASE, r.id`
    ).map((row) => ({ ...row, productCount: Number(row.productCount) }));
  }

  createListingFromExactSignal(signal: NormalizedSignal): CatalogUpsertResult | null {
    const connection = this.sourceConnection(signal.sourceConnectionId);
    if (
      !connection
      || connection.auto_create_missions !== 1
      || connection.trust_level !== "trusted_exact"
      || !signal.identity.sourceProductId
      || !signal.identity.retailerId
      || !signal.identity.retailerSku
      || !signal.identity.canonicalUrl
      || !signal.identity.title
    ) return null;
    return this.upsertListing({
      sourceConnectionId: signal.sourceConnectionId,
      source: signal.source,
      sourceProductId: signal.identity.sourceProductId,
      sourceListingId: signal.identity.sourceListingId,
      sourceProductAliases: signal.identity.globalIdentifiers.trackalacker_slug
        ? { trackalacker_slug: signal.identity.globalIdentifiers.trackalacker_slug.toLocaleLowerCase("en-US") }
        : {},
      title: signal.identity.title,
      ...(isAllNewCollectionTitle(signal.identity.title) ? { itemTitle: itemTitleFromUrl(signal.identity.canonicalUrl) } : {}),
      retailerId: signal.identity.retailerId,
      retailerSku: signal.identity.retailerSku,
      canonicalUrl: signal.identity.canonicalUrl,
      listingStatus: signal.offer.availability,
      executionSupported: true,
      observedPriceCents: signal.offer.unitPriceCents,
      currency: signal.offer.currency,
      observedAt: signal.observedAt
    });
  }

  /**
   * Every TrackaLacker listing Yoink has seen, with its store item and when its
   * History was last read, so a sync skips lookups it has already done.
   */
  trackalackerKnownListings(): Record<string, TrackalackerKnownListing> {
    const trackalackerSourceId = scopedSourceConnectionId("trackalacker");
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT c.external_listing_id AS id, c.retailer_id AS candidateRetailer, c.retailer_sku AS candidateSku,
              c.outbound_url AS outboundUrl, c.history_checked_at AS historyCheckedAt,
              l.retailer_id AS listingRetailer, l.retailer_sku AS listingSku, l.canonical_url AS canonicalUrl,
              l.msrp_cents AS msrpCents, l.estimated_msrp_cents AS estimatedMsrpCents, l.msrp_history_json AS msrpHistoryJson
       FROM source_listing_candidates c
       LEFT JOIN source_listing_refs r
         ON r.source_connection_id = c.source_connection_id AND r.external_listing_id = c.external_listing_id
       LEFT JOIN listings l ON l.id = r.listing_id
       WHERE c.source_connection_id = ?`,
      trackalackerSourceId
    );
    const known: Record<string, TrackalackerKnownListing> = {};
    for (const row of rows) {
      const retailerSku = String(row.listingSku || row.candidateSku || "");
      const canonicalUrl = retailerSku ? String(row.canonicalUrl || "") : "";
      const referenceAt = storedHistoryReference(row)?.observedAt ?? "";
      const checkedAt = String(row.historyCheckedAt || "");
      known[String(row.id)] = {
        retailerId: String(row.listingRetailer || row.candidateRetailer || ""),
        retailerSku: canonicalUrl ? retailerSku : "",
        canonicalUrl,
        outboundUrl: String(row.outboundUrl || ""),
        historyCheckedAt: Date.parse(referenceAt) > Date.parse(checkedAt || "0") ? referenceAt : checkedAt
      };
    }
    return known;
  }

  /** TrackaLacker products whose Yoink product has a picture. */
  trackalackerProductsWithImages(): string[] {
    return this.db.all<{ id: string }>(
      `SELECT spr.external_product_id AS id FROM source_product_refs spr
       JOIN variants v ON v.id = spr.variant_id
       WHERE spr.source_connection_id = ? AND v.image_url <> ''`,
      scopedSourceConnectionId("trackalacker")
    ).map((row) => row.id);
  }

  upsertTrackalackerItem(input: TrackalackerCatalogItemInput, now = Date.now()): TrackalackerCatalogUpsertResult {
    const trackalackerSourceId = scopedSourceConnectionId("trackalacker");
    const sourceProductId = cleanText(input?.sourceProductId, 120);
    const sourceProductSlug = cleanText(input?.sourceProductSlug, 240).toLocaleLowerCase("en-US");
    const title = cleanText(input?.title, 300);
    const observed = new Date(input?.observedAt || now);
    const sourceProductUrl = input?.sourceProductUrl ? safeHttpsUrl(input.sourceProductUrl) : "";
    if (!sourceProductId || !title || !sourceProductUrl || Number.isNaN(observed.getTime()) || observed.getTime() > now + 5 * 60_000) {
      throw new Error("The TrackaLacker catalog product is incomplete.");
    }
    const productUrl = new URL(sourceProductUrl);
    if (!["trackalacker.com", "www.trackalacker.com"].includes(productUrl.hostname.toLocaleLowerCase("en-US"))) {
      throw new Error("The source product URL must belong to TrackaLacker.");
    }
    if (sourceProductSlug && !/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(sourceProductSlug)) {
      throw new Error("The TrackaLacker product slug is invalid.");
    }
    const listings = Array.isArray(input.listings) ? input.listings : [];
    const msrpCents = positiveCents(input.msrpCents, true);
    const observedAt = observed.toISOString();
    let imageUrl = "";
    if (input?.imageUrl) {
      try {
        imageUrl = safeHttpsUrl(cleanText(input.imageUrl, 2_048));
      } catch {
        imageUrl = "";
      }
    }

    return this.db.transaction(() => {
      let variantId = this.db.get<{ variant_id: string }>(
        `SELECT variant_id FROM source_product_refs
         WHERE source_connection_id = '${trackalackerSourceId}' AND external_product_id = ?`,
        sourceProductId
      )?.variant_id ?? "";
      if (!variantId && sourceProductSlug) {
        variantId = this.db.get<{ variant_id: string }>(
          `SELECT variant_id FROM source_product_aliases
           WHERE source_connection_id = '${trackalackerSourceId}'
             AND alias_kind = 'trackalacker_slug' AND alias_value = ?`,
          sourceProductSlug
        )?.variant_id ?? "";
      }
      // An "All New …" entry never borrows one of its items' products.
      if (!variantId && !isAllNewCollectionTitle(title)) {
        const exactListing = listings.find((listing) => listing.retailerId && listing.retailerSku);
        if (exactListing) {
          variantId = this.db.get<{ variant_id: string }>(
            "SELECT variant_id FROM listings WHERE retailer_id = ? AND retailer_sku = ?",
            cleanText(exactListing.retailerId, 60).toLocaleLowerCase("en-US"),
            cleanText(exactListing.retailerSku, 64).toUpperCase()
          )?.variant_id ?? "";
        }
      }
      const inferredBrand = inferBrandFromTitle(title);
      if (!variantId) {
        const timestamp = nowIso(now);
        const familyId = newId("family");
        variantId = newId("variant");
        this.db.run(
          "INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          familyId,
          title,
          inferredBrand,
          timestamp,
          timestamp
        );
        this.db.run(
          "INSERT INTO variants(id, family_id, title, attributes_json, image_url, msrp_cents, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?, ?, ?)",
          variantId,
          familyId,
          title,
          imageUrl,
          msrpCents,
          timestamp,
          timestamp
        );
      } else {
        if (imageUrl) {
          this.db.run(
            "UPDATE variants SET image_url = ?, updated_at = ? WHERE id = ? AND image_url <> ?",
            imageUrl,
            nowIso(now),
            variantId,
            imageUrl
          );
        }
        // MSRP is a product fact reported by the source; it lives on the variant so
        // every store shares one reference instead of each listing carrying a copy.
        if (msrpCents !== null) {
          this.db.run(
            "UPDATE variants SET msrp_cents = ?, updated_at = ? WHERE id = ? AND (msrp_cents IS NULL OR msrp_cents <> ?)",
            msrpCents,
            nowIso(now),
            variantId,
            msrpCents
          );
        }
        if (inferredBrand) {
          this.db.run(
            "UPDATE product_families SET brand = ?, updated_at = ? WHERE brand = '' AND id = (SELECT family_id FROM variants WHERE id = ?)",
            inferredBrand,
            nowIso(now),
            variantId
          );
        }
      }
      const productMsrpCents = msrpCents ?? this.db.get<{ msrp_cents: number | null }>(
        "SELECT msrp_cents FROM variants WHERE id = ?",
        variantId
      )?.msrp_cents ?? null;
      this.db.run(
        `INSERT INTO source_product_refs(
           id, source_connection_id, external_product_id, variant_id, source_url, source_title, observed_at
         ) VALUES (?, '${trackalackerSourceId}', ?, ?, ?, ?, ?)
         ON CONFLICT(source_connection_id, external_product_id) DO UPDATE SET
           source_url = excluded.source_url, source_title = excluded.source_title, observed_at = excluded.observed_at`,
        newId("source_product"),
        sourceProductId,
        variantId,
        sourceProductUrl,
        title,
        observedAt
      );
      if (sourceProductSlug) {
        const existing = this.db.get<{ variant_id: string }>(
          `SELECT variant_id FROM source_product_aliases
           WHERE source_connection_id = '${trackalackerSourceId}'
             AND alias_kind = 'trackalacker_slug' AND alias_value = ?`,
          sourceProductSlug
        );
        if (existing && existing.variant_id !== variantId) throw new Error("The TrackaLacker slug maps to another exact product.");
        this.db.run(
          `INSERT INTO source_product_aliases(
             id, source_connection_id, alias_kind, alias_value, variant_id, observed_at
           ) VALUES (?, '${trackalackerSourceId}', 'trackalacker_slug', ?, ?, ?)
           ON CONFLICT(source_connection_id, alias_kind, alias_value) DO UPDATE SET observed_at = excluded.observed_at`,
          newId("source_alias"),
          sourceProductSlug,
          variantId,
          observedAt
        );
      }

      let candidatesAccepted = 0;
      let listingsMapped = 0;
      let listingsCreated = 0;
      const preferredByRetailer = new Map<string, { listingId: string; score: number }>();
      const seen = new Set<string>();
      let listingOrder = 0;
      for (const raw of listings) {
        listingOrder += 1;
        const sourceListingId = cleanText(raw?.sourceListingId, 120);
        const storeName = cleanText(raw?.storeName, 120);
        if (!sourceListingId || !storeName || seen.has(sourceListingId)) continue;
        seen.add(sourceListingId);
        const sourceListingUrl = raw.sourceListingUrl ? safeHttpsUrl(raw.sourceListingUrl) : "";
        if (!sourceListingUrl || !["trackalacker.com", "www.trackalacker.com"].includes(new URL(sourceListingUrl).hostname.toLocaleLowerCase("en-US"))) continue;
        const retailerId = cleanText(raw.retailerId, 60).toLocaleLowerCase("en-US").replace(/[^a-z0-9_-]/g, "");
        const retailerSku = cleanText(raw.retailerSku, 64).toUpperCase();
        const outboundUrl = raw.outboundUrl ? safeHttpsUrl(raw.outboundUrl) : "";
        const availability = ["in_stock", "preorder", "out_of_stock", "unknown"].includes(String(raw.availability))
          ? String(raw.availability)
          : "unknown";
        const unitPriceCents = positiveCents(raw.unitPriceCents, true);
        const explicitSellerType = normalizeSellerType(raw.sellerType);
        const sellerType: ListingSellerType = explicitSellerType !== "unknown"
          ? explicitSellerType
          : sellerTypeForName(retailerId, raw.sellerName);
        this.db.run(
          `INSERT INTO source_listing_candidates(
             id, source_connection_id, external_product_id, external_listing_id, variant_id,
             store_name, retailer_id, retailer_sku, source_url, outbound_url,
             availability, unit_price_cents, observed_at, updated_at
           ) VALUES (?, '${trackalackerSourceId}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_connection_id, external_listing_id) DO UPDATE SET
             external_product_id = excluded.external_product_id,
             variant_id = excluded.variant_id,
             store_name = excluded.store_name,
             retailer_id = excluded.retailer_id,
             retailer_sku = excluded.retailer_sku,
             source_url = excluded.source_url,
             outbound_url = excluded.outbound_url,
             availability = excluded.availability,
             unit_price_cents = excluded.unit_price_cents,
             observed_at = excluded.observed_at,
             updated_at = excluded.updated_at`,
          newId("source_candidate"),
          sourceProductId,
          sourceListingId,
          variantId,
          storeName,
          retailerId,
          retailerSku,
          sourceListingUrl,
          outboundUrl,
          availability,
          unitPriceCents,
          observedAt,
          nowIso(now)
        );
        if (raw.historyChecked === true) {
          this.db.run(
            `UPDATE source_listing_candidates SET history_checked_at = ?
             WHERE source_connection_id = '${trackalackerSourceId}' AND external_listing_id = ?`,
            nowIso(now), sourceListingId
          );
        }
        candidatesAccepted += 1;
        if (!retailerId || !retailerSku || !raw.canonicalUrl) continue;
        const existingPrice = this.db.get<Record<string, unknown>>(
          `SELECT msrp_cents AS msrpCents, estimated_msrp_cents AS estimatedMsrpCents,
                  msrp_history_json AS msrpHistoryJson FROM listings WHERE retailer_id = ? AND retailer_sku = ?`,
          retailerId, retailerSku
        );
        const existingHistory = existingPrice ? storedHistoryReference(existingPrice) : null;
        const mapped = this.upsertListing({
          sourceConnectionId: trackalackerSourceId,
          source: "trackalacker",
          sourceProductId,
          sourceListingId,
          sourceProductAliases: sourceProductSlug ? { trackalacker_slug: sourceProductSlug } : {},
          sourceProductUrl,
          sourceListingUrl,
          title,
          // An "All New …" item is named from its own store link.
          ...(isAllNewCollectionTitle(title) ? { itemTitle: itemTitleFromUrl(raw.outboundUrl) || itemTitleFromUrl(raw.canonicalUrl) } : {}),
          retailerId,
          retailerSku,
          canonicalUrl: raw.canonicalUrl,
          listingStatus: availability as "in_stock" | "preorder" | "out_of_stock" | "unknown",
          sellerType,
          executionSupported: ["target", "walmart", "amazon", "bestbuy", "pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(retailerId),
          // A listing's dated History reference takes precedence over the
          // product-wide field. Update it below only with eligible newer evidence.
          // An entry's own price is not its items' MSRP.
          msrpCents: existingHistory?.kind === "reported_msrp" || isAllNewCollectionTitle(title) ? null : msrpCents,
          observedPriceCents: unitPriceCents,
          currency: "USD",
          observedAt
        }, now);
        const reference = validateHistoryReference(raw.msrpReference, sourceListingUrl, sourceListingId, now);
        if (reference) {
          const stored = this.db.get<Record<string, unknown>>(
            `SELECT msrp_cents AS msrpCents, estimated_msrp_cents AS estimatedMsrpCents,
                    msrp_history_json AS msrpHistoryJson FROM listings WHERE id = ?`, mapped.listing.id
          )!;
          const previous = storedHistoryReference(stored);
          const older = previous?.kind === reference.kind
            && previous.timeZone === reference.timeZone
            && Number(historyTimeOrder(previous.reportedAt)) > Number(historyTimeOrder(reference.reportedAt));
          const conflict = previous?.kind === reference.kind && previous.timeZone === reference.timeZone
            && historyTimeOrder(previous.reportedAt) === historyTimeOrder(reference.reportedAt)
            && previous.priceCents !== reference.priceCents;
          if (!older && !conflict && reference.kind === "reported_msrp") {
            this.db.run(`UPDATE listings SET msrp_cents = ?, estimated_msrp_cents = NULL,
              msrp_history_json = ? WHERE id = ?`, reference.priceCents, JSON.stringify(reference), mapped.listing.id);
          } else if (!older && !conflict && reference.kind === "approximate_msrp" && stored.msrpCents === null) {
            this.db.run(`UPDATE listings SET estimated_msrp_cents = ?, msrp_history_json = ? WHERE id = ?`,
              reference.priceCents, JSON.stringify(reference), mapped.listing.id);
          }
        }
        listingsMapped += 1;
        if (mapped.createdListing) listingsCreated += 1;
        // The store's own offer represents the store; a marketplace reseller never
        // does while a first-party listing exists. Prices far above MSRP read as
        // resale and rank below listings near the reference price.
        const priceRatio = productMsrpCents !== null && unitPriceCents !== null ? unitPriceCents / productMsrpCents : null;
        const score = (["in_stock", "preorder"].includes(availability) ? 100 : availability === "unknown" ? 0 : 10)
          + (unitPriceCents !== null ? 20 : 0)
          + (sellerType === "first_party" ? 1000 : sellerType === "third_party" ? -1000 : 0)
          + (priceRatio === null ? 0 : priceRatio <= 1.25 ? 50 : priceRatio >= 2 ? -200 : 0)
          + Math.max(0, 48 - listingOrder);
        const currentPreferred = preferredByRetailer.get(retailerId);
        if (!currentPreferred || score > currentPreferred.score) {
          preferredByRetailer.set(retailerId, { listingId: mapped.listing.id, score });
        }
      }
      for (const [retailerId, preferred] of preferredByRetailer) {
        // One primary offer per store; every other listing there folds under it.
        this.db.run(
          "UPDATE listings SET offer_role = 'primary' WHERE id = ? AND offer_role = 'alternate'",
          preferred.listingId
        );
        this.db.run(
          `UPDATE listings SET offer_role = 'alternate'
           WHERE variant_id = ? AND retailer_id = ? AND id <> ? AND offer_role = 'primary'`,
          variantId,
          retailerId,
          preferred.listingId
        );
        this.db.run(
          `INSERT INTO source_variant_retailer_refs(
             source_connection_id, variant_id, retailer_id, listing_id, observed_at
           ) VALUES ('${trackalackerSourceId}', ?, ?, ?, ?)
           ON CONFLICT(source_connection_id, variant_id, retailer_id) DO UPDATE SET
             listing_id = excluded.listing_id, observed_at = excluded.observed_at`,
          variantId,
          retailerId,
          preferred.listingId,
          observedAt
        );
      }
      this.db.run(
        `UPDATE source_connections SET status = 'connected', last_event_at = ?, updated_at = ?
         WHERE id = '${trackalackerSourceId}'`,
        observedAt,
        nowIso(now)
      );
      return { sourceProductId, variantId, candidatesAccepted, listingsMapped, listingsCreated };
    });
  }

  counts(): Record<string, number> {
    const row = this.db.get<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM variants) AS variants,
         (SELECT COUNT(*) FROM listings) AS listings,
         (SELECT COUNT(*) FROM listings WHERE execution_supported = 1) AS executableListings,
         (SELECT COUNT(*) FROM listings WHERE execution_supported = 0) AS catalogOnlyListings`
    );
    return row ?? { variants: 0, listings: 0, executableListings: 0, catalogOnlyListings: 0 };
  }
}
