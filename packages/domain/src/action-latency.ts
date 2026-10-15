export const ACTION_LATENCY_HOPS = [
  "observedToReceivedMs",
  "receivedToJobMs",
  "jobToLeaseMs",
  "leaseToBaselineMs",
  "baselineToOfferMs",
  "offerToClickMs",
  "clickToSettleMs",
  "settleToCartReadyMs",
  "leaseToCartReadyMs",
  "clickToCartReadyMs"
] as const;

export type ActionLatencyHop = typeof ACTION_LATENCY_HOPS[number];
export type ActionLatencyHops = Record<ActionLatencyHop, number | null>;
export interface ActionLatencySummary {
  jobsSampled: number;
  hops: Record<ActionLatencyHop, { samples: number; p50Ms: number | null; p95Ms: number | null }>;
}

interface ActionLatencyRow {
  signalObservedAt?: unknown;
  signalReceivedAt?: unknown;
  createdAt?: unknown;
  leasedAt?: unknown;
  cartReadyAt?: unknown;
  storedLeaseToBaselineMs?: unknown;
  storedBaselineToOfferMs?: unknown;
  storedOfferToClickMs?: unknown;
  storedClickToSettleMs?: unknown;
  storedSettleToCartReadyMs?: unknown;
  storedLeaseToCartReadyMs?: unknown;
  storedClickToCartReadyMs?: unknown;
}

function timestamp(value: unknown): number {
  // Persisted timestamps must be timezone-qualified ISO dates, not values that
  // Date.parse happens to coerce (for example "0" or an empty field).
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NaN;
  // Date.parse normalizes impossible days such as February 30.
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00.000Z`).toISOString().startsWith(day) ? parsed : NaN;
}

function boundedDuration(from: unknown, to: unknown, maximumMs = 24 * 60 * 60_000): number | null {
  const duration = timestamp(to) - timestamp(from);
  return Number.isSafeInteger(duration) && duration >= 0 && duration <= maximumMs ? duration : null;
}

function boundedStoredDuration(value: unknown): number | null {
  // SQL NULL, absent JSON keys, strings and booleans are not measurements.
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 60 * 60_000
    ? value : null;
}

/**
 * Browser hops require a valid lease timestamp. Prefer a valid measured
 * lease-to-cart duration (including zero); otherwise derive only that hop
 * from the lease and non-checkout-report confirmation timestamps. Other
 * missing browser phases remain unknown; job/update/report times are not
 * substitutes for a lease, click or cart proof.
 */
export function jobLatencyHops(row: ActionLatencyRow): ActionLatencyHops {
  const leased = Number.isFinite(timestamp(row.leasedAt));
  const afterLease = (value: unknown): number | null => leased ? boundedStoredDuration(value) : null;
  return {
    observedToReceivedMs: boundedDuration(row.signalObservedAt, row.signalReceivedAt),
    receivedToJobMs: boundedDuration(row.signalReceivedAt, row.createdAt),
    jobToLeaseMs: boundedDuration(row.createdAt, row.leasedAt),
    leaseToBaselineMs: afterLease(row.storedLeaseToBaselineMs),
    baselineToOfferMs: afterLease(row.storedBaselineToOfferMs),
    offerToClickMs: afterLease(row.storedOfferToClickMs),
    clickToSettleMs: afterLease(row.storedClickToSettleMs),
    settleToCartReadyMs: afterLease(row.storedSettleToCartReadyMs),
    leaseToCartReadyMs: leased
      ? boundedStoredDuration(row.storedLeaseToCartReadyMs) ?? boundedDuration(row.leasedAt, row.cartReadyAt, 60 * 60_000)
      : null,
    clickToCartReadyMs: afterLease(row.storedClickToCartReadyMs)
  };
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1] ?? null;
}

export function summarizeActionLatency(samples: ActionLatencyHops[]): ActionLatencySummary {
  const hops = Object.fromEntries(ACTION_LATENCY_HOPS.map((hop) => {
    const values = samples.map((sample) => sample[hop]).filter((value): value is number => Number.isSafeInteger(value));
    return [hop, { samples: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) }];
  })) as ActionLatencySummary["hops"];
  return { jobsSampled: samples.length, hops };
}
