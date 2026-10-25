import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutReportRepository, CHECKOUT_CORRECTION_CONFIRMATION, type CheckoutCorrectionInput } from "../packages/database/src/checkout-report-repository.js";
import { ActionAnalyticsRepository } from "../packages/database/src/action-analytics-repository.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { runWithRequestScope, LOCAL_REQUEST_SCOPE } from "../packages/database/src/request-scope.js";
import { checkoutFixture, NOW } from "./helpers/checkout-report-fixture.js";

function review(repo: CheckoutReportRepository, jobId: string, changes: CheckoutCorrectionInput = {}) {
  const current = repo.get(jobId).report;
  return repo.preview(jobId, { kind: "correction", ...current, expectedReportId: current.id, reason: "Correct receipt amount", ...changes });
}
function command(preview: ReturnType<typeof review>, requestId = "correction_request_0001") {
  return { ...preview.draft, fingerprint: preview.fingerprint, requestId, confirmation: CHECKOUT_CORRECTION_CONFIRMATION };
}
function snapshot(f: ReturnType<typeof checkoutFixture>) {
  return ["action_jobs", "action_events", "missions", "spend_reservations", "spend_ledger_entries", "audit_events", "outbox_events"]
    .map(table => f.db.all(`SELECT * FROM ${table} ORDER BY id`));
}

test("charge corrections preserve history and update Activity, Insights, savings and cap spend", () => {
  const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
  try {
    const original = repo.get(f.jobId);
    const ledger = f.db.all("SELECT * FROM spend_ledger_entries ORDER BY id");
    for (const [index, total] of [8000, 5000].entries()) {
      const preview = review(repo, f.jobId, { actualTotalCents: total });
      const saved = repo.correct(f.jobId, command(preview, `correction_amount_${index}`), NOW + 5000 + index);
      assert.equal(saved.report.report.netCents, total);
      assert.equal(saved.report.history.total, index + 2);
      assert.equal(f.spend.summary(NOW + 10000).spentTodayCents, total);
      const job = f.signals.listJobs().find(job => job.id === f.jobId)!;
      assert.equal(job.userReportedTotalCents, total);
      const analytics = new ActionAnalyticsRepository(f.db).snapshot(NOW + 10000);
      assert.equal(analytics.reportedOutcomes, 1);
      assert.equal(analytics.hitRateBps, 10000);
      assert.equal(analytics.spend.committedCents, total);
      assert.equal(analytics.spend.savingsVsMsrpCents, 2 * 6999 - total);
      assert.equal(analytics.retailers[0]!.committedCents, total);
    }
    assert.deepEqual(repo.get(f.jobId).original, original.original);
    for (const row of ledger as any[]) assert.deepEqual(f.db.get("SELECT * FROM spend_ledger_entries WHERE id = ?", row.id), row);
    assert.equal(repo.get(f.jobId).plan.status, original.plan.status);
    assert.throws(() => f.db.run("UPDATE spend_ledger_entries SET spent_delta_cents = 1"), /immutable|append.only/i);
  } finally { f.db.close(); }
});

test("partial and full refunds keep gross charge, outcome, savings and over-cap evidence separate from net", () => {
  const f = checkoutFixture("got_it", 20000); const repo = new CheckoutReportRepository(f.db);
  try {
    const before = new ActionAnalyticsRepository(f.db).snapshot();
    for (const [index, refund] of [5000, 15000].entries()) {
      repo.correct(f.jobId, command(review(repo, f.jobId, { kind: "refund", refundAmountCents: refund }), `refund_request_000${index}`), NOW + 10000 + index);
    }
    const report = repo.get(f.jobId);
    assert.equal(report.report.outcome, "got_it"); assert.equal(report.report.netCents, 0);
    assert.equal(report.report.refundedCents, 20000); assert.equal(report.report.actualTotalCents, 20000);
    const after = new ActionAnalyticsRepository(f.db).snapshot();
    assert.equal(after.spend.committedCents, 0); assert.equal(after.spend.refundedCents, 20000);
    assert.equal(after.spend.savingsVsMsrpCents, before.spend.savingsVsMsrpCents);
    assert.equal(after.spend.overCapAmountCents, before.spend.overCapAmountCents);
    assert.equal(after.hitRateBps, 10000);
    assert.match(new ActionAnalyticsRepository(f.db).csv(), /spend,refunded_cents,,20000,cents,USD/);
    assert.throws(() => review(repo, f.jobId, { kind: "refund", refundAmountCents: 1 }), /cannot exceed/);
    repo.correct(f.jobId, command(review(repo, f.jobId, { refundedCents: 1000 }), "fix_mistaken_refund_01"));
    assert.equal(repo.get(f.jobId).report.netCents, 19000);
  } finally { f.db.close(); }
});

