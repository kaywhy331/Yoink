import type {
  Availability,
  Fulfillment,
  SellerType,
  SignalEventInput,
  SupportedRetailerId
} from "./index.js";

export const SIGNAL_PROVIDER_CONTRACT_VERSION = 1 as const;
export const SIGNAL_PROVIDERS = ["trackalacker", "discord", "drop_window", "api"] as const;
export type SignalProvider = typeof SIGNAL_PROVIDERS[number];

/**
 * The single provider-neutral door into the existing signal_event_v1 durable
 * inbox. Adapters may create this envelope, but only the normalized signal is
 * persisted by the ingress service.
 */
export interface SignalProviderEnvelope {
  contractVersion: typeof SIGNAL_PROVIDER_CONTRACT_VERSION;
  provider: SignalProvider;
  channelId?: string;
  signal: SignalEventInput;
}

export interface SignalProviderBatchEnvelope {
  contractVersion: typeof SIGNAL_PROVIDER_CONTRACT_VERSION;
  signals: SignalProviderEnvelope[];
}

export interface SignalProviderBatchReceipt {
  accepted: number;
  rejected: number;
  receipts: Array<{
    index: number;
    accepted: boolean;
    /** Whether the exact item should remain queued for a later delivery cycle. */
    retryable: boolean;
    signalId: string;
    duplicate: boolean;
    processingState: "queued" | "processed" | "dead_letter" | "rejected";
    errorCode: string;
  }>;
}

export interface DiscordSignalFacts {
  eventType: SignalEventInput["eventType"];
  retailerId: SupportedRetailerId;
  retailerSku: string;
  canonicalUrl: string;
  title?: string;
  availability?: Availability;
  unitPriceCents?: number | null;
  currency?: string;
  sellerName?: string;
  sellerType?: SellerType;
  fulfillment?: Fulfillment;
  orderLimit?: number | null;
}

/**
 * A deliberately author-free Discord projection. The forwarding connector
 * supplies one channel/message identity plus structured commerce facts; user
 * handles, avatars, attachments, reactions, and arbitrary embed JSON are not
 * accepted by this contract.
 */
export interface DiscordChannelSignalInput {
  contractVersion: typeof SIGNAL_PROVIDER_CONTRACT_VERSION;
  channelId: string;
  messageId: string;
  observedAt: string;
  test?: boolean;
  summary?: string;
  facts: DiscordSignalFacts;
}

export interface SignalProviderChannelInput {
  provider: Exclude<SignalProvider, "trackalacker">;
  name: string;
  externalReference: string;
  trustLevel: "informational" | "trusted_exact";
  autoCreateMissions?: boolean;
  replayWindowSeconds?: number;
}

export interface SignalProviderChannelUpdate {
  name?: string;
  trustLevel?: "informational" | "trusted_exact";
  status?: "active" | "paused" | "disabled";
  autoCreateMissions?: boolean;
  replayWindowSeconds?: number;
}
