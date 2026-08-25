import assert from "node:assert/strict";
import test from "node:test";
import type { SignalEventInput } from "../packages/contracts/src/index.js";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../packages/contracts/src/signal-ingress.js";
import { BackgroundTaskRepository } from "../packages/database/src/background-task-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { HostedDeliveryRepository } from "../packages/database/src/hosted-delivery-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";
import {
  DurableSignalIngressProcessor,
  DurableSignalIngressService
} from "../packages/engine/src/signal-ingress.js";

const NOW = new Date("2026-08-25T09:00:00.000Z").getTime();
const DEVICE_SCOPE: RequestScope = {
  tenantId: "tenant_local",
  userId: "user_local",
  actorKind: "device",
  actorId: "device_signal_ingress_test"
};
const WORKER_SCOPE: RequestScope = {
  tenantId: "tenant_local",
  userId: "user_local",
  actorKind: "service",
  actorId: "background_worker_signal_test"
};

function signal(sequence = 1): SignalEventInput {
  return {
    schemaVersion: 1,
    signalId: `push:trackalacker:durable-${sequence}`,
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: `push:trackalacker:durable-${sequence}`,
    eventType: "unknown",
    observedAt: new Date(NOW).toISOString(),
    receivedAt: new Date(NOW + 1_000).toISOString(),
    test: true,
    identity: {},
    offer: {
      availability: "unknown",
      currency: "USD",
      offerId: `EPHEMERAL-OFFER-${sequence}`
    },
    evidence: {
      headline: "TrackaLacker connectivity test",
      clickUrl: "https://www.target.com/p/example/-/A-1011483414?tracking=discard"
    },
    parserVersion: "trackalacker-push-v1"
  };
}