for (const status of ["active", "satisfied", "paused", "archived", "deleted"]) {
  test(`outcome corrections require reviewed progress and never resume ${status} plans`, () => {
    const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
    try {
      f.db.run("UPDATE missions SET status = ? WHERE id = ?", status, f.missionId);
      const preview = review(repo, f.jobId, { outcome: "missed_it" });
      if (status !== "deleted") {
        assert.throws(() => repo.correct(f.jobId, { ...command(preview), fulfilledQuantity: null }), /Review the revised plan progress/);
        assert.equal(preview.planChange!.after.fulfilledQuantity, 0);
      } else assert.equal(preview.planChange, null);
      const saved = repo.correct(f.jobId, command(preview));
      assert.equal(saved.report.plan.status, ["archived", "deleted", "paused"].includes(status) ? status : "paused");
      assert.equal(saved.report.plan.fulfilledQuantity, status === "deleted" ? 2 : 0);
      assert.equal(saved.report.report.netCents, 0);
      assert.equal(f.spend.reservationForJob(f.jobId)!.status, "released");
      const analytics = new ActionAnalyticsRepository(f.db).snapshot();
      assert.equal(analytics.reportedOutcomes, 1); assert.equal(analytics.hitRateBps, 0);
      assert.equal(analytics.funnel.closed, 1); assert.equal(analytics.retailers[0]!.gotIt, 0);
      const back = repo.correct(f.jobId, command(review(repo, f.jobId, { outcome: "got_it", actualTotalCents: 5000, fulfilledQuantity: 2 }), "correct_outcome_again"));
      assert.equal(back.report.report.netCents, 5000);
      assert.equal(back.report.plan.status, saved.report.plan.status);
    } finally { f.db.close(); }
  });
}

