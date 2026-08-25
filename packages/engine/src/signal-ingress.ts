import {
  SIGNAL_INGRESS_EVENT_TYPE,
  type DurableSignalIngressReceipt,
  type DurableSignalRetryReceipt,
  type SignalIngressBatchResult
} from "../../contracts/src/signal-ingress.js";
import type { SignalEventInput } from "../../contracts/src/index.js";
import { BackgroundTaskRepository } from "../../database/src/background-task-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import { HostedDeliveryRepository } from "../../database/src/hosted-delivery-repository.js";
import {
  currentRequestScope,
  runWithRequestScope
} from "../../database/src/request-scope.js";
import { stableHash } from "../../domain/src/ids.js";
import { normalizeSignal } from "../../domain/src/normalize.js";
import { SignalEngine } from "./signal-engine.js";

const MAXIMUM_SIGNALS_PER_TASK = 25;
const SIGNAL_LEASE_SECONDS = 60;
const SIGNAL_RETRY_SECONDS = 30;

function processingError(code: string): Error & { code: string } {
  const error = new Error("Durable signal ingress processing failed safely.") as Error & { code: string };
  error.code = code;
  return error;
}

function durableSignal(input: SignalEventInput, now: number): SignalEventInput {
  const normalized = normalizeSignal(input, now);
  if (normalized.source !== "trackalacker" || normalized.parserVersion !== "trackalacker-push-v1") {
    throw new Error("Durable TrackaLacker ingress requires the packaged parser contract.");
  }
  return {
    schemaVersion: normalized.schemaVersion,
    signalId: normalized.signalId,
    sourceConnectionId: normalized.sourceConnectionId,
    source: normalized.source,
    externalEventId: normalized.externalEventId,
    eventType: normalized.eventType,
    observedAt: normalized.observedAt,
    receivedAt: normalized.receivedAt,
    test: normalized.test,
    identity: normalized.identity,
    offer: {
      availability: normalized.offer.availability,
      unitPriceCents: normalized.offer.unitPriceCents,
      currency: normalized.offer.currency,
      sellerName: normalized.offer.sellerName,
      sellerType: normalized.offer.sellerType,
      orderLimit: normalized.offer.orderLimit,
      fulfillment: normalized.offer.fulfillment,
      offerFingerprint: normalized.offer.offerFingerprint
    },
    evidence: normalized.evidence,
    parserVersion: normalized.parserVersion
  };
}

