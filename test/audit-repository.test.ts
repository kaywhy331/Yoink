import assert from "node:assert/strict";
import test from "node:test";
import { AuditRepository } from "../packages/database/src/audit-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";

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

test("role grants and revocations are classified as Access rather than purchase safety", () => {
  const db = new YoinkDatabase();
  try {
    const audit = new AuditRepository(db);
    audit.record({
      correlationId: "role_fixture",
      aggregateType: "authorization",
      eventType: "authorization_role_granted",
      reasonCode: "role_grant_approved",
      message: "A role was granted."
    });
    audit.record({
      correlationId: "role_fixture",
      aggregateType: "authorization",
      eventType: "authorization_role_revoked",
      reasonCode: "role_revoke_approved",
      message: "A role was revoked."
    });
    assert.equal(audit.count({ type: "access" }), 2);
    assert.equal(audit.count({ type: "safety" }), 0);
    assert.deepEqual(audit.list(10, 0, { type: "access" }).map((item) => item.eventFamily), ["access", "access"]);
  } finally {
    db.close();
  }
});

test("audit retention removes expired audit and delivered outbox history but keeps pending delivery", () => {
  const db = new YoinkDatabase();
  try {
    const audit = new AuditRepository(db);
    const now = new Date("2026-09-04T12:00:00.000Z").getTime();
    const oldAt = now - 366 * 24 * 60 * 60_000;
    const delivered = audit.record({
      correlationId: "retention_delivered",
      eventType: "retention_fixture",
      reasonCode: "fixture",
      message: "Old delivered fixture."
    }, oldAt);
    audit.record({
      correlationId: "retention_pending",
      eventType: "retention_fixture",
      reasonCode: "fixture",
      message: "Old pending fixture."
    }, oldAt + 1);
    audit.record({
      correlationId: "retention_recent",
      eventType: "retention_fixture",
      reasonCode: "fixture",
      message: "Recent fixture."
    }, now - 1_000);
    db.run(
      "UPDATE outbox_events SET delivery_state = 'delivered', delivered_at = ? WHERE id = ?",
      new Date(oldAt).toISOString(),
      String(delivered.outboxId)
    );
    const result = runWithRequestScope({
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID,
      actorKind: "service",
      actorId: "background_worker_retention"
    }, () => audit.pruneRetainedHistory(now));
    assert.equal(result.deletedAuditEvents, 2);
    assert.equal(result.deletedDeliveredOutboxEvents, 1);
    assert.match(result.auditRetentionReceiptId, /^audit_/);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM outbox_events WHERE delivery_state = 'pending'"
    )?.count, 3);
    assert.equal(audit.count(), 2, "the recent event and retention receipt remain");
  } finally {
    db.close();
  }
});