test("an initial Missed it becomes a purchase without inventing a committed original ledger entry", () => {
  const f = checkoutFixture("missed_it"); const repo = new CheckoutReportRepository(f.db);
  try {
    repo.correct(f.jobId, command(review(repo, f.jobId, { outcome: "got_it", actualTotalCents: 4000, fulfilledQuantity: 2 })));
    assert.equal(repo.get(f.jobId).plan.status, "satisfied");
    assert.equal(f.spend.summary(f.reportAt + 100).spentTodayCents, 4000);
    assert.equal(f.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM spend_ledger_entries WHERE entry_type = 'committed'")!.count, 0);
    assert.equal(new ActionAnalyticsRepository(f.db).snapshot().spend.committedCents, 4000);
  } finally { f.db.close(); }
});

test("stale reviews, conflicting retries, invalid values and missing confirmation cannot mutate history", () => {
  const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
  try {
    const before = snapshot(f);
    for (const changes of [{ actualTotalCents: -1 }, { actualTotalCents: 1.2 }, { actualTotalCents: 0 }, { actualTotalCents: 100000001 },
      { refundedCents: 7000 }, { kind: "refund", refundAmountCents: 0 }, { reason: "" }, { expectedReportId: "stale" }, { outcome: "other" },
      { outcome: "missed_it", fulfilledQuantity: 3 }]) assert.throws(() => review(repo, f.jobId, changes));
    const preview = review(repo, f.jobId, { actualTotalCents: 5000 });
    assert.throws(() => repo.correct(f.jobId, { ...command(preview), confirmation: "" }));
    assert.deepEqual(snapshot(f), before);
    const input = command(preview);
    const saved = repo.correct(f.jobId, input, NOW + 5000);
    const after = snapshot(f);
    const retry = repo.correct(f.jobId, input, NOW + 10000);
    assert.equal(retry.disposition, "unchanged"); assert.deepEqual(retry.receipt, saved.receipt);
    assert.deepEqual(snapshot(f), after);
    assert.throws(() => repo.correct(f.jobId, { ...input, actualTotalCents: 6000 }), /already used/);
    assert.throws(() => repo.correct(f.jobId, { ...input, requestId: "another_request_0001" }), /report changed/);
    f.signals.reportCartOutcome(f.jobId, "got_it", "I_REVIEWED_CHECKOUT_RESULT", 6500);
    assert.equal(repo.get(f.jobId).report.actualTotalCents, 5000);
  } finally { f.db.close(); }
});

test("changed plan state invalidates a preview, and unsafe pending states block outcome changes", () => {
  const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
  try {
    const preview = review(repo, f.jobId, { outcome: "missed_it" });
    f.db.run("UPDATE missions SET updated_at = '2026-09-01T00:00:00.000Z' WHERE id = ?", f.missionId);
    assert.throws(() => repo.correct(f.jobId, command(preview)), /changed after review/);
    const columns = f.db.all<{ name: string }>("PRAGMA table_info(action_jobs)").map(row => row.name);
    f.db.run(`INSERT INTO action_jobs(${columns.join(",")}) SELECT ${columns.map(column => column === "id" ? "'pending_checkout_job'" : column === "idempotency_key" ? "'pending_checkout_key'" : column === "state" ? "'navigating'" : column).join(",")} FROM action_jobs WHERE id = ?`, f.jobId);
    for (const state of ["navigating", "verifying_listing", "offer_verified", "add_authorized", "adding", "cart_verified", "checkout_review", "submit_authorized", "submitting", "manual_review", "submission_uncertain"]) {
      f.db.run("UPDATE action_jobs SET state = ? WHERE id = 'pending_checkout_job'", state);
      assert.throws(() => review(repo, f.jobId, { outcome: "missed_it" }), /needs your review/);
      assert.doesNotThrow(() => review(repo, f.jobId, { actualTotalCents: 5500 }));
    }
    f.db.run("UPDATE action_jobs SET state = 'awaiting_executor', spend_reservation_id = NULL WHERE id = 'pending_checkout_job'");
    const safe = review(repo, f.jobId, { outcome: "missed_it" });
    assert.equal(safe.planChange!.pendingActionCount, 1);
    repo.correct(f.jobId, command(safe));
    assert.equal(f.db.get<{ state: string }>("SELECT state FROM action_jobs WHERE id = 'pending_checkout_job'")!.state, "cancelled");
  } finally { f.db.close(); }
});

test("ledger or event write failure rolls back the whole correction", () => {
  const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
  try {
    const preview = review(repo, f.jobId, { outcome: "missed_it" });
    f.db.run(`CREATE TRIGGER reject_correction BEFORE INSERT ON action_events WHEN NEW.reason_code = 'user_reported_checkout_correction' BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END`);
    const before = snapshot(f);
    assert.throws(() => repo.correct(f.jobId, command(preview)), /forced receipt failure/);
    assert.deepEqual(snapshot(f), before);
    f.db.run("DROP TRIGGER reject_correction");
    f.db.run("UPDATE spend_reservations SET committed_amount_cents = 1 WHERE action_job_id = ?", f.jobId);
    const inconsistent = snapshot(f);
    assert.throws(() => repo.correct(f.jobId, command(preview)), /spending record differ/);
    assert.deepEqual(snapshot(f), inconsistent);
  } finally { f.db.close(); }
});

test("history and mutations are actor-owned even with a matching user ID in a different tenant", () => {
  const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
  try {
    const commandInput = command(review(repo, f.jobId, { actualTotalCents: 5000 }));
    const user = new AuthorizationRepository(f.db).createTenantUser({ displayName: "Other shopper" }).user;
    for (const scope of [{ ...LOCAL_REQUEST_SCOPE, userId: user.id, actorId: user.id }, { ...LOCAL_REQUEST_SCOPE, tenantId: "tenant_other" }]) {
      runWithRequestScope(scope, () => {
        assert.throws(() => repo.get(f.jobId), /unavailable/);
        assert.throws(() => repo.correct(f.jobId, commandInput), /unavailable/);
      });
    }
  } finally { f.db.close(); }
});

for (const [timezone, resetHour, reportTime, nowTime, expectedDay, expectedMonth] of [
  ["UTC", 0, "2026-08-31T23:59:59.999Z", "2026-09-01T12:00:00Z", 0, 0],
  ["UTC", 0, "2026-09-01T23:59:59.999Z", "2026-09-02T12:00:00Z", 0, 5500],
  ["America/Los_Angeles", 4, "2026-09-01T10:59:59.999Z", "2026-09-01T12:00:00Z", 0, 0],
  ["America/Los_Angeles", 4, "2026-09-01T11:00:00.000Z", "2026-09-01T12:00:00Z", 5500, 5500]
] as const) {
  test(`refund uses original period: ${timezone} ${reportTime}`, () => {
    const f = checkoutFixture("got_it", 6500, Date.parse(reportTime)); const repo = new CheckoutReportRepository(f.db);
    try {
      f.db.run("UPDATE user_spend_policies SET timezone = ?, period_reset_hour = ?, daily_cap_cents = 10000, monthly_cap_cents = 20000", timezone, resetHour);
      repo.correct(f.jobId, command(review(repo, f.jobId, { kind: "refund", refundAmountCents: 1000 })), Date.parse(nowTime));
      const summary = f.spend.summary(Date.parse(nowTime));
      assert.equal(summary.spentTodayCents, expectedDay); assert.equal(summary.spentThisMonthCents, expectedMonth);
      assert.equal(summary.availableTodayCents, 10000 - expectedDay);
      assert.equal(repo.get(f.jobId).accountingAt, reportTime);
    } finally { f.db.close(); }
  });
}

test("admin totals use current outcomes in the original reporting window and corrections are not cart executions", async () => {
  const { AdminAnalyticsRepository } = await import("../packages/database/src/admin-analytics-repository.js");
  const { AdminOverviewRepository } = await import("../packages/database/src/admin-overview-repository.js");
  const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
  try {
    const analytics = new AdminAnalyticsRepository(f.db); const overview = new AdminOverviewRepository(f.db);
    assert.equal(analytics.snapshot("24h", NOW + 10000).totals.gotIt, 1);
    repo.correct(f.jobId, command(review(repo, f.jobId, { outcome: "missed_it" })), NOW + 10000);
    const revised = analytics.snapshot("24h", NOW + 20000);
    assert.equal(revised.totals.gotIt, 0); assert.equal(revised.totals.missed, 1); assert.equal(revised.totals.carted, 0);
    assert.equal(overview.snapshot(NOW + 20000).windows.hours24.missed, 1);
    const later = NOW + 40 * 86400000;
    repo.correct(f.jobId, command(review(repo, f.jobId, { outcome: "got_it", actualTotalCents: 20000 }), "late_admin_correction"), later);
    assert.equal(analytics.snapshot("30d", later + 1000).totals.gotIt, 0);
    assert.equal(analytics.snapshot("30d", later + 1000).overCap.count, 0);
    assert.equal(overview.snapshot(later + 1000).windows.hours24.gotIt, 0);
  } finally { f.db.close(); }
});

test("manual-review reports just after midnight retain the preceding ledger period", () => {
  const chargedAt = Date.parse("2026-08-31T23:59:59.999Z");
  const f = checkoutFixture("got_it", 6500, chargedAt, true); const repo = new CheckoutReportRepository(f.db);
  try {
    assert.equal(repo.get(f.jobId).report.reportedAt, "2026-09-01T00:00:00.000Z");
    assert.equal(repo.get(f.jobId).accountingAt, "2026-08-31T23:59:59.999Z");
    repo.correct(f.jobId, command(review(repo, f.jobId, { kind: "refund", refundAmountCents: 500 })), chargedAt + 1000);
    assert.equal(f.spend.summary(chargedAt + 1000).spentTodayCents, 0);
    assert.equal(f.spend.summary(chargedAt + 1000).spentThisMonthCents, 0);
  } finally { f.db.close(); }
});

test("revision order and saved retry receipts survive same-time corrections and later changes", () => {
  const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
  try {
    const input = command(review(repo, f.jobId, { actualTotalCents: 5000 }));
    const first = repo.correct(f.jobId, input, NOW + 2000);
    const second = repo.correct(f.jobId, command(review(repo, f.jobId, { actualTotalCents: 4500 }), "later_correction_key"), NOW + 2000);
    assert.equal(second.report.report.netCents, 4500);
    const retry = repo.correct(f.jobId, input, NOW + 20000);
    assert.deepEqual(retry.receipt, first.receipt);
    assert.equal(retry.report.report.netCents, 4500);
    assert.equal(retry.report.history.total, 3);
  } finally { f.db.close(); }
});

test("damaged report evidence fails closed without mutating financial records", () => {
  for (const value of ["null", "[]"]) {
    const f = checkoutFixture(); const repo = new CheckoutReportRepository(f.db);
    try {
      f.db.run("UPDATE action_events SET evidence_json = ? WHERE reason_code = 'user_reported_order'", value);
      const before = snapshot(f);
      assert.throws(() => repo.get(f.jobId), /administrator review/);
      assert.deepEqual(snapshot(f), before);
    } finally { f.db.close(); }
  }
});