export class DurableSignalIngressService {
  private readonly delivery: HostedDeliveryRepository;
  private readonly tasks: BackgroundTaskRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.delivery = new HostedDeliveryRepository(db);
    this.tasks = new BackgroundTaskRepository(db);
  }

  acceptTrackalacker(input: SignalEventInput, now = Date.now()): DurableSignalIngressReceipt {
    const payload = durableSignal(input, now);
    const owner = currentRequestScope();
    const messageKey = `signal:${stableHash(
      "yoink_durable_signal_ingress_v1",
      owner.tenantId,
      owner.userId,
      payload.sourceConnectionId,
      payload.signalId
    )}`;
    return this.db.transaction(() => {
      const inbox = this.delivery.acceptInbox({
        source: "trackalacker",
        messageKey,
        eventType: SIGNAL_INGRESS_EVENT_TYPE,
        payload: payload as unknown as Record<string, unknown>
      }, now);
      let backgroundTaskId = "";
      let backgroundTaskCreated = false;
      let backgroundWakeState: DurableSignalIngressReceipt["backgroundWakeState"] = "not_required";
      if (!["processed", "dead_letter"].includes(inbox.state)) {
        const queued = runWithRequestScope({
          tenantId: owner.tenantId,
          userId: owner.userId,
          actorKind: "service",
          actorId: "signal_ingress_api"
        }, () => this.tasks.enqueueServiceTask(
          "hosted_delivery_recovery",
          `signal:${inbox.id}`,
          now
        ));
        backgroundTaskId = queued.taskId;
        backgroundTaskCreated = queued.created;
        backgroundWakeState = queued.state;
      }
      return {
        accepted: true,
        signalId: String(payload.signalId),
        duplicate: inbox.disposition === "deduped",
        processingState: inbox.state === "processed"
          ? "processed"
          : inbox.state === "dead_letter"
            ? "dead_letter"
            : "queued",
        inboxReceiptId: inbox.id,
        backgroundTaskId,
        backgroundTaskCreated,
        backgroundWakeState
      };
    });
  }

  retryDeadLetter(inboxId: string, correlationId: string, now = Date.now()): DurableSignalRetryReceipt {
    const owner = currentRequestScope();
    return this.db.transaction(() => {
      const message = this.delivery.retryDeadLetterInbox(
        inboxId,
        SIGNAL_INGRESS_EVENT_TYPE,
        correlationId,
        now
      );
      const queued = runWithRequestScope({
        tenantId: owner.tenantId,
        userId: owner.userId,
        actorKind: "service",
        actorId: "signal_ingress_api"
      }, () => this.tasks.enqueueServiceTask(
        "hosted_delivery_recovery",
        `signal:${message.id}`,
        now
      ));
      return {
        retried: true,
        processingState: "queued",
        inboxReceiptId: message.id,
        backgroundTaskId: queued.taskId,
        backgroundTaskCreated: queued.created,
        backgroundWakeState: queued.state
      };
    });
  }
}

export class DurableSignalIngressProcessor {
  private readonly delivery: HostedDeliveryRepository;
  private readonly engine: SignalEngine;

  constructor(db: YoinkDatabase) {
    this.delivery = new HostedDeliveryRepository(db);
    this.engine = new SignalEngine(db);
  }

  processBatch(now = Date.now(), maximumSignals = MAXIMUM_SIGNALS_PER_TASK): SignalIngressBatchResult {
    const limit = Math.max(1, Math.min(100, Math.floor(Number(maximumSignals) || MAXIMUM_SIGNALS_PER_TASK)));
    const result: SignalIngressBatchResult = {
      signalMessagesProcessed: 0,
      signalMessagesRetried: 0,
      signalMessagesDeadLettered: 0,
      signalDuplicatesObserved: 0,
      signalActionJobsCreated: 0
    };
    let uncertainTransition = false;
    for (let index = 0; index < limit; index += 1) {
      const lease = this.delivery.leaseInboxByEventType(SIGNAL_INGRESS_EVENT_TYPE, SIGNAL_LEASE_SECONDS, now);
      if (!lease) break;
      let processed;
      try {
        if (lease.source !== "trackalacker" || lease.eventType !== SIGNAL_INGRESS_EVENT_TYPE) {
          throw processingError("signal_ingress_contract_mismatch");
        }
        processed = this.engine.process(lease.payload as unknown as SignalEventInput, now);
      } catch {
        try {
          const disposition = this.delivery.retryInbox(
            lease.id,
            lease.capabilityToken,
            "signal_processing_failed",
            SIGNAL_RETRY_SECONDS,
            now
          );
          if (disposition === "dead_letter") result.signalMessagesDeadLettered += 1;
          else result.signalMessagesRetried += 1;
        } catch {
          uncertainTransition = true;
        }
        continue;
      }
      try {
        const completed = this.delivery.completeInbox(lease.id, lease.capabilityToken, now);
        if (!completed) {
          uncertainTransition = true;
          continue;
        }
        result.signalMessagesProcessed += 1;
        if (processed.duplicate) result.signalDuplicatesObserved += 1;
        if (processed.actionJobId) result.signalActionJobsCreated += 1;
      } catch {
        uncertainTransition = true;
      }
    }
    if (uncertainTransition) throw processingError("signal_ingress_transition_uncertain");
    return result;
  }
}
