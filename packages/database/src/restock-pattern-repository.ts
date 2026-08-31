import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { validTimezone } from "../../domain/src/time-period.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

interface ObservationRow {
  observedAt: string;
}

interface PatternRow {
  id: string;
  retailerId: string;
  listingId: string | null;
  retailerSku: string | null;
  title: string | null;
  timezone: string;
  sampleCount: number;
  likelyLocalHour: number | null;
  medianIntervalMinutes: number | null;
  confidenceBps: number;
  patternJson: string;
  computedThroughAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RestockPattern {
  id: string;
  retailerId: string;
  listingId: string;
  retailerSku: string;
  title: string;
  timezone: string;
  sampleCount: number;
  likelyLocalHour: number | null;
  medianIntervalMinutes: number | null;
  confidenceBps: number;
  histogram: number[];
  computedThroughAt: string;
  createdAt: string;
  updatedAt: string;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle] ?? null
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function localHour(timestamp: number, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(timestamp).find((part) => part.type === "hour")?.value;
  return Math.max(0, Math.min(23, Number(hour) || 0));
}

function pattern(row: PatternRow): RestockPattern {
  let histogram = Array<number>(24).fill(0);
  try {
    const parsed = JSON.parse(row.patternJson) as { histogram?: unknown };
    if (Array.isArray(parsed.histogram) && parsed.histogram.length === 24) {
      histogram = parsed.histogram.map((value) => Math.max(0, Math.floor(Number(value) || 0)));
    }
  } catch {
    // A corrupt aggregate is presented as an empty bounded histogram.
  }
  return {
    id: row.id,
    retailerId: row.retailerId,
    listingId: row.listingId ?? "",
    retailerSku: row.retailerSku ?? "",
    title: row.title ?? "",
    timezone: row.timezone,
    sampleCount: Number(row.sampleCount),
    likelyLocalHour: row.likelyLocalHour === null ? null : Number(row.likelyLocalHour),
    medianIntervalMinutes: row.medianIntervalMinutes === null ? null : Number(row.medianIntervalMinutes),
    confidenceBps: Number(row.confidenceBps),
    histogram,
    computedThroughAt: row.computedThroughAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

const SELECT = `SELECT profile.id, profile.retailer_id AS retailerId,
  profile.listing_id AS listingId, listing.retailer_sku AS retailerSku,
  variant.title, profile.timezone, profile.sample_count AS sampleCount,
  profile.likely_local_hour AS likelyLocalHour,
  profile.median_interval_minutes AS medianIntervalMinutes,
  profile.confidence_bps AS confidenceBps, profile.pattern_json AS patternJson,
  profile.computed_through_at AS computedThroughAt,
  profile.created_at AS createdAt, profile.updated_at AS updatedAt
  FROM restock_pattern_profiles profile
  LEFT JOIN listings listing ON listing.id = profile.listing_id
  LEFT JOIN variants variant ON variant.id = listing.variant_id`;

export class RestockPatternRepository {
  constructor(private readonly db: YoinkDatabase) {}

  recompute(listingIdValue: unknown, timezoneValue: unknown, now = Date.now()): RestockPattern {
    const listingId = cleanText(listingIdValue, 120);
    const timezone = validTimezone(timezoneValue);
    const scope = currentRequestScope();
    const listing = this.db.get<{ retailerId: string }>(
      `SELECT retailer_id AS retailerId FROM listings WHERE id = ?`,
      listingId
    );
    if (!listing) throw new Error("The restock pattern requires an exact catalog listing.");
    const rows = this.db.all<ObservationRow>(
      `SELECT observation.observed_at AS observedAt
       FROM offer_observations observation
       JOIN source_connections source ON source.id = observation.source_connection_id
       WHERE observation.listing_id = ? AND source.tenant_id = ? AND source.user_id = ?
         AND observation.availability IN ('in_stock', 'preorder')
       ORDER BY observation.observed_at ASC LIMIT 10000`,
      listingId,
      scope.tenantId,
      scope.userId
    );
    const timestamps = rows.map((row) => new Date(row.observedAt).getTime()).filter(Number.isFinite);
    const histogram = Array<number>(24).fill(0);
    for (const timestamp of timestamps) {
      const hour = localHour(timestamp, timezone);
      histogram[hour] = (histogram[hour] ?? 0) + 1;
    }
    const maximum = Math.max(0, ...histogram);
    const likelyLocalHour = maximum > 0 ? histogram.indexOf(maximum) : null;
    const intervals = timestamps.slice(1).map((timestamp, index) =>
      Math.max(1, Math.round((timestamp - (timestamps[index] ?? timestamp)) / 60_000))
    ).filter((minutes) => minutes <= 525_600);
    const medianIntervalMinutes = median(intervals);
    const sampleCount = timestamps.length;
    const confidenceBps = Math.min(10_000, Math.round(10_000 * (1 - Math.exp(-sampleCount / 12))));
    const timestamp = nowIso(now);
    const existing = this.db.get<{ id: string; createdAt: string }>(
      `SELECT id, created_at AS createdAt FROM restock_pattern_profiles
       WHERE tenant_id = ? AND user_id = ? AND retailer_id = ? AND listing_id = ? AND timezone = ?`,
      scope.tenantId,
      scope.userId,
      listing.retailerId,
      listingId,
      timezone
    );
    const id = existing?.id ?? newId("restock_pattern");
    this.db.run(
      `INSERT INTO restock_pattern_profiles(
         id, tenant_id, user_id, retailer_id, listing_id, timezone,
         sample_count, likely_local_hour, median_interval_minutes,
         confidence_bps, pattern_json, computed_through_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, retailer_id, listing_id, timezone) DO UPDATE SET
         sample_count = excluded.sample_count,
         likely_local_hour = excluded.likely_local_hour,
         median_interval_minutes = excluded.median_interval_minutes,
         confidence_bps = excluded.confidence_bps,
         pattern_json = excluded.pattern_json,
         computed_through_at = excluded.computed_through_at,
         updated_at = excluded.updated_at`,
      id,
      scope.tenantId,
      scope.userId,
      listing.retailerId,
      listingId,
      timezone,
      sampleCount,
      likelyLocalHour,
      medianIntervalMinutes,
      confidenceBps,
      JSON.stringify({ histogram, input: "normalized_stock_observations", privacy: "aggregate" }),
      timestamp,
      existing?.createdAt ?? timestamp,
      timestamp
    );
    return this.get(id) as RestockPattern;
  }

  list(retailerIdValue = ""): RestockPattern[] {
    const retailerId = cleanText(retailerIdValue, 60).toLocaleLowerCase("en-US");
    const scope = currentRequestScope();
    return this.db.all<PatternRow>(
      `${SELECT}
       WHERE profile.tenant_id = ? AND profile.user_id = ?
         AND (? = '' OR profile.retailer_id = ?)
       ORDER BY profile.confidence_bps DESC, profile.updated_at DESC, profile.id`,
      scope.tenantId,
      scope.userId,
      retailerId,
      retailerId
    ).map(pattern);
  }

  private get(id: string): RestockPattern | null {
    const scope = currentRequestScope();
    const row = this.db.get<PatternRow>(
      `${SELECT} WHERE profile.id = ? AND profile.tenant_id = ? AND profile.user_id = ?`,
      id,
      scope.tenantId,
      scope.userId
    );
    return row ? pattern(row) : null;
  }
}
