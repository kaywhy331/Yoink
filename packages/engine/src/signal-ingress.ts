import {
  SIGNAL_INGRESS_EVENT_TYPE,
  type DurableSignalIngressReceipt,
  type DurableSignalRetryReceipt,
  type SignalIngressBatchResult
} from "../../contracts/src/signal-ingress.js";
import {
  SIGNAL_PROVIDER_CONTRACT_VERSION,
  SIGNAL_PROVIDERS,
  type SignalProvider,
  type SignalProviderBatchReceipt,
  type SignalProviderEnvelope
} from "../../contracts/src/signal-provider.js";
import type { SignalEventInput } from "../../contracts/src/index.js";
import { BackgroundTaskRepository } from "../../database/src/background-task-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import { HostedDeliveryRepository } from "../../database/src/hosted-delivery-repository.js";
import { SignalProviderRepository } from "../../database/src/signal-provider-repository.js";
import {
  currentRequestScope,
  runWithRequestScope
} from "../../database/src/request-scope.js";
import { stableHash } from "../../domain/src/ids.js";
import { DomainRequestError } from "../../domain/src/domain-request-error.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { normalizeSignal, SignalValidationError } from "../../domain/src/normalize.js";
import { SignalEngine } from "./signal-engine.js";

const MAXIMUM_SIGNALS_PER_TASK = 25;
const SIGNAL_LEASE_SECONDS = 60;
const SIGNAL_RETRY_SECONDS = 30;

/**
 * Validation and caller-actionable domain failures (a malformed payload, a
 * removed source connection) cannot succeed on retry. They are recorded with
 * their own reason code so they are distinguishable from transient failures.
 */
export function signalFailureIsPermanent(error: unknown): boolean {
  return error instanceof SignalValidationError || error instanceof DomainRequestError
    // providerInputError (an invalid payload, a parser or replay-window
    // mismatch) marks itself non-retryable; it can never succeed later.
    || (error instanceof Error && (error as { retryable?: unknown }).retryable === false);
}
const PROVIDERS = new Set<SignalProvider>(SIGNAL_PROVIDERS);
const PROVIDER_PARSERS: Readonly<Record<SignalProvider, RegExp>> = Object.freeze({
  trackalacker: /^trackalacker-push-v1$/,
  discord: /^discord-channel-v1$/,
  drop_window: /^drop-window-v1$/,
  api: /^api-signal-v1$/
});
const MAX_PROVIDER_BATCH = 50;

type ProviderIngressError = Error & { code: string; retryable: boolean };

function providerInputError(code: string, message: string): ProviderIngressError {
  const error = new Error(message) as ProviderIngressError;
  error.code = code;
  error.retryable = false;
  return error;
}

function processingError(code: string): Error & { code: string } {
  const error = new Error("Durable signal ingress processing failed safely.") as Error & { code: string };
  error.code = code;
  return error;
}

