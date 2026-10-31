import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_LATENCY_HOPS, jobLatencyHops, summarizeActionLatency } from "../packages/domain/src/action-latency.js";

const LEASED_AT = "2026-10-14T20:00:00.000Z";
const CART_READY_AT = "2026-10-14T20:00:05.000Z";
const invalidDurations = [null, undefined, "", " ", "0", "12", false, true, [], {}, NaN, Infinity, -1, 0.5, 3_600_001];
const invalidTimestamps = [null, undefined, "", " ", "0", 0, false, {}, "invalid", "2026-02-30T20:00:00Z", "2026-10-14T20:00:00", "2026-10-14"];

test("unknown and invalid stored hops stay missing while numeric zero remains a sample", () => {
  const samples = invalidDurations.map((value) => jobLatencyHops({
    leasedAt: LEASED_AT,
    storedLeaseToBaselineMs: value,
    storedBaselineToOfferMs: value,
    storedOfferToClickMs: value,
    storedClickToSettleMs: value,
    storedSettleToCartReadyMs: value,
    storedLeaseToCartReadyMs: value,
    storedClickToCartReadyMs: value
  }));
  for (const sample of samples) assert.deepEqual(Object.values(sample), ACTION_LATENCY_HOPS.map(() => null));
  const zero = jobLatencyHops({ leasedAt: LEASED_AT, storedLeaseToBaselineMs: 0 });
  const summary = summarizeActionLatency([...samples, zero]);
  assert.equal(summary.jobsSampled, invalidDurations.length + 1);
  assert.deepEqual(summary.hops.leaseToBaselineMs, { samples: 1, p50Ms: 0, p95Ms: 0 });
  assert.deepEqual(summary.hops.baselineToOfferMs, { samples: 0, p50Ms: null, p95Ms: null });
});

test("only lease-to-cart has a timestamp fallback and valid stored zero takes priority", () => {
  for (const value of invalidDurations) {
    const sample = jobLatencyHops({ leasedAt: LEASED_AT, cartReadyAt: CART_READY_AT, storedLeaseToCartReadyMs: value });
    assert.equal(sample.leaseToCartReadyMs, 5000);
    assert.equal(sample.clickToCartReadyMs, null, "a click time cannot be inferred from cart proof");
    assert.equal(sample.leaseToBaselineMs, null);
  }
  for (const value of [0, 10, 3_600_000]) {
    assert.equal(jobLatencyHops({ leasedAt: LEASED_AT, cartReadyAt: CART_READY_AT, storedLeaseToCartReadyMs: value }).leaseToCartReadyMs, value);
  }
  assert.equal(jobLatencyHops({ leasedAt: LEASED_AT, cartReadyAt: LEASED_AT }).leaseToCartReadyMs, 0);
});

test("missing and invalid timestamps never manufacture source, lease, or browser samples", () => {
  for (const value of invalidTimestamps) {
    const sample = jobLatencyHops({
      signalObservedAt: value, signalReceivedAt: value, createdAt: value, leasedAt: value,
      cartReadyAt: CART_READY_AT, storedLeaseToBaselineMs: 0, storedLeaseToCartReadyMs: 0
    });
    assert.deepEqual(Object.values(sample), ACTION_LATENCY_HOPS.map(() => null));
    assert.equal(jobLatencyHops({ leasedAt: LEASED_AT, cartReadyAt: value }).leaseToCartReadyMs, null);
  }
});

test("timestamp hops honor order and bounds independently, including real zero and timezone offsets", () => {
  const sample = jobLatencyHops({
    signalObservedAt: "2026-10-14T13:00:00.000-07:00", signalReceivedAt: LEASED_AT,
    createdAt: "2026-10-14T20:00:01.000Z", leasedAt: LEASED_AT, cartReadyAt: CART_READY_AT
  });
  assert.equal(sample.observedToReceivedMs, 0);
  assert.equal(sample.receivedToJobMs, 1000);
  assert.equal(sample.jobToLeaseMs, null, "a reversed job-to-lease clock does not create a zero");
  assert.equal(sample.leaseToCartReadyMs, 5000, "valid independent hops survive a partial timeline");
  for (const cartReadyAt of ["2026-10-14T19:59:59.999Z", "2026-10-14T21:00:00.001Z"]) {
    assert.equal(jobLatencyHops({ leasedAt: LEASED_AT, cartReadyAt }).leaseToCartReadyMs, null);
  }
  assert.equal(jobLatencyHops({ leasedAt: LEASED_AT, cartReadyAt: "2026-10-14T21:00:00.000Z" }).leaseToCartReadyMs, 3_600_000);
  assert.equal(jobLatencyHops({ signalObservedAt: LEASED_AT, signalReceivedAt: "2026-10-15T20:00:00.000Z" }).observedToReceivedMs, 86_400_000);
  assert.equal(jobLatencyHops({ signalObservedAt: LEASED_AT, signalReceivedAt: "2026-10-15T20:00:00.001Z" }).observedToReceivedMs, null);
});

test("percentiles use each hop's valid denominator, including empty cohorts", () => {
  const summary = summarizeActionLatency([
    jobLatencyHops({}),
    jobLatencyHops({ leasedAt: LEASED_AT, storedLeaseToBaselineMs: 0 }),
    jobLatencyHops({ leasedAt: LEASED_AT, storedLeaseToBaselineMs: 100 }),
    jobLatencyHops({ leasedAt: LEASED_AT, storedLeaseToBaselineMs: 200, storedClickToSettleMs: 300 })
  ]);
  assert.equal(summary.jobsSampled, 4);
  assert.deepEqual(summary.hops.leaseToBaselineMs, { samples: 3, p50Ms: 100, p95Ms: 200 });
  assert.deepEqual(summary.hops.clickToSettleMs, { samples: 1, p50Ms: 300, p95Ms: 300 });
  assert.deepEqual(summary.hops.offerToClickMs, { samples: 0, p50Ms: null, p95Ms: null });
  const empty = summarizeActionLatency([]);
  assert.equal(empty.jobsSampled, 0);
  for (const hop of Object.values(empty.hops)) assert.deepEqual(hop, { samples: 0, p50Ms: null, p95Ms: null });
});
