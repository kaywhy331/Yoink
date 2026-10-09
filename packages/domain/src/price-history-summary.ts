import type { PriceHistoryMark, PriceHistorySummary } from "../../contracts/src/index.js";

/**
 * Yoink's suggested price (Kevin, 2026-10-09): "the price of what it will
 * probably be able to purchase for without a high mark up", with no spikes or
 * price hikes in it.
 *
 * 1. Each store's usual price is the price it held for most of the window:
 *    a time-weighted median of its prices, each lasting until the next one
 *    (the last until now). A short spike barely moves it.
 * 2. A store counts when its usual price is within PRICE_SUGGESTION_TOLERANCE
 *    of the cheapest store's: $5 or 10%, whichever is more, so $1 against $2
 *    is close, while $500 against $1,000 is a markup.
 * 3. The suggestion is the highest usual price among the stores that count,
 *    so it is a price more than one store sells at.
 */
export const PRICE_SUMMARY_WINDOW_DAYS = 90;
export const PRICE_SUGGESTION_TOLERANCE = Object.freeze({ cents: 500, percent: 10 });

export interface PriceSeries {
  retailerId: string;
  retailerName: string;
  /** Oldest first; a price observed before the window still counts while it lasted into it. */
  observations: ReadonlyArray<{ atMs: number; priceCents: number }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function suggestionToleranceCents(cheapestCents: number): number {
  return Math.max(PRICE_SUGGESTION_TOLERANCE.cents, Math.round(cheapestCents * PRICE_SUGGESTION_TOLERANCE.percent / 100));
}

/** The price held for at least half of the total time; ties go to the lower price. */
function timeWeightedMedian(segments: Array<{ priceCents: number; durationMs: number }>): number | null {
  const total = segments.reduce((sum, segment) => sum + segment.durationMs, 0);
  if (total <= 0) return null;
  let held = 0;
  for (const segment of [...segments].sort((a, b) => a.priceCents - b.priceCents)) {
    held += segment.durationMs;
    if (held * 2 >= total) return segment.priceCents;
  }
  return null;
}

export function summarizePriceHistory(series: ReadonlyArray<PriceSeries>, nowMs: number, windowDays = PRICE_SUMMARY_WINDOW_DAYS): PriceHistorySummary | null {
  const startMs = nowMs - windowDays * DAY_MS;
  const marks: PriceHistoryMark[] = [];
  const usual: Array<{ retailerId: string; retailerName: string; usualCents: number }> = [];
  for (const store of series) {
    const observations = store.observations
      .filter((point) => Number.isFinite(point.atMs) && point.atMs <= nowMs && Number.isSafeInteger(point.priceCents) && point.priceCents > 0)
      .sort((a, b) => a.atMs - b.atMs);
    const inWindow = observations.filter((point) => point.atMs >= startMs);
    // A store with nothing seen in the window has no current price to speak of.
    if (!inWindow.length) continue;
    const carried = observations.filter((point) => point.atMs < startMs).at(-1);
    const timeline = [...(carried ? [{ atMs: startMs, priceCents: carried.priceCents }] : []), ...inWindow];
    for (const point of timeline) {
      marks.push({ priceCents: point.priceCents, retailerId: store.retailerId, retailerName: store.retailerName, at: new Date(point.atMs).toISOString() });
    }
    const segments = timeline.map((point, index) => ({
      priceCents: point.priceCents,
      durationMs: (timeline[index + 1]?.atMs ?? nowMs) - point.atMs
    }));
    usual.push({ retailerId: store.retailerId, retailerName: store.retailerName,
      usualCents: timeWeightedMedian(segments) ?? timeline.at(-1)!.priceCents });
  }
  if (!marks.length || !usual.length) return null;
  // Lowest and highest; on a tie, the most recent.
  const byTime = [...marks].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const lowest = byTime.reduce((best, mark) => mark.priceCents < best.priceCents ? mark : best);
  const highest = byTime.reduce((best, mark) => mark.priceCents > best.priceCents ? mark : best);
  usual.sort((a, b) => a.usualCents - b.usualCents || a.retailerName.localeCompare(b.retailerName));
  const cheapest = usual[0]!.usualCents;
  const toleranceCents = suggestionToleranceCents(cheapest);
  const stores = usual.map((store) => ({ ...store, counted: store.usualCents - cheapest <= toleranceCents }));
  const pick = stores.filter((store) => store.counted).at(-1)!;
  return {
    windowDays,
    lowest,
    highest,
    suggested: { priceCents: pick.usualCents, retailerId: pick.retailerId, retailerName: pick.retailerName },
    toleranceCents,
    stores
  };
}
