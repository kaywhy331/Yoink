import type {
  CatalogListingInput,
  ListingContext,
  NormalizedSignal,
  TrackalackerCatalogItemInput
} from "../../contracts/src/index.js";
import { normalizeCatalogListing, hostnameAllowed } from "../../domain/src/catalog.js";
import type { NormalizedCatalogListing } from "../../domain/src/catalog.js";
import { cleanText, positiveCents, safeHttpsUrl } from "../../domain/src/normalize.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope, scopedSourceConnectionId } from "./request-scope.js";

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

export class CatalogRepository {
  constructor(private readonly db: YoinkDatabase) {}

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
      throw new Error("The catalog source does not match a configured source connection.");
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
      const existingListing = this.db.get<{ id: string; variant_id: string }>(
        "SELECT id, variant_id FROM listings WHERE retailer_id = ? AND retailer_sku = ?",
        normalized.retailerId,
        normalized.retailerSku
      );
      if (productRef && existingListing && productRef.variant_id !== existingListing.variant_id) {
        throw new Error("The source product and retailer SKU currently map to different exact variants.");
      }

      let variantId = productRef?.variant_id ?? existingListing?.variant_id ?? "";
      let createdVariant = false;
      if (!variantId) {
        const familyId = newId("family");
        variantId = newId("variant");
        this.db.run(
          "INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          familyId,
          normalized.title,
          normalized.brand,
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

      const existingProductRef = this.db.get<{ variant_id: string }>(
        "SELECT variant_id FROM source_product_refs WHERE source_connection_id = ? AND external_product_id = ?",
        normalized.sourceConnectionId,
        normalized.sourceProductId
      );
      if (existingProductRef && existingProductRef.variant_id !== variantId) {
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
        variantId,
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
        if (existingAlias && existingAlias.variant_id !== variantId) {
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
          variantId,
          normalized.observedAt
        );
      }

      const listingId = existingListing?.id ?? newId("listing");
      const createdListing = !existingListing;
      const executionSupported = retailer.execution_supported === 1 && normalized.requestedExecutionSupport ? 1 : 0;
      this.db.run(
        `INSERT INTO listings(
           id, variant_id, retailer_id, retailer_sku, canonical_url, status,
           execution_supported, msrp_cents, currency, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(retailer_id, retailer_sku) DO UPDATE SET
           canonical_url = excluded.canonical_url,
           status = excluded.status,
           execution_supported = excluded.execution_supported,
           msrp_cents = COALESCE(excluded.msrp_cents, listings.msrp_cents),
           currency = excluded.currency,
           updated_at = excluded.updated_at`,
        listingId,
        variantId,
        normalized.retailerId,
        normalized.retailerSku,
        normalized.canonicalUrl,
        normalized.listingStatus,
        executionSupported,
        normalized.msrpCents,
        normalized.currency,
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
          throw new Error("The source listing is already mapped to another retailer listing.");
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
             currency, observed_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          newId("offer_observation"),
          listingId,
          normalized.sourceConnectionId,
          normalized.listingStatus,
          normalized.observedPriceCents,
          normalized.currency,
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

  listLibrary(limit = 500, offset = 0, search = ""): Array<Record<string, unknown>> {
    const query = cleanText(search, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 500)));
    const safeOffset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT v.id AS variantId, v.title, l.id AS listingId, l.retailer_id AS retailerId,
              r.display_name AS retailerName, l.retailer_sku AS retailerSku,
              l.canonical_url AS canonicalUrl, l.status,
              l.execution_supported AS executionSupported, l.msrp_cents AS msrpCents,
              l.currency, v.attributes_json AS variantAttributesJson,
              (SELECT oo.unit_price_cents FROM offer_observations oo
               WHERE oo.listing_id = l.id AND oo.unit_price_cents IS NOT NULL
               ORDER BY oo.observed_at DESC LIMIT 1) AS currentPriceCents,
              (SELECT oo.observed_at FROM offer_observations oo
               WHERE oo.listing_id = l.id AND oo.unit_price_cents IS NOT NULL
               ORDER BY oo.observed_at DESC LIMIT 1) AS priceObservedAt,
              l.updated_at AS updatedAt,
              COUNT(slr.id) AS sourceMappingCount
       FROM variants v
       JOIN listings l ON l.variant_id = v.id
       JOIN retailers r ON r.id = l.retailer_id
       LEFT JOIN source_listing_refs slr ON slr.listing_id = l.id
       WHERE (? = '' OR v.title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR r.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR l.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE)
       GROUP BY l.id
       ORDER BY v.title COLLATE NOCASE, r.display_name COLLATE NOCASE, l.retailer_sku
       LIMIT ? OFFSET ?`,
      query,
      pattern,
      pattern,
      pattern,
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
      const { variantAttributesJson: _discarded, ...item } = row;
      return {
        ...item,
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
      if (!variantId) {
        const exactListing = listings.find((listing) => listing.retailerId && listing.retailerSku);
        if (exactListing) {
          variantId = this.db.get<{ variant_id: string }>(
            "SELECT variant_id FROM listings WHERE retailer_id = ? AND retailer_sku = ?",
            cleanText(exactListing.retailerId, 60).toLocaleLowerCase("en-US"),
            cleanText(exactListing.retailerSku, 64).toUpperCase()
          )?.variant_id ?? "";
        }
      }
      if (!variantId) {
        const timestamp = nowIso(now);
        const familyId = newId("family");
        variantId = newId("variant");
        this.db.run(
          "INSERT INTO product_families(id, title, brand, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
          familyId,
          title,
          timestamp,
          timestamp
        );
        this.db.run(
          "INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)",
          variantId,
          familyId,
          title,
          timestamp,
          timestamp
        );
      }
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
        candidatesAccepted += 1;
        if (!retailerId || !retailerSku || !raw.canonicalUrl) continue;
        const mapped = this.upsertListing({
          sourceConnectionId: trackalackerSourceId,
          source: "trackalacker",
          sourceProductId,
          sourceListingId,
          sourceProductAliases: sourceProductSlug ? { trackalacker_slug: sourceProductSlug } : {},
          sourceProductUrl,
          sourceListingUrl,
          title,
          retailerId,
          retailerSku,
          canonicalUrl: raw.canonicalUrl,
          listingStatus: availability as "in_stock" | "preorder" | "out_of_stock" | "unknown",
          executionSupported: ["target", "walmart", "amazon", "bestbuy"].includes(retailerId),
          msrpCents,
          observedPriceCents: unitPriceCents,
          currency: "USD",
          observedAt
        }, now);
        listingsMapped += 1;
        if (mapped.createdListing) listingsCreated += 1;
        const score = (["in_stock", "preorder"].includes(availability) ? 100 : availability === "unknown" ? 0 : 10)
          + (unitPriceCents !== null ? 20 : 0)
          + Math.max(0, 48 - listingOrder);
        const currentPreferred = preferredByRetailer.get(retailerId);
        if (!currentPreferred || score > currentPreferred.score) {
          preferredByRetailer.set(retailerId, { listingId: mapped.listing.id, score });
        }
      }
      for (const [retailerId, preferred] of preferredByRetailer) {
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