function durableSignal(input: SignalEventInput, provider: SignalProvider, now: number): SignalEventInput {
  let normalized: ReturnType<typeof normalizeSignal>;
  try {
    normalized = normalizeSignal(input, now);
  } catch {
    throw providerInputError("invalid_signal", "The provider signal payload is invalid.");
  }
  if (normalized.source !== provider || !PROVIDER_PARSERS[provider].test(normalized.parserVersion)) {
    throw providerInputError(
      "provider_parser_mismatch",
      "Durable signal ingress requires the configured provider parser contract."
    );
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
  private readonly providers: SignalProviderRepository;

  constructor(
    private readonly db: YoinkDatabase,
    private readonly wakeWorker: (() => void | Promise<void>) | undefined = undefined,
    private readonly onSignalQueued: (() => void | Promise<void>) | undefined = undefined
  ) {
    this.delivery = new HostedDeliveryRepository(db);
    this.tasks = new BackgroundTaskRepository(db);
    this.providers = new SignalProviderRepository(db);
  }

  acceptTrackalacker(input: SignalEventInput, now = Date.now()): DurableSignalIngressReceipt {
    return this.acceptProvider({
      contractVersion: SIGNAL_PROVIDER_CONTRACT_VERSION,
      provider: "trackalacker",
      signal: input
    }, now);
  }

  acceptProvider(envelope: SignalProviderEnvelope, now = Date.now()): DurableSignalIngressReceipt {
    const provider = String(envelope?.provider || "") as SignalProvider;
    const channelId = String(envelope?.channelId || "");
    try {
      if (envelope?.contractVersion !== SIGNAL_PROVIDER_CONTRACT_VERSION || !PROVIDERS.has(provider)) {
        throw providerInputError("invalid_provider_envelope", "The signal provider envelope contract is invalid.");
      }
      const payload = durableSignal(envelope.signal, provider, now);
      if (provider === "trackalacker") {
        if (channelId) {
          throw providerInputError(
            "unexpected_provider_channel",
            "TrackaLacker ingress does not accept a provider channel binding."
          );
        }
      } else {
        let channel: ReturnType<SignalProviderRepository["requireActiveChannel"]>;
        try {
          channel = this.providers.requireActiveChannel(channelId, provider);
        } catch (error) {
          throw providerInputError(
            "provider_channel_unavailable",
            error instanceof Error ? error.message : "The provider channel is unavailable."
          );
        }
        if (channel.sourceConnectionId !== payload.sourceConnectionId) {
          throw providerInputError(
            "source_connection_mismatch",
            "The signal source connection does not match the configured provider channel."
          );
        }
        const observedAt = new Date(payload.observedAt).getTime();
        if (observedAt < now - channel.replayWindowSeconds * 1_000) {
          throw providerInputError(
            "provider_replay_window_exceeded",
            "The provider signal is outside this channel's replay window."
          );
        }
      }
      return this.acceptNormalizedProvider(provider, channelId, payload, now);
    } catch (error) {
      if (provider !== "trackalacker" && channelId) {
        try {
          this.providers.recordIngress(
            channelId,
            false,
            error instanceof Error ? error.message : "provider_signal_rejected",
            "",
            now
          );
        } catch {
          // Invalid and cross-scope channel identifiers remain indistinguishable.
        }
      }
      throw error;
    }
  }

  acceptProviderBatch(envelopes: SignalProviderEnvelope[], now = Date.now()): SignalProviderBatchReceipt {
    if (!Array.isArray(envelopes) || envelopes.length < 1 || envelopes.length > MAX_PROVIDER_BATCH) {
      throw new InputValidationError(`A signal batch must contain 1 through ${MAX_PROVIDER_BATCH} provider envelopes.`);
    }
    const receipts: SignalProviderBatchReceipt["receipts"] = [];
    envelopes.forEach((envelope, index) => {
      try {
        const receipt = this.acceptProvider(envelope, now + index);
        receipts.push({
          index,
          accepted: true,
          retryable: false,
          signalId: receipt.signalId,
          duplicate: receipt.duplicate,
          processingState: receipt.processingState,
          errorCode: ""
        });
      } catch (error) {
        const retryable = (error as { retryable?: unknown } | null)?.retryable !== false;
        const errorCode = (String((error as { code?: unknown } | null)?.code || "")
          || (error instanceof Error ? error.message : "signal_rejected"))
          .toLocaleLowerCase("en-US")
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 80) || "signal_rejected";
        receipts.push({
          index,
          accepted: false,
          retryable,
          signalId: String(envelope?.signal?.signalId ?? "").slice(0, 160),
          duplicate: false,
          processingState: "rejected",
          errorCode
        });
      }
    });
    return {
      accepted: receipts.filter((receipt) => receipt.accepted).length,
      rejected: receipts.filter((receipt) => !receipt.accepted).length,
      receipts
    };
  }

  private acceptNormalizedProvider(
    provider: SignalProvider,
    channelId: string,
    payload: SignalEventInput,
    now: number
  ): DurableSignalIngressReceipt {
    const owner = currentRequestScope();
    // TrackaLacker's durable idempotency key is an already-qualified contract
    // shared with the inactive PostgreSQL boundary. Keep it byte-for-byte
    // stable; provider-specific ingress uses the additive v2 namespace.
    const messageKey = provider === "trackalacker"
      ? `signal:${stableHash(
        "yoink_durable_signal_ingress_v1",
        owner.tenantId,
        owner.userId,
        payload.sourceConnectionId,
        payload.signalId
      )}`
      : `signal:${stableHash(
        "yoink_durable_signal_ingress_v2",
        owner.tenantId,
        owner.userId,
        provider,
        payload.sourceConnectionId,
        payload.signalId
      )}`;
    return this.db.transaction(() => {
      const inbox = this.delivery.acceptInbox({
        source: provider,
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
      const receipt: DurableSignalIngressReceipt = {
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
      if (channelId) this.providers.recordIngress(channelId, true, "", String(payload.observedAt), now);
      if (receipt.processingState === "queued" && this.wakeWorker) {
        void Promise.resolve().then(() => this.wakeWorker?.()).catch(() => undefined);
      }
      if (receipt.processingState === "queued" && this.onSignalQueued) {
        void Promise.resolve().then(() => this.onSignalQueued?.()).catch(() => undefined);
      }
      return receipt;
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
        const provider = lease.source as SignalProvider;
        if (!PROVIDERS.has(provider) || lease.eventType !== SIGNAL_INGRESS_EVENT_TYPE) {
          throw processingError("signal_ingress_contract_mismatch");
        }
        processed = this.engine.process(
          durableSignal(lease.payload as unknown as SignalEventInput, provider, now),
          now
        );
      } catch (error) {
        try {
          // A permanent failure cannot succeed on retry: dead-letter it now
          // instead of burning every attempt first (CORE-19).
          const disposition = signalFailureIsPermanent(error)
            ? this.delivery.deadLetterInbox(lease.id, lease.capabilityToken, "signal_rejected_invalid", now)
            : this.delivery.retryInbox(lease.id, lease.capabilityToken, "signal_processing_failed", SIGNAL_RETRY_SECONDS, now);
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
        // Count only new jobs: a corroborated or sibling-claimed signal carries
        // the existing job's id and must not inflate the metric or wake Chrome.
        if (processed.actionJobId && !processed.corroborated && !processed.duplicate) {
          result.signalActionJobsCreated += 1;
        }
      } catch {
        uncertainTransition = true;
      }
    }
    if (uncertainTransition) throw processingError("signal_ingress_transition_uncertain");
    return result;
  }
}
