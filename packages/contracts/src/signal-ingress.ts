import type { SignalEventInput } from "./index.js";

export const SIGNAL_INGRESS_EVENT_TYPE = "signal_event_v1" as const;

export type DurableSignalIngressState = "queued" | "processed" | "dead_letter";

export interface DurableSignalIngressReceipt {
  accepted: true;
  signalId: string;
  duplicate: boolean;
  processingState: DurableSignalIngressState;
  inboxReceiptId: string;
  backgroundTaskId: string;
  backgroundTaskCreated: boolean;
  backgroundWakeState: "created" | "deduplicated" | "schedule_paused" | "not_required";
}

export interface DurableSignalRetryReceipt {
  retried: true;
  processingState: "queued";
  inboxReceiptId: string;
  backgroundTaskId: string;
  backgroundTaskCreated: boolean;
  backgroundWakeState: "created" | "deduplicated" | "schedule_paused";
}

export interface DurableSignalEnvelope {
  eventType: typeof SIGNAL_INGRESS_EVENT_TYPE;
  payload: SignalEventInput;
}

export interface SignalIngressBatchResult {
  signalMessagesProcessed: number;
  signalMessagesRetried: number;
  signalMessagesDeadLettered: number;
  signalDuplicatesObserved: number;
  signalActionJobsCreated: number;
}
