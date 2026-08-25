import type { BackgroundTaskResult } from "../../domain/src/background-task.js";
import { OperatorAlertConnectorRepository } from "../../database/src/operator-alert-connector-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import type {
  OperatorAlertWebhookRegistry,
  OperatorAlertWebhookTransport
} from "./operator-alert-webhook.js";

const MAXIMUM_DELIVERIES_PER_RUN = 20;

export class OperatorAlertConnectorDispatchService {
  private readonly repository: OperatorAlertConnectorRepository;
  private readonly references: string[];
  private readonly bindings: Readonly<Record<string, string>>;

  constructor(
    db: YoinkDatabase,
    registry: OperatorAlertWebhookRegistry,
    private readonly transport?: OperatorAlertWebhookTransport
  ) {
    this.references = registry.definitions.map((definition) => definition.reference);
    this.bindings = registry.bindings;
    this.repository = new OperatorAlertConnectorRepository(db, this.bindings);
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
    for (let index = 0; index < MAXIMUM_DELIVERIES_PER_RUN; index += 1) {
      const lease = this.repository.leaseNext(this.bindings, 60, now);
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
        this.repository.complete(lease.id, lease.capabilityToken, delivery.reasonCode, delivery.httpStatus, now);
        result.connectorDeliveriesSucceeded += 1;
        continue;
      }
      const retrySeconds = Math.min(3_600, 30 * (2 ** Math.max(0, lease.attempt - 1)));
      const disposition = this.repository.fail(
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
