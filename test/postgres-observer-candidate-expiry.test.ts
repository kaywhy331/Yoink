import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  buildPostgresObserverCandidateEvaluationManifest,
  observerCandidateFunctionSource
} from "../packages/database/src/postgres-observer-repair-candidate-evaluation.js";

test("PostgreSQL generated candidate expiry is exactly 30 elapsed days across fall DST", async () => {
  const database = new PGlite();
  try {
    await database.exec("SET TIME ZONE 'America/Los_Angeles'");
    // The native boundary pins statement_timestamp and rejects historical apply clocks.
    // Execute its generated expiry expression with a fixed clock instead.
    const source = observerCandidateFunctionSource(
      buildPostgresObserverCandidateEvaluationManifest()
    );
    const expiryExpression = source.match(/candidate_expires_at := ([\s\S]*?);/);
    assert.ok(expiryExpression, "generated candidate expiry assignment must exist");
    const evaluationClock = "2026-10-26T12:00:00.000-07:00";
    const { rows } = await database.query<{ expires_at: string; calendar_elapsed_seconds: number }>(
      `SELECT ${expiryExpression[1]} AS expires_at,
              EXTRACT(EPOCH FROM (
                (evaluation_clock + interval '30 days') - evaluation_clock
              ))::double precision AS calendar_elapsed_seconds
       FROM (VALUES ($1::timestamptz)) AS clock(evaluation_clock)`,
      [evaluationClock]
    );
    assert.equal(rows.length, 1);
    // Confirm this clock and session actually expose the extra calendar hour.
    assert.equal(rows[0]!.calendar_elapsed_seconds, 30 * 24 * 60 * 60 + 60 * 60);
    assert.equal(rows[0]!.expires_at, "2026-11-25T19:00:00.000Z");
    assert.equal(Date.parse(rows[0]!.expires_at) - Date.parse(evaluationClock), 30 * 24 * 60 * 60_000);
  } finally {
    await database.close();
  }
});
