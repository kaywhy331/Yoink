import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { AuditRepository } from "../packages/database/src/audit-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { HostedDeliveryRepository } from "../packages/database/src/hosted-delivery-repository.js";
import {
  currentRequestScope,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-24T08:00:00.000Z").getTime();

function scope(tenantId = LOCAL_TENANT_ID, userId = LOCAL_USER_ID, actorKind: RequestScope["actorKind"] = "maintainer"): RequestScope {
  return { tenantId, userId, actorKind, actorId: `${actorKind}_test` };
}

function seedPrincipal(db: YoinkDatabase, tenantId: string, userId: string): void {
  const timestamp = new Date(NOW).toISOString();
  db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", tenantId, tenantId, timestamp);
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)", userId, tenantId, userId, timestamp);
}

test("request scope survives async work and keeps tenant audit data isolated", async () => {
  const db = new YoinkDatabase();
  try {
    seedPrincipal(db, "tenant_second", "user_second");
    const audit = new AuditRepository(db);
    const observed = await Promise.all([
      runWithRequestScope(scope(), async () => {
        await nextTurn();
        audit.record({ correlationId: "local_event", eventType: "scope_test", reasonCode: "local", message: "local" }, NOW);
        return currentRequestScope();
      }),
      runWithRequestScope(scope("tenant_second", "user_second"), async () => {
        await nextTurn();
        audit.record({ correlationId: "second_event", eventType: "scope_test", reasonCode: "second", message: "second" }, NOW + 1);
        return currentRequestScope();
      })
    ]);

    assert.equal(observed[0]?.userId, LOCAL_USER_ID);
    assert.equal(observed[1]?.userId, "user_second");
    assert.deepEqual(runWithRequestScope(scope(), () => audit.list().map((item) => item.correlationId)), ["local_event"]);
    assert.deepEqual(
      runWithRequestScope(scope("tenant_second", "user_second"), () => audit.list().map((item) => item.correlationId)),
      ["second_event"]
    );
    assert.equal(runWithRequestScope(scope(), () => audit.outboxCounts().outboxEvents), 1);
    assert.equal(runWithRequestScope(scope("tenant_second", "user_second"), () => audit.outboxCounts().outboxEvents), 1);
  } finally {
    db.close();
  }
});

test("hosted delivery rejects unconfigured and cross-capability service actors", () => {
  const db = new YoinkDatabase();
  try {
    const delivery = new HostedDeliveryRepository(db);
    const input = {
      source: "service_boundary",
      messageKey: "service:boundary:1",
      eventType: "boundary_test",
      payload: { safe: true }
    };
    assert.throws(() => runWithRequestScope(scope(LOCAL_TENANT_ID, LOCAL_USER_ID, "service"), () =>
      delivery.acceptInbox(input, NOW)), /internal\.delivery/);
    assert.throws(() => runWithRequestScope({
      ...scope(LOCAL_TENANT_ID, LOCAL_USER_ID, "service"),
      internalServiceCapability: "internal.eligibility"
    }, () => delivery.acceptInbox(input, NOW)), /internal\.delivery/);
    const accepted = runWithRequestScope({
      ...scope(LOCAL_TENANT_ID, LOCAL_USER_ID, "service"),
      internalServiceCapability: "internal.delivery"
    }, () => delivery.acceptInbox(input, NOW));
    assert.equal(accepted.disposition, "accepted");
  } finally {
    db.close();
  }
});

test("hosted inbox is idempotent, sanitized, retryable, and protected by one-use lease capabilities", () => {
  const db = new YoinkDatabase();
  try {
    const delivery = new HostedDeliveryRepository(db);
    runWithRequestScope(scope(), () => {
      const first = delivery.acceptInbox({
        source: "trackalacker",
        messageKey: "message:123",
        eventType: "stock_update",
        payload: { sku: "ABC123", nested: { available: true }, cookie: "must-not-persist" }
      }, NOW);
      const duplicate = delivery.acceptInbox({
        source: "trackalacker",
        messageKey: "message:123",
        eventType: "stock_update",
        payload: { cookie: "different-secret-is-redacted", nested: { available: true }, sku: "ABC123" }
      }, NOW + 1);
      assert.equal(first.disposition, "accepted");
      assert.equal(duplicate.disposition, "deduped");
      assert.equal(duplicate.id, first.id);
      assert.throws(() => delivery.acceptInbox({
        source: "trackalacker",
        messageKey: "message:123",
        eventType: "stock_update",
        payload: { sku: "DIFFERENT" }
      }, NOW + 2), /already used for different content/);

      const lease = delivery.leaseInbox(60, NOW + 3);
      assert.ok(lease);
      assert.deepEqual(lease.payload, { cookie: "[REDACTED]", nested: { available: true }, sku: "ABC123" });
      assert.throws(() => delivery.completeInbox(lease.id, "x".repeat(43), NOW + 4), /invalid or expired/);
      assert.equal(delivery.retryInbox(lease.id, lease.capabilityToken, "temporary_network", 30, NOW + 5), "retry");
      assert.equal(delivery.leaseInbox(60, NOW + 20_000), null);
      const secondLease = delivery.leaseInbox(60, NOW + 36_000);
      assert.ok(secondLease);
      assert.notEqual(secondLease.capabilityToken, lease.capabilityToken);
      assert.throws(() => delivery.completeInbox(secondLease.id, lease.capabilityToken, NOW + 37_000), /invalid or expired/);
      assert.equal(delivery.completeInbox(secondLease.id, secondLease.capabilityToken, NOW + 37_000), true);
      assert.throws(() => delivery.completeInbox(secondLease.id, secondLease.capabilityToken, NOW + 38_000), /invalid or expired/);
      assert.deepEqual(delivery.counts(), { inboxPending: 0, inboxProcessed: 1, outboxPending: 0, outboxDelivered: 0 });
    });
    const durable = JSON.stringify(db.all("SELECT * FROM inbox_messages"));
    assert.equal(durable.includes("must-not-persist"), false);
    assert.equal(durable.includes("different-secret"), false);
  } finally {
    db.close();
  }
});

