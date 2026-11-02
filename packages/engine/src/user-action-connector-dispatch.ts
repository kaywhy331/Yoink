import type { YoinkDatabase } from "../../database/src/database.js";
import { UserActionConnectorRepository } from "../../database/src/user-action-connector-repository.js";
import type { UserActionWebhookRegistry, UserActionWebhookTransport } from "./user-action-webhook.js";

export class UserActionConnectorDispatchService {
  private readonly repository: UserActionConnectorRepository;

  constructor(
    db: YoinkDatabase,
    registry: UserActionWebhookRegistry,
    private readonly transport?: UserActionWebhookTransport
  ) {
    this.repository = new UserActionConnectorRepository(db, registry.bindings);
  }

  async execute(now = Date.now(), maximum = 20): Promise<Record<string, number | boolean>> {
    const result = {
      userConnectorConfigured: true,
      userConnectorTransportConfigured: Boolean(this.transport),
      userConnectorDeliveriesAttempted: 0,
      userConnectorDeliveriesSucceeded: 0,
      userConnectorDeliveriesRetried: 0,
      userConnectorDeliveriesDeadLettered: 0
    };
    const transport = this.transport;
    if (!transport) return result;
    const limit = Math.max(1, Math.min(100, Math.floor(Number(maximum) || 20)));
    const started = Date.now();
    const clock = () => now + Date.now() - started;
    let claimed = 0;
    const drain = async () => {
      while (claimed < limit) {
        const lease = this.repository.leaseNext(clock());
        if (!lease) return;
        claimed += 1;
        result.userConnectorDeliveriesAttempted += 1;
        let delivery;
        try {
          delivery = await transport.deliver({
            deliveryId: lease.id,
            connectorKind: lease.connectorKind,
            endpointReference: lease.endpointReference,
            payload: lease.payload
          });
        } catch {
          delivery = { delivered: false, retryable: true, reasonCode: "connector_transport_failed", httpStatus: 0 };
        }
        if (delivery.delivered) {
          this.repository.complete(lease.id, lease.capabilityToken, clock(), delivery.providerMessageId);
          result.userConnectorDeliveriesSucceeded += 1;
        } else {
          const receipt = this.repository.fail(
            lease.id,
            lease.capabilityToken,
            delivery.reasonCode,
            delivery.retryable,
            clock(),
            delivery.retryAfterMs
          );
          if (receipt.state === "retry_wait") result.userConnectorDeliveriesRetried += 1;
          else result.userConnectorDeliveriesDeadLettered += 1;
        }
      }
    };
    // One outstanding delivery per destination is enforced by the lease query.
    // A slow provider cannot hold up the user's other destination.
    await Promise.all(Array.from({ length: 4 }, () => drain()));
    return result;
  }
}
