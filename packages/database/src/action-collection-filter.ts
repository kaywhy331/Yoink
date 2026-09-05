import { InputValidationError } from "../../domain/src/input-validation-error.js";
export interface ActionCollectionFilter {
  since?: string;
  until?: string;
  retailerId?: string;
  product?: string;
}

// Filters describe a cohort of jobs by creation time; their outcomes remain current.
export function actionCollectionFilter(params: URLSearchParams, now = Date.now()): ActionCollectionFilter {
  const window = params.get("window") || "all";
  const days: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
  if (window !== "all" && !Object.hasOwn(days, window)) throw new InputValidationError("Choose a supported Insights period.");
  const asOf = params.get("asOf");
  const until = asOf ? Date.parse(asOf) : now;
  if (!Number.isFinite(until) || until > now + 60_000) throw new InputValidationError("The Insights time is invalid.");
  const retailerId = params.get("store") || "";
  if (retailerId && !/^[a-z0-9_-]{1,80}$/.test(retailerId)) throw new InputValidationError("The store filter is invalid.");
  return { since: window === "all" ? "" : new Date(until - days[window]! * 86_400_000).toISOString(),
    until: asOf || window !== "all" ? new Date(until).toISOString() : "",
    retailerId, product: (params.get("product") || "").trim().slice(0, 200) };
}

export function actionCollectionSql(alias: "aj" | "job", filters: ActionCollectionFilter = {}) {
  const clauses: string[] = [];
  const parameters: string[] = [];
  if (filters.since) { clauses.push(`${alias}.created_at >= ?`); parameters.push(filters.since); }
  if (filters.until) { clauses.push(`${alias}.created_at <= ?`); parameters.push(filters.until); }
  if (filters.retailerId) {
    clauses.push(`EXISTS (SELECT 1 FROM listings filter_listing WHERE filter_listing.id = ${alias}.listing_id AND filter_listing.retailer_id = ?)`);
    parameters.push(filters.retailerId);
  }
  if (filters.product) {
    const pattern = `%${filters.product.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(`EXISTS (SELECT 1 FROM listings filter_listing JOIN variants filter_variant ON filter_variant.id = filter_listing.variant_id
      WHERE filter_listing.id = ${alias}.listing_id AND (filter_variant.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR filter_listing.retailer_sku LIKE ? ESCAPE '\\' COLLATE NOCASE))`);
    parameters.push(pattern, pattern);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", parameters };
}