test("device signals are durably queued, actively deduplicated, and evaluated only by the worker", () => {
  const db = new YoinkDatabase();
  try {
    const ingress = new DurableSignalIngressService(db);
    const processor = new DurableSignalIngressProcessor(db);
    const first = runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(), NOW + 2_000));
    assert.equal(first.accepted, true);
    assert.equal(first.duplicate, false);
    assert.equal(first.processingState, "queued");
    assert.equal(first.backgroundTaskCreated, true);
    assert.equal(first.backgroundWakeState, "created");
    assert.match(first.inboxReceiptId, /^inbox_/);
    assert.match(first.backgroundTaskId, /^background_task_/);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, 0);
    assert.deepEqual({ ...db.get<{ taskKind: string; priority: number; state: string }>(
      `SELECT task_kind AS taskKind, priority, state FROM background_tasks WHERE id = ?`,
      first.backgroundTaskId
    ) }, { taskKind: "hosted_delivery_recovery", priority: 80, state: "pending" });

    const queuedDuplicate = runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(), NOW + 3_000));
    assert.equal(queuedDuplicate.duplicate, true);
    assert.equal(queuedDuplicate.processingState, "queued");
    assert.equal(queuedDuplicate.backgroundTaskCreated, false);
    assert.equal(queuedDuplicate.backgroundWakeState, "deduplicated");
    assert.equal(queuedDuplicate.inboxReceiptId, first.inboxReceiptId);
    assert.equal(queuedDuplicate.backgroundTaskId, first.backgroundTaskId);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM background_tasks")?.count, 1);

    const processed = runWithRequestScope(WORKER_SCOPE, () => processor.processBatch(NOW + 4_000));
    assert.deepEqual(processed, {
      signalMessagesProcessed: 1,
      signalMessagesRetried: 0,
      signalMessagesDeadLettered: 0,
      signalDuplicatesObserved: 0,
      signalActionJobsCreated: 0
    });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, 1);
    assert.equal(db.get<{ state: string }>("SELECT state FROM inbox_messages WHERE id = ?", first.inboxReceiptId)?.state, "processed");

    const processedDuplicate = runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(), NOW + 5_000));
    assert.equal(processedDuplicate.duplicate, true);
    assert.equal(processedDuplicate.processingState, "processed");
    assert.equal(processedDuplicate.backgroundTaskCreated, false);
    assert.equal(processedDuplicate.backgroundTaskId, "");
    assert.equal(processedDuplicate.backgroundWakeState, "not_required");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM background_tasks")?.count, 1);

    const durable = JSON.stringify({
      inbox: db.all("SELECT payload_json, payload_hash FROM inbox_messages"),
      signals: db.all("SELECT offer_json, evidence_json FROM signal_events")
    });
    assert.equal(durable.includes("EPHEMERAL-OFFER-1"), false);
    assert.equal(durable.includes("tracking=discard"), false);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("pausing the signal schedule defers new wakes without losing accepted messages", () => {
  const db = new YoinkDatabase();
  try {
    const tasks = new BackgroundTaskRepository(db);
    const ingress = new DurableSignalIngressService(db);
    const schedule = runWithRequestScope(WORKER_SCOPE, () => tasks.ensureDefaultSchedules(NOW))
      .find((item) => item.taskKind === "hosted_delivery_recovery");
    assert.ok(schedule);
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => tasks.updateSchedule(
      schedule.id,
      { enabled: false },
      "signal_schedule_pause_test",
      NOW + 1
    ));
    const deferred = runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(5), NOW + 2));
    assert.equal(deferred.processingState, "queued");
    assert.equal(deferred.backgroundWakeState, "schedule_paused");
    assert.equal(deferred.backgroundTaskId, "");
    assert.equal(db.get<{ state: string }>("SELECT state FROM inbox_messages WHERE id = ?", deferred.inboxReceiptId)?.state, "accepted");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM background_tasks")?.count, 0);

    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => tasks.updateSchedule(
      schedule.id,
      { enabled: true },
      "signal_schedule_resume_test",
      NOW + 3
    ));
    const resumed = runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(5), NOW + 4));
    assert.equal(resumed.duplicate, true);
    assert.equal(resumed.backgroundWakeState, "created");
    assert.equal(resumed.backgroundTaskCreated, true);
    assert.match(resumed.backgroundTaskId, /^background_task_/);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("signal acceptance rolls the inbox back if its immediate durable wake cannot be queued", () => {
  const db = new YoinkDatabase();
  try {
    const ingress = new DurableSignalIngressService(db);
    const mutable = ingress as unknown as {
      tasks: { enqueueServiceTask: () => never };
    };
    mutable.tasks.enqueueServiceTask = () => {
      throw new Error("fixture_queue_failure");
    };
    assert.throws(
      () => runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(2), NOW + 2_000)),
      /fixture_queue_failure/
    );
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM inbox_messages")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM hosted_delivery_receipts")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM background_tasks")?.count, 0);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("the packaged processor skips unrelated inbox contracts and dead-letters poison deterministically", () => {
  const db = new YoinkDatabase();
  try {
    const delivery = new HostedDeliveryRepository(db);
    const ingress = new DurableSignalIngressService(db);
    const processor = new DurableSignalIngressProcessor(db);
    const unrelated = runWithRequestScope(WORKER_SCOPE, () => delivery.acceptInbox({
      source: "external_worker",
      messageKey: "unrelated:message:1",
      eventType: "external_contract_v1",
      payload: { safe: true }
    }, NOW));
    runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(3), NOW + 1));

    const processed = runWithRequestScope(WORKER_SCOPE, () => processor.processBatch(NOW + 2));
    assert.equal(processed.signalMessagesProcessed, 1);
    assert.equal(db.get<{ state: string }>("SELECT state FROM inbox_messages WHERE id = ?", unrelated.id)?.state, "accepted");
    const unrelatedLease = runWithRequestScope(WORKER_SCOPE, () => delivery.leaseInbox(15, NOW + 3));
    assert.equal(unrelatedLease?.id, unrelated.id);
    assert.ok(unrelatedLease);
    runWithRequestScope(WORKER_SCOPE, () => delivery.completeInbox(unrelatedLease.id, unrelatedLease.capabilityToken, NOW + 4));

    const poison = runWithRequestScope(WORKER_SCOPE, () => delivery.acceptInbox({
      source: "trackalacker",
      messageKey: "poison:signal:1",
      eventType: SIGNAL_INGRESS_EVENT_TYPE,
      payload: { parserVersion: "trackalacker-push-v1" }
    }, NOW + 5));
    db.run("UPDATE inbox_messages SET delivery_attempts = 19 WHERE id = ?", poison.id);
    const deadLettered = runWithRequestScope(WORKER_SCOPE, () => processor.processBatch(NOW + 6));
    assert.equal(deadLettered.signalMessagesProcessed, 0);
    assert.equal(deadLettered.signalMessagesRetried, 0);
    assert.equal(deadLettered.signalMessagesDeadLettered, 1);
    assert.deepEqual({ ...db.get<{ state: string; errorCode: string; attempts: number }>(
      `SELECT state, last_error_code AS errorCode, delivery_attempts AS attempts
       FROM inbox_messages WHERE id = ?`,
      poison.id
    ) }, { state: "dead_letter", errorCode: "signal_processing_failed", attempts: 20 });
    const deadLetters = runWithRequestScope(LOCAL_REQUEST_SCOPE, () =>
      delivery.listInboxDeadLettersByEventType(SIGNAL_INGRESS_EVENT_TYPE));
    assert.deepEqual(deadLetters.map((item) => ({
      id: item.id,
      attempt: item.attempt,
      lastErrorCode: item.lastErrorCode,
      privacyClassification: item.privacyClassification
    })), [{
      id: poison.id,
      attempt: 20,
      lastErrorCode: "signal_processing_failed",
      privacyClassification: "operational_aggregate"
    }]);
    assert.equal(JSON.stringify(deadLetters).includes("parserVersion"), false);
    const retried = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => ingress.retryDeadLetter(
      poison.id,
      "signal_dead_letter_retry_test",
      NOW + 7
    ));
    assert.equal(retried.retried, true);
    assert.equal(retried.processingState, "queued");
    assert.equal(retried.backgroundWakeState, "created");
    assert.equal(db.get<{ state: string; attempts: number }>(
      "SELECT state, delivery_attempts AS attempts FROM inbox_messages WHERE id = ?",
      poison.id
    )?.state, "accepted");
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'signal_inbox_retried'"
    )?.count, 1);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("an uncertain inbox acknowledgement recovers without applying the signal twice", () => {
  const db = new YoinkDatabase();
  try {
    const ingress = new DurableSignalIngressService(db);
    const processor = new DurableSignalIngressProcessor(db);
    const accepted = runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(4), NOW));
    const mutable = processor as unknown as {
      delivery: HostedDeliveryRepository;
    };
    const completeInbox = mutable.delivery.completeInbox.bind(mutable.delivery);
    mutable.delivery.completeInbox = () => {
      throw new Error("fixture_uncertain_ack");
    };
    assert.throws(
      () => runWithRequestScope(WORKER_SCOPE, () => processor.processBatch(NOW + 1)),
      (error: unknown) => (error as { code?: string }).code === "signal_ingress_transition_uncertain"
    );
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, 1);
    assert.equal(db.get<{ state: string }>("SELECT state FROM inbox_messages WHERE id = ?", accepted.inboxReceiptId)?.state, "processing");
    assert.deepEqual(
      db.all<{ disposition: string }>(
        "SELECT disposition FROM hosted_delivery_receipts WHERE message_id = ? ORDER BY created_at, id",
        accepted.inboxReceiptId
      ).map((row) => row.disposition),
      ["accepted", "leased"]
    );

    mutable.delivery.completeInbox = completeInbox;
    runWithRequestScope(WORKER_SCOPE, () => mutable.delivery.recoverExpiredLeases(NOW + 60_002));
    const recovered = runWithRequestScope(WORKER_SCOPE, () => processor.processBatch(NOW + 60_003));
    assert.equal(recovered.signalMessagesProcessed, 1);
    assert.equal(recovered.signalDuplicatesObserved, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, 1);
    assert.equal(db.get<{ state: string }>("SELECT state FROM inbox_messages WHERE id = ?", accepted.inboxReceiptId)?.state, "processed");
    db.assertIntegrity();
  } finally {
    db.close();
  }
});

test("one signal worker task processes at most twenty-five messages", () => {
  const db = new YoinkDatabase();
  try {
    const delivery = new HostedDeliveryRepository(db);
    const processor = new DurableSignalIngressProcessor(db);
    runWithRequestScope(WORKER_SCOPE, () => {
      for (let sequence = 10; sequence < 37; sequence += 1) {
        delivery.acceptInbox({
          source: "trackalacker",
          messageKey: `bounded:signal:${sequence}`,
          eventType: SIGNAL_INGRESS_EVENT_TYPE,
          payload: signal(sequence) as unknown as Record<string, unknown>
        }, NOW + sequence);
      }
    });
    const first = runWithRequestScope(WORKER_SCOPE, () => processor.processBatch(NOW + 100));
    assert.equal(first.signalMessagesProcessed, 25);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM inbox_messages WHERE state = 'accepted'"
    )?.count, 2);
    const second = runWithRequestScope(WORKER_SCOPE, () => processor.processBatch(NOW + 101));
    assert.equal(second.signalMessagesProcessed, 2);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM inbox_messages WHERE state = 'processed'"
    )?.count, 27);
    db.assertIntegrity();
  } finally {
    db.close();
  }
});
