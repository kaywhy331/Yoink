import assert from "node:assert/strict";
import test from "node:test";
import { AuditRepository } from "../packages/database/src/audit-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("audit records and tenant outbox events are atomic, searchable, and redacted", () => {
  const db = new YoinkDatabase();
  try {
    const audit = new AuditRepository(db);
    const secret = "A".repeat(48);
    const recorded = audit.record({
      correlationId: "signal_fixture_123",
      aggregateType: "signal",
      eventType: "Signal Qualified",
      reasonCode: "Strategy Matched",
      message: `Signal accepted with Bearer ${secret}`,
      data: { retailerId: "target", authorization: secret, decision: "qualified" }
    }, new Date("2026-08-23T08:00:00.000Z").getTime());
    assert.match(String(recorded.id), /^audit_/);
    assert.match(String(recorded.outboxId), /^outbox_/);
    assert.equal(audit.count(), 1);
    assert.equal(audit.count("strategy matched"), 1);
    assert.equal(audit.list(10, 0, "signal qualified")[0]?.correlationId, "signal_fixture_123");
    assert.deepEqual(audit.outboxCounts(), { outboxEvents: 1, pendingOutboxEvents: 1 });
    const durable = JSON.stringify({
      audit: db.all("SELECT * FROM audit_events"),
      outbox: db.all("SELECT * FROM outbox_events")
    });
    assert.equal(durable.includes(secret), false);
    assert.match(durable, /\[REDACTED\]/);
  } finally {
    db.close();
  }
});
