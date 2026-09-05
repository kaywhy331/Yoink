import { InputValidationError } from "../../domain/src/input-validation-error.js";

export interface PlanCollectionFilter {
  store?: string;
  status?: string;
  action?: string;
  sort?: string;
  now?: number;
}

export function planCollectionFilter(params: URLSearchParams): PlanCollectionFilter {
  const filters = Object.fromEntries(["store", "status", "action", "sort"].map(key => [key, params.get(key) || ""]));
  if (filters.store && !/^[a-z0-9_-]{1,80}$/.test(filters.store)) throw new InputValidationError("Choose a supported store.");
  if (filters.status && !["active", "paused", "satisfied", "archived", "expired"].includes(filters.status)) throw new InputValidationError("Choose a supported plan status.");
  if (filters.action && !["notify", "add_to_cart"].includes(filters.action)) throw new InputValidationError("Choose a supported plan action.");
  if (filters.sort && !["updated", "newest", "title"].includes(filters.sort)) throw new InputValidationError("Choose a supported plan order.");
  return { ...filters, now: Date.now() };
}

export function planCollectionSql(filters: PlanCollectionFilter, now = Date.now()) {
  const clauses: string[] = [];
  const parameters: string[] = [];
  if (filters.store) {
    clauses.push("EXISTS (SELECT 1 FROM mission_targets filter_target JOIN listings filter_listing ON filter_listing.id = filter_target.listing_id WHERE filter_target.mission_id = m.id AND filter_target.enabled = 1 AND filter_listing.retailer_id = ?)");
    parameters.push(filters.store);
  }
  if (filters.status === "expired") {
    clauses.push("m.status IN ('active', 'paused') AND (SELECT expires_at FROM mission_intent_revisions WHERE mission_id = m.id ORDER BY revision DESC LIMIT 1) <> '' AND (SELECT expires_at FROM mission_intent_revisions WHERE mission_id = m.id ORDER BY revision DESC LIMIT 1) <= ?");
    parameters.push(new Date(filters.now ?? now).toISOString());
  } else if (filters.status) { clauses.push("m.status = ?"); parameters.push(filters.status); }
  if (filters.action) {
    clauses.push("(SELECT action_ceiling FROM mission_intent_revisions WHERE mission_id = m.id ORDER BY revision DESC LIMIT 1) = ?");
    parameters.push(filters.action);
  }
  const order = filters.sort === "title" ? "v.title COLLATE NOCASE, m.id" : filters.sort === "newest" ? "m.created_at DESC, m.id DESC" : "m.updated_at DESC, m.id DESC";
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", parameters, order };
}
