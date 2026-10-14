import type { YoinkDatabase } from "../../database/src/database.js";
import { runWithRequestScope } from "../../database/src/request-scope.js";
import { UserActionConnectorRepository } from "../../database/src/user-action-connector-repository.js";
import type { UserActionConnectorDispatchService } from "./user-action-connector-dispatch.js";

/** Urgent shopper messages are independent of periodic operator maintenance. */
export class UserBotDispatchRuntime {
  private timer: ReturnType<typeof setInterval> | undefined;
  private scheduled: Promise<void> | null = null;
  private readonly active = new Set<Promise<void>>();
  private readonly perPrincipal = new Map<string, number>();
  private stopped = true;

  constructor(private readonly db: YoinkDatabase,
    private readonly dispatcher: Pick<UserActionConnectorDispatchService, "execute">) {}

  start(): void {
    if (!this.stopped) return;
    this.recoverTelegramConfirmations();
    this.stopped = false;
    this.timer = setInterval(() => this.wake(), 1_000);
    this.timer.unref();
    this.wake();
  }

  private recoverTelegramConfirmations(): void {
    // v1.30.45 linked customers without a welcome. Recover only opted-in,
    // currently bound managed connections with no delivery history at all.
    // Any prior attempt (including a failed one) prevents another welcome.
    this.db.transaction(() => {
      const connections = this.db.all<{id: string; tenantId: string; userId: string}>(`SELECT c.id,
        c.tenant_id AS tenantId, c.user_id AS userId FROM user_action_connectors c
        JOIN user_bot_credentials b ON b.connector_id=c.id AND b.tenant_id=c.tenant_id AND b.user_id=c.user_id
        JOIN bot_providers p ON p.id=b.provider_id AND p.tenant_id=c.tenant_id
        WHERE c.kind='telegram' AND c.enabled=1 AND p.enabled=1 AND p.bot_identity=b.provider_identity
          AND p.kind='telegram' AND c.endpoint_reference=b.endpoint_reference
          AND c.last_delivery_at='' AND c.last_error_code=''
          AND c.endpoint_binding_fingerprint=b.binding_fingerprint
          AND EXISTS (SELECT 1 FROM json_each(c.events_json) WHERE value='test')
          AND NOT EXISTS (SELECT 1 FROM user_action_connector_deliveries d WHERE d.connector_id=c.id)`);
      for (const connection of connections) {
        runWithRequestScope({...connection, actorKind: "service", actorId: "yoinkbot_dispatch"},
          () => new UserActionConnectorRepository(this.db).queueConnectionConfirmation(connection.id));
      }
    });
  }

  wake(): void {
    if (this.stopped || this.scheduled) return;
    // Defer until the caller's transaction has committed. Individual sends occupy
    // slots, so a slow send never holds a barrier in front of a newly arrived alert.
    this.scheduled = Promise.resolve().then(() => {
      if (this.stopped) return;
      const timestamp = new Date().toISOString();
      const principals = this.db.all<{ tenantId: string; userId: string }>(
        `SELECT DISTINCT d.tenant_id AS tenantId, d.user_id AS userId
         FROM user_action_connector_deliveries d JOIN user_action_connectors c ON c.id=d.connector_id
         WHERE c.enabled=1 AND ((d.state IN ('pending','retry_wait')
           AND (d.next_attempt_at='' OR d.next_attempt_at<=?))
           OR (d.state='leased' AND d.lease_expires_at<=?)) LIMIT 100`, timestamp, timestamp);
      for (const principal of principals) {
        const key = JSON.stringify([principal.tenantId, principal.userId]);
        while ((this.perPrincipal.get(key) || 0) < 4 && this.active.size < 32) {
          this.perPrincipal.set(key, (this.perPrincipal.get(key) || 0) + 1);
          let attempted = false;
          const task = runWithRequestScope({ ...principal, actorKind: "service", actorId: "yoinkbot_dispatch" },
            async () => { const result = await this.dispatcher.execute(Date.now(), 1); attempted = Number(result.userConnectorDeliveriesAttempted) > 0; })
            .catch(() => { /* Durable leases recover after a transport or database interruption. */ })
            .finally(() => {
              this.active.delete(task);
              const remaining = (this.perPrincipal.get(key) || 1) - 1;
              if (remaining) this.perPrincipal.set(key, remaining); else this.perPrincipal.delete(key);
              if (attempted) this.wake();
            });
          this.active.add(task);
        }
      }
    }).catch(() => { /* Database shutdown/restart is recovered by the next tick. */ })
      .finally(() => { this.scheduled = null; });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.scheduled;
    await Promise.allSettled([...this.active]);
  }
}