test("hosted outbox leases are tenant-scoped, retry safely, and acknowledge at most once", () => {
  const db = new YoinkDatabase();
  try {
    seedPrincipal(db, "tenant_second", "user_second");
    const audit = new AuditRepository(db);
    const delivery = new HostedDeliveryRepository(db);
    runWithRequestScope(scope(), () => audit.record({
      correlationId: "local_outbox",
      eventType: "delivery_test",
      reasonCode: "created",
      message: "local payload"
    }, NOW));
    runWithRequestScope(scope("tenant_second", "user_second"), () => audit.record({
      correlationId: "second_outbox",
      eventType: "delivery_test",
      reasonCode: "created",
      message: "second payload"
    }, NOW + 1));

    runWithRequestScope(scope(), () => {
      const first = delivery.leaseOutbox(60, NOW + 2);
      assert.ok(first);
      assert.equal(first.aggregateId, "local_outbox");
      assert.equal(delivery.retryOutbox(first.id, first.capabilityToken, "upstream_unavailable", 1, NOW + 3), "retry");
      assert.equal(delivery.leaseOutbox(60, NOW + 500), null);
      const second = delivery.leaseOutbox(60, NOW + 2_000);
      assert.ok(second);
      assert.equal(second.id, first.id);
      assert.equal(second.attempt, 2);
      assert.equal(delivery.completeOutbox(second.id, second.capabilityToken, NOW + 2_100), true);
      assert.throws(() => delivery.completeOutbox(second.id, second.capabilityToken, NOW + 2_200), /invalid or expired/);
      assert.deepEqual(delivery.counts(), { inboxPending: 0, inboxProcessed: 0, outboxPending: 0, outboxDelivered: 1 });
    });
    runWithRequestScope(scope("tenant_second", "user_second"), () => {
      const lease = delivery.leaseOutbox(60, NOW + 3_000);
      assert.ok(lease);
      assert.equal(lease.aggregateId, "second_outbox");
      assert.equal(delivery.completeOutbox(lease.id, lease.capabilityToken, NOW + 3_100), true);
    });
    assert.throws(
      () => runWithRequestScope(scope(LOCAL_TENANT_ID, LOCAL_USER_ID, "user"), () => delivery.leaseOutbox(60, NOW)),
      /trusted delivery worker/
    );
  } finally {
    db.close();
  }
});

test("the twentieth failed inbox lease is durably dead-lettered", () => {
  const db = new YoinkDatabase();
  try {
    const delivery = new HostedDeliveryRepository(db);
    runWithRequestScope(scope(), () => {
      const accepted = delivery.acceptInbox({
        source: "worker",
        messageKey: "dead-letter:1",
        eventType: "test_event",
        payload: { safe: true }
      }, NOW);
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        const at = NOW + attempt * 2_000;
        const lease = delivery.leaseInbox(15, at);
        assert.ok(lease);
        assert.equal(lease.attempt, attempt);
        assert.equal(delivery.retryInbox(lease.id, lease.capabilityToken, "still_failing", 1, at + 1), attempt === 20 ? "dead_letter" : "retry");
      }
      assert.equal(delivery.leaseInbox(15, NOW + 50_000), null);
      assert.equal(db.get<{ state: string }>("SELECT state FROM inbox_messages WHERE id = ?", accepted.id)?.state, "dead_letter");
    });
  } finally {
    db.close();
  }
});

test("background recovery retires abandoned hosted inbox and outbox capabilities", () => {
  const db = new YoinkDatabase();
  try {
    const audit = new AuditRepository(db);
    const delivery = new HostedDeliveryRepository(db);
    runWithRequestScope(scope(), () => {
      delivery.acceptInbox({
        source: "worker",
        messageKey: "recovery:inbox:1",
        eventType: "recovery_test",
        payload: { safe: true }
      }, NOW);
      audit.record({
        correlationId: "recovery_outbox_001",
        eventType: "recovery_test",
        reasonCode: "fixture",
        message: "Bounded recovery fixture"
      }, NOW);
      const inbox = delivery.leaseInbox(15, NOW + 1);
      const outbox = delivery.leaseOutbox(15, NOW + 1);
      assert.ok(inbox);
      assert.ok(outbox);
      assert.deepEqual(delivery.recoverExpiredLeases(NOW + 15_002), {
        inboxRequeued: 1,
        inboxDeadLettered: 0,
        outboxRequeued: 1,
        outboxDeadLettered: 0
      });
      assert.throws(() => delivery.completeInbox(inbox.id, inbox.capabilityToken, NOW + 15_003), /invalid or expired/);
      assert.throws(() => delivery.completeOutbox(outbox.id, outbox.capabilityToken, NOW + 15_003), /invalid or expired/);
      const recoveredInbox = delivery.leaseInbox(15, NOW + 15_004);
      const recoveredOutbox = delivery.leaseOutbox(15, NOW + 15_004);
      assert.ok(recoveredInbox);
      assert.ok(recoveredOutbox);
      assert.notEqual(recoveredInbox.capabilityToken, inbox.capabilityToken);
      assert.notEqual(recoveredOutbox.capabilityToken, outbox.capabilityToken);
    });
  } finally {
    db.close();
  }
});
