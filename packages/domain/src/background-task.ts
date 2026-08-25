export const BACKGROUND_TASK_DEFINITIONS = Object.freeze({
  execution_recovery: Object.freeze({
    label: "Action safety recovery",
    description: "Close expired action leases and signal windows, then release stale spend reservations.",
    intervalSeconds: 30,
    maximumAttempts: 5
  }),
  notification_recovery: Object.freeze({
    label: "Notification recovery",
    description: "Expire stale notifications and safely requeue abandoned Chrome delivery leases.",
    intervalSeconds: 60,
    maximumAttempts: 5
  }),
  hosted_delivery_recovery: Object.freeze({
    label: "Signal inbox and delivery recovery",
    description: "Process packaged signal messages, then retire expired inbox and outbox capabilities safely.",
    intervalSeconds: 15,
    maximumAttempts: 5
  }),
  adapter_alert_reconciliation: Object.freeze({
    label: "Adapter alert reconciliation",
    description: "Reconcile sanitized adapter repair groups into the governed operator alert lifecycle.",
    intervalSeconds: 60,
    maximumAttempts: 5
  }),
  observer_recipe_witness_refresh: Object.freeze({
    label: "Observer trust witness refresh",
    description: "Refresh independently signed observer-recipe transparency receipts before they become stale.",
    intervalSeconds: 60,
    maximumAttempts: 5
  }),
  operational_telemetry_retention: Object.freeze({
    label: "Telemetry retention",
    description: "Apply the bounded operational telemetry retention policy and preserve deletion receipts.",
    intervalSeconds: 21_600,
    maximumAttempts: 3
  })
} as const);

export type BackgroundTaskKind = keyof typeof BACKGROUND_TASK_DEFINITIONS;
export type BackgroundTaskState = "pending" | "leased" | "retry_wait" | "succeeded" | "dead_letter" | "cancelled";
export type BackgroundTaskResultValue = string | number | boolean | null;
export type BackgroundTaskResult = Record<string, BackgroundTaskResultValue>;
export type BackgroundTaskEventType =
  | "scheduled"
  | "leased"
  | "succeeded"
  | "retry_scheduled"
  | "dead_lettered"
  | "manually_retried"
  | "cancelled";

export const BACKGROUND_TASK_KINDS = Object.freeze(
  Object.keys(BACKGROUND_TASK_DEFINITIONS) as BackgroundTaskKind[]
);

export function isBackgroundTaskKind(value: unknown): value is BackgroundTaskKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BACKGROUND_TASK_DEFINITIONS, value);
}
