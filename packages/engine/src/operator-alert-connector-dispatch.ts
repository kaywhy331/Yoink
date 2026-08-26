import type { BackgroundTaskResult } from "../../domain/src/background-task.js";
import {
  OperatorAlertConnectorRepository,
  type OperatorAlertConnectorLease
} from "../../database/src/operator-alert-connector-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import type {
  OperatorAlertWebhookRegistry,
  OperatorAlertWebhookTransport
} from "./operator-alert-webhook.js";

export const OPERATOR_ALERT_CONNECTOR_MAXIMUM_DELIVERIES_PER_RUN = 20;

type MaybePromise<T> = T | Promise<T>;

export interface OperatorAlertConnectorDispatchRepositoryPort {
  expireExhaustedLeases(
    availableBindings: Readonly<Record<string, string>>,
    now?: number
  ): MaybePromise<number>;
  leaseNext(
    availableBindings: Readonly<Record<string, string>>,
    leaseSeconds?: number,
    now?: number
  ): MaybePromise<OperatorAlertConnectorLease | null>;
  complete(
    id: string,
    capabilityToken: string,
    reasonCode: string,
    httpStatus: number,
    now?: number
  ): MaybePromise<boolean>;
  fail(
    id: string,
    capabilityToken: string,
    reasonCode: string,
    httpStatus: number,
    retryAfterSeconds: number,
    permanent: boolean,
    now?: number
  ): MaybePromise<"retry" | "dead_letter">;
}

export class OperatorAlertConnectorDispatchService {
  private readonly repository: OperatorAlertConnectorDispatchRepositoryPort;
  private readonly references: string[];
  private readonly bindings: Readonly<Record<string, string>>;

  constructor(
    databaseOrRepository: YoinkDatabase | OperatorAlertConnectorDispatchRepositoryPort,
    registry: OperatorAlertWebhookRegistry,
    private readonly transport?: OperatorAlertWebhookTransport
  ) {
    this.references = registry.definitions.map((definition) => definition.reference);
    this.bindings = registry.bindings;
    this.repository = "leaseNext" in databaseOrRepository
      ? databaseOrRepository
      : new OperatorAlertConnectorRepository(databaseOrRepository, this.bindings);
  }

  async execute(now = Date.now()): Promise<BackgroundTaskResult> {
    const result = {
      connectorRegistryConfigured: this.references.length > 0,
      connectorTransportConfigured: this.transport !== undefined,
      connectorDeliveriesAttempted: 0,
      connectorDeliveriesSucceeded: 0,
      connectorDeliveriesRetried: 0,
      connectorDeliveriesDeadLettered: 0
    };
    if (!this.transport || !this.references.length) return result;
    result.connectorDeliveriesDeadLettered += await this.repository.expireExhaustedLeases(this.bindings, now);
    for (let index = 0; index < OPERATOR_ALERT_CONNECTOR_MAXIMUM_DELIVERIES_PER_RUN; index += 1) {
      const lease = await this.repository.leaseNext(this.bindings, 60, now);
      if (!lease) break;
      result.connectorDeliveriesAttempted += 1;
      let delivery;
      try {
        delivery = await this.transport.deliver({
          deliveryId: lease.id,
          eventId: lease.eventId,
          endpointReference: lease.endpointReference,
          payload: { ...lease.payload }
        });
      } catch {
        delivery = { disposition: "retry" as const, reasonCode: "webhook_transport_failed", httpStatus: 0 };
      }
      if (delivery.disposition === "delivered") {
        await this.repository.complete(lease.id, lease.capabilityToken, delivery.reasonCode, delivery.httpStatus, now);
        result.connectorDeliveriesSucceeded += 1;
        continue;
      }
      const retrySeconds = Math.min(3_600, 30 * (2 ** Math.max(0, lease.attempt - 1)));
      const disposition = await this.repository.fail(
        lease.id,
        lease.capabilityToken,
        delivery.reasonCode,
        delivery.httpStatus,
        retrySeconds,
        delivery.disposition === "dead_letter",
        now
      );
      if (disposition === "dead_letter") result.connectorDeliveriesDeadLettered += 1;
      else result.connectorDeliveriesRetried += 1;
    }
    return result;
  }
}
