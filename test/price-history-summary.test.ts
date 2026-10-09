import assert from "node:assert/strict";
import test from "node:test";
import { summarizePriceHistory, suggestionToleranceCents, type PriceSeries } from "../packages/domain/src/price-history-summary.js";

// Kevin, 2026-10-09: under the chart, the 90-day low and high and "Yoink
// suggested price": what it can probably be bought for, without spikes, price
// hikes or a store charging far more than the others.
const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => NOW - daysAgo * DAY;
const store = (retailerId: string, points: Array<[daysAgo: number, cents: number]>): PriceSeries => ({
  retailerId,
  retailerName: retailerId[0]!.toUpperCase() + retailerId.slice(1),
  observations: points.map(([daysAgo, priceCents]) => ({ atMs: at(daysAgo), priceCents }))
});
const suggest = (...series: PriceSeries[]) => summarizePriceHistory(series, NOW)?.suggested.priceCents;

test("a few dollars apart counts as the same market; a markup does not ($5 or 10%, whichever is more)", () => {
  // $1 against $2 is 100% but only a dollar: both count, so the higher one.
  assert.equal(suggest(store("target", [[60, 100]]), store("walmart", [[60, 200]])), 200);
  // $500 against $1,000 is a markup: only the cheaper store counts.
  assert.equal(suggest(store("target", [[60, 50_000]]), store("amazon", [[60, 100_000]])), 50_000);
  // $500 against $540 is within 10%: the higher store's price is still fair.
  assert.equal(suggest(store("target", [[60, 50_000]]), store("bestbuy", [[60, 54_000]])), 54_000);
  // $50 against $54.99 is within $5; against $58 it is not ($8 > $5 and > 10%).
  assert.equal(suggest(store("target", [[60, 5_000]]), store("walmart", [[60, 5_499]])), 5_499);
  assert.equal(suggest(store("target", [[60, 5_000]]), store("walmart", [[60, 5_800]])), 5_000);
  assert.equal(suggestionToleranceCents(2_000), 500);
  assert.equal(suggestionToleranceCents(80_000), 8_000);
  const summary = summarizePriceHistory([store("target", [[60, 5_000]]), store("walmart", [[60, 5_800]])], NOW)!;
  assert.deepEqual(summary.stores.map((item) => [item.retailerName, item.usualCents, item.counted]), [["Target", 5_000, true], ["Walmart", 5_800, false]]);
  assert.equal(summary.suggested.retailerName, "Target");
});

test("a short spike or price hike barely moves a store's usual price, but shows as the 90-day high", () => {
  // $24.99 for 80 days, $59.99 for 5 days, back to $24.99.
  const spiky = store("amazon", [[85, 2_499], [10, 5_999], [5, 2_499]]);
  const summary = summarizePriceHistory([spiky], NOW)!;
  assert.equal(summary.suggested.priceCents, 2_499);
  assert.equal(summary.highest.priceCents, 5_999);
  assert.equal(summary.highest.at, new Date(at(10)).toISOString());
  assert.equal(summary.lowest.priceCents, 2_499);
  assert.equal(summary.lowest.at, new Date(at(5)).toISOString(), "on a tie, the most recent");
  // A hike that has lasted most of the window is the store's price now.
  assert.equal(suggest(store("amazon", [[85, 2_499], [70, 3_999]])), 3_999);
});

test("only the window counts: an older price lasts into it, a store not seen in it is left out", () => {
  // $30 since 120 days ago, then $25 for the last 20 days: $30 held 70 of the 90 days.
  const carried = summarizePriceHistory([store("walmart", [[120, 3_000], [20, 2_500]])], NOW)!;
  assert.equal(carried.suggested.priceCents, 3_000);
  assert.equal(carried.highest.priceCents, 3_000);
  assert.equal(carried.highest.at, new Date(at(90)).toISOString(), "an older price is counted from the window's start");
  // Best Buy was last seen 100 days ago: no current price, so not in the numbers.
  const stale = summarizePriceHistory([store("walmart", [[30, 2_500]]), store("bestbuy", [[100, 1_000]])], NOW)!;
  assert.deepEqual(stale.stores.map((item) => item.retailerName), ["Walmart"]);
  assert.equal(stale.lowest.priceCents, 2_500);
  assert.equal(summarizePriceHistory([store("bestbuy", [[100, 1_000]])], NOW), null);
  assert.equal(summarizePriceHistory([], NOW), null);
});

test("a price seen moments ago still gives a suggestion", () => {
  assert.equal(suggest(store("target", [[0, 1_999]])), 1_999);
});
