import {
  RETAILER_OBSERVER_VERSIONS,
  STOCK_CHECK_MAX_ITEMS,
  type StockCheckReport,
  type StockCheckResult,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { CatalogRepository } from "./catalog-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope, scopedSourceConnectionId } from "./request-scope.js";
import { isTestItemPlaceholderTitle, TestCallRepository } from "./test-call-repository.js";

/** A page that still shows what Chrome last recorded is recorded again only after this long. */
export const STOCK_CHECK_REFRESH_MS = 10 * 60_000;
const MAX_REPORT_AGE_MS = 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const AVAILABILITY = new Set(["in_stock", "preorder", "out_of_stock"]);
const SELLER_TYPES = new Set(["first_party", "third_party", "unknown"]);

interface LatestObservation {
  availability: string;
  priceCents: number | null;
  sellerType: string;
  observedAt: string;
  source: string | null;
}

/** A store page's product name without the store's own prefix or suffix. */
export function pageProductTitle(value: unknown, retailerId: string): string {
  let title = cleanText(value, 400);
  if (retailerId === "amazon") title = title.replace(/^amazon\.com\s*:\s*/i, "").replace(/\s*:\s*[^:]{1,60}$/, "");
  title = title
    .replace(/\s*[-|:]\s*(?:walmart\.com|walmart|target|best buy|bestbuy\.com|amazon\.com)\s*$/i, "")
    .trim();
  return cleanText(title, 200);
}

/**
 * Records the stock Chrome saw on a product page as an observation from the
 * "browser" source, so the catalog, Want it and Test call show it like a
 * call's report. Only items already in the catalog are recorded, and a page
 * that still matches Chrome's last report is written again only every 10 min.
 */
export class StockCheckRepository {
  constructor(private readonly db: YoinkDatabase) {}

  record(items: unknown, now = Date.now()): StockCheckResult[] {
    if (!Array.isArray(items) || items.length > STOCK_CHECK_MAX_ITEMS) {
      throw new InputValidationError(`Send 1 to ${STOCK_CHECK_MAX_ITEMS} stock checks at a time.`);
    }
    return this.db.transaction(() => items.map((item) => this.recordOne(item as StockCheckReport, now)));
  }

  private recordOne(report: StockCheckReport, now: number): StockCheckResult {
    const retailerId = cleanText(report?.retailerId, 40);
    const retailerSku = cleanText(report?.retailerSku, 64).toUpperCase();
    const result = (outcome: StockCheckResult["outcome"], changed = false): StockCheckResult =>
      ({ retailerId, retailerSku, outcome, changed });
    const observedAtMs = Date.parse(String(report?.observedAt ?? ""));
    const price = report?.unitPriceCents === null || report?.unitPriceCents === undefined ? null : Number(report.unitPriceCents);
    if (!Object.hasOwn(RETAILER_OBSERVER_VERSIONS, retailerId) || !retailerSku
      || !AVAILABILITY.has(String(report?.availability)) || !SELLER_TYPES.has(String(report?.sellerType))
      || !["browsing", "cart_add"].includes(String(report?.via))
      || !Number.isFinite(observedAtMs) || observedAtMs > now + MAX_CLOCK_SKEW_MS || observedAtMs < now - MAX_REPORT_AGE_MS
      || (price !== null && (!Number.isSafeInteger(price) || price <= 0 || price > 100_000_000))) {
      return result("rejected");
    }
    const listing = new CatalogRepository(this.db).exactRetailerListing(retailerId as SupportedRetailerId, retailerSku);
    if (!listing) return result("not_in_catalog");
    this.nameTestItem(listing, retailerId, retailerSku, report.title, now);
    const sellerType = String(report.sellerType);
    // Another seller's price isn't the store's: the stock is kept, the price isn't.
    const priceCents = sellerType === "third_party" ? null : price;
    const latest = this.db.get<LatestObservation>(
      `SELECT oo.availability, oo.unit_price_cents AS priceCents, oo.seller_type AS sellerType,
              oo.observed_at AS observedAt, source.source
       FROM offer_observations oo
       LEFT JOIN source_connections source ON source.id = oo.source_connection_id
       WHERE oo.listing_id = ?
       ORDER BY oo.observed_at DESC, oo.id DESC LIMIT 1`,
      listing.id
    );
    const changed = Boolean(latest) && latest!.availability !== report.availability;
    const latestMs = latest ? Date.parse(latest.observedAt) : Number.NaN;
    if (latest && latest.source === "browser" && !changed
      && (latest.priceCents ?? null) === priceCents && latest.sellerType === sellerType
      && observedAtMs >= latestMs && observedAtMs - latestMs < STOCK_CHECK_REFRESH_MS) {
      return result("unchanged");
    }
    const sourceConnectionId = this.ensureBrowserSource(now);
    this.db.run(
      `INSERT INTO offer_observations(
         id, listing_id, source_connection_id, availability, unit_price_cents,
         currency, seller_name, seller_type, observed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?)`,
      newId("offer_observation"),
      listing.id,
      sourceConnectionId,
      report.availability,
      priceCents,
      cleanText(report.sellerName, 160),
      sellerType,
      nowIso(Math.min(observedAtMs, now)),
      nowIso(now)
    );
    return result("recorded", changed);
  }

  /**
   * A linked test item keeps its number as its catalog title, and the name
   * Chrome reads on its page goes on its saved Test call entry instead. The
   * title is part of the identity its saved max price is bound to: renaming it
   * while its add ran turned Kevin's Walmart Test call away at the Add step
   * (2026-10-13, official_msrp_review_required).
   */
  private nameTestItem(listing: { id: string; variantId: string }, retailerId: string, retailerSku: string, value: unknown, now: number): void {
    const title = pageProductTitle(value, retailerId);
    if (!title || isTestItemPlaceholderTitle(title)) return;
    const variant = this.db.get<{ title: string }>("SELECT title FROM variants WHERE id = ?", listing.variantId);
    if (!variant || !isTestItemPlaceholderTitle(variant.title, retailerSku)) return;
    new TestCallRepository(this.db).nameSavedItem(listing.id, title, now);
  }

  private ensureBrowserSource(now: number): string {
    const scope = currentRequestScope();
    const id = scopedSourceConnectionId("browser");
    const timestamp = nowIso(now);
    // The same row the local install seeds; never marked connected, since it delivers no calls.
    this.db.run(
      `INSERT OR IGNORE INTO source_connections(
         id, tenant_id, user_id, source, name, status, trust_level,
         auto_create_missions, is_private, created_at, updated_at
       ) VALUES (?, ?, ?, 'browser', 'Browser observations', 'disconnected', 'trusted_exact', 1, 1, ?, ?)`,
      id, scope.tenantId, scope.userId, timestamp, timestamp
    );
    return id;
  }
}
