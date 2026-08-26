import type { BackgroundTaskResult } from "../../domain/src/background-task.js";
import {
  ObserverRecipeWitnessError,
  type ObserverRecipeWitnessFailureCode,
  type ObserverRecipeWitnessPublisher
} from "../../observer-registry/src/witness.js";
import type { ObserverRecipeWitnessCheckpoint } from "../../contracts/src/index.js";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";

type MaybePromise<T> = T | Promise<T>;

interface WitnessStatus {
  state?: unknown;
  deliveryAllowed?: unknown;
  checkpoint?: { transparencyEventHash?: unknown } | null;
  latestReceipt?: {
    witnessSequence?: unknown;
    transparencyEventHash?: unknown;
    witnessedAt?: unknown;
    validUntil?: unknown;
  } | null;
}

export interface ObserverRecipeWitnessStatePort {
  witnessCheckpoint(now?: number): MaybePromise<ObserverRecipeWitnessCheckpoint | null>;
  previousWitnessReceiptHash(): MaybePromise<string>;
  acceptWitnessReceipt(value: unknown, now?: number): MaybePromise<Record<string, unknown>>;
  recordWitnessFailure(
    code: ObserverRecipeWitnessFailureCode,
    now?: number
  ): MaybePromise<Record<string, unknown>>;
  witnessStatus(now?: number): MaybePromise<Record<string, unknown>>;
}

export interface PrincipalBoundObserverRecipeWitnessStateFactory {
  forPrincipal(
    principal: BackgroundWorkerPrincipal,
    runtimeVersion: string
  ): MaybePromise<ObserverRecipeWitnessStatePort>;
}

export class ObserverRecipeWitnessRefreshError extends Error {
  readonly code: string;

  constructor(reason: ObserverRecipeWitnessFailureCode, cause?: unknown) {
    super("The independent observer recipe witness refresh failed closed.", { cause });
    this.name = "ObserverRecipeWitnessRefreshError";
    this.code = `observer_recipe_witness_${reason}`;
  }
}

function timestamp(value: unknown): number {
  const parsed = new Date(String(value ?? "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function boundedState(value: unknown): string {
  const normalized = String(value ?? "unknown").toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_");
  return normalized.slice(0, 80) || "unknown";
}

function result(
  status: WitnessStatus,
  values: { checkpointReady: boolean; refreshAttempted: boolean; receiptAccepted: boolean }
): BackgroundTaskResult {
  return {
    witnessConfigured: true,
    checkpointReady: values.checkpointReady,
    refreshAttempted: values.refreshAttempted,
    receiptAccepted: values.receiptAccepted,
    deliveryAllowed: status.deliveryAllowed === true,
    witnessState: boundedState(status.state),
    witnessSequence: Math.max(0, Math.floor(Number(status.latestReceipt?.witnessSequence) || 0))
  };
}

export class ObserverRecipeWitnessRefreshService {
  constructor(
    private readonly state: ObserverRecipeWitnessStatePort,
    private readonly publisher: ObserverRecipeWitnessPublisher
  ) {}

  async execute(now = Date.now()): Promise<BackgroundTaskResult> {
    const checkpoint = await this.state.witnessCheckpoint(now);
    const before = await this.state.witnessStatus(now) as WitnessStatus;
    if (!checkpoint) {
      return result(before, { checkpointReady: false, refreshAttempted: false, receiptAccepted: false });
    }

    const receipt = before.latestReceipt;
    const maxAgeMs = this.publisher.verifier.maxAgeSeconds * 1_000;
    const refreshLeadMs = Math.min(maxAgeMs, Math.max(60_000, Math.floor(maxAgeMs / 2)));
    const freshnessDeadline = timestamp(receipt?.witnessedAt) + maxAgeMs;
    const validityDeadline = timestamp(receipt?.validUntil);
    const matchesCheckpoint = String(receipt?.transparencyEventHash ?? "") === checkpoint.transparencyEventHash;
    const refreshDue = before.state !== "healthy"
      || !matchesCheckpoint
      || freshnessDeadline <= now + refreshLeadMs
      || validityDeadline <= now + refreshLeadMs;
    if (!refreshDue) {
      return result(before, { checkpointReady: true, refreshAttempted: false, receiptAccepted: false });
    }

    try {
      const receiptEnvelope = await this.publisher.publish(
        checkpoint,
        await this.state.previousWitnessReceiptHash(),
        now
      );
      const accepted = await this.state.acceptWitnessReceipt(receiptEnvelope, now) as WitnessStatus;
      return result(accepted, { checkpointReady: true, refreshAttempted: true, receiptAccepted: true });
    } catch (error) {
      const reason = error instanceof ObserverRecipeWitnessError ? error.code : "unavailable";
      await this.state.recordWitnessFailure(reason, now);
      throw new ObserverRecipeWitnessRefreshError(reason, error);
    }
  }
}

export class PrincipalBoundObserverRecipeWitnessRefreshService {
  constructor(
    private readonly states: PrincipalBoundObserverRecipeWitnessStateFactory,
    private readonly publisher: ObserverRecipeWitnessPublisher
  ) {}

  async execute(
    principal: BackgroundWorkerPrincipal,
    runtimeVersion: string,
    now = Date.now()
  ): Promise<BackgroundTaskResult> {
    const state = await this.states.forPrincipal(principal, runtimeVersion);
    return new ObserverRecipeWitnessRefreshService(state, this.publisher).execute(now);
  }
}
