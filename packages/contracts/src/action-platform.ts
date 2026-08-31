import type { Availability, SupportedRetailerId } from "./index.js";

export const DROP_WINDOW_CONTRACT_VERSION = 1 as const;
export const WATCH_QUEUE_CONTRACT_VERSION = 1 as const;
export const USER_CONNECTOR_CONTRACT_VERSION = 1 as const;
export const ORDER_CONFIRMATION_OBSERVER_CONTRACT_VERSION = 1 as const;
export const PRIVACY_POLICY_VERSION = "yoink-privacy-v1" as const;
export const PRIVACY_CHANGE_VERSION = "1.16.0" as const;

export type DropWindowKind = "drop_window" | "queue_open";
export type DropWindowStatus = "scheduled" | "active" | "superseded" | "closed" | "cancelled";
export type WatchQueueState = "queued" | "observing" | "seen_in_stock" | "window_closed" | "cancelled";

export interface DropWindowProductInput {
  listingId: string;
  earlyAccess?: {
    membership?: string;
    queueExpected?: boolean;
    note?: string;
  };
}

export interface DropWindowInput {
  contractVersion: typeof DROP_WINDOW_CONTRACT_VERSION;
  kind: DropWindowKind;
  retailerId: SupportedRetailerId;
  title: string;
  startsAt: string;
  closesAt: string;
  spreadSeconds: number;
  confidenceBps: number;
  timezone: string;
  authorNote?: string;
  supersedesId?: string;
  products: DropWindowProductInput[];
}

export interface WatchQueueObservationInput {
  contractVersion: typeof WATCH_QUEUE_CONTRACT_VERSION;
  capabilityToken: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  availability: Availability;
  unitPriceCents?: number | null;
  currency?: string;
  sellerName?: string;
  sellerType?: "first_party" | "third_party" | "unknown";
  fulfillment?: "shipping" | "pickup" | "either" | "manual" | "unknown";
  observerVersion: string;
  observedAt: string;
  extensionVersion: string;
  reasonCode?: string;
}

export type UserConnectorKind = "discord" | "slack" | "webhook";
export type UserConnectorEvent = "carted" | "needs_you" | "missed" | "test";

export interface UserActionConnectorInput {
  contractVersion: typeof USER_CONNECTOR_CONTRACT_VERSION;
  kind: UserConnectorKind;
  name: string;
  endpointReference: string;
  enabled?: boolean;
  events: UserConnectorEvent[];
}

export interface RetailerSessionReadinessInput {
  contractVersion: typeof WATCH_QUEUE_CONTRACT_VERSION;
  retailerId: SupportedRetailerId;
  signedInState: "unknown" | "ready" | "signed_out" | "challenged";
  cartBaselineState: "unknown" | "ready" | "stale" | "unavailable";
  baselineObservedAt?: string;
  expiresAt?: string;
  adapterVersion: string;
  errorCode?: string;
}

export interface OrderConfirmationObservationInput {
  contractVersion: typeof ORDER_CONFIRMATION_OBSERVER_CONTRACT_VERSION;
  actionJobId: string;
  retailerId: SupportedRetailerId;
  pageClass: "confirmation";
  observedAt: string;
}
