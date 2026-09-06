import assert from "node:assert/strict";
import { spendAccountingTimeSql } from "../../packages/database/src/checkout-report-projection.js";

/** Run the production cap expression against PostgreSQL rows, including a refund posted in a later month. */
export async function verifyCheckoutAccounting(query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>) {
  await query(`CREATE TEMP TABLE checkout_cap_probe(entry_type text, reason_code text, spent_delta_cents integer, metadata_json text, created_at text)`);
  try {
    for (const [type, reason, delta, accountingAt, createdAt] of [
      ["committed", "user_reported_order", 9000, null, "2026-08-31T23:59:59.999Z"],
      ["refunded", "user_reported_checkout_correction", -9000, "2026-08-31T23:59:59.999Z", "2026-09-02T12:00:00.000Z"],
      ["committed", "user_reported_order", 500, null, "2026-09-01T23:59:59.999Z"],
      ["adjusted", "user_reported_checkout_correction", 200, "2026-09-01T23:59:59.999Z", "2026-09-02T12:00:00.000Z"],
      ["committed", "user_reported_order", 700, null, "2026-09-02T00:00:00.000Z"],
      ["refunded", "user_reported_checkout_correction", -100, "2026-09-02T00:00:00.000Z", "2026-09-02T12:00:00.000Z"],
      // Other adjustment reasons retain their existing posting-date behavior.
      ["adjusted", "other_adjustment", 100, "2026-08-01T00:00:00.000Z", "2026-09-02T12:00:00.000Z"]
    ]) await query("INSERT INTO checkout_cap_probe VALUES ($1, $2, $3, $4, $5)", [type, reason, delta, JSON.stringify({ accountingAt }), createdAt]);
    const time = `${spendAccountingTimeSql("postgres", "ledger")}::timestamptz`;
    const day = await query(`SELECT SUM(ledger.spent_delta_cents)::integer AS spent, SUM(ledger.spent_delta_cents) + 400 <= 1000 AS allowed
      FROM checkout_cap_probe ledger WHERE ${time} >= date_trunc('day', '2026-09-02T12:00:00Z'::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    assert.equal(day.rows[0].spent, 700);
    assert.equal(day.rows[0].allowed, false, "an old-period refund must not authorize a purchase over today's cap");
    const month = await query(`SELECT SUM(ledger.spent_delta_cents)::integer AS spent FROM checkout_cap_probe ledger
      WHERE ${time} >= date_trunc('month', '2026-09-02T12:00:00Z'::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    assert.equal(month.rows[0].spent, 1400);
    const local = await query(`SELECT SUM(ledger.spent_delta_cents)::integer AS spent FROM checkout_cap_probe ledger WHERE ${time} >= '2026-09-02T04:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles'`);
    assert.equal(local.rows[0].spent, 100);
  } finally { await query("DROP TABLE checkout_cap_probe"); }
}
