import { nowIso } from "../../domain/src/ids.js";
import { AuditRepository } from "./audit-repository.js";
import { type YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

/** Raw signal and delivery history older than this is removed (DB-08). */
export const SIGNAL_HISTORY_RETENTION_DAYS = 90;
/** Rows removed per table per run, so one pass never holds the write lock for long. */
export const SIGNAL_HISTORY_RETENTION_BATCH = 5_000;

const DAY_MS = 24 * 60 * 60_000;

export interface SignalHistoryRetentionResult {
  deletedSignalEvents: number;
  deletedOfferObservations: number;
  deletedNotificationDeliveries: number;
  signalHistoryCutoffAt: string;
  signalHistoryRetentionReceiptId: string;
}

/**
 * Bounded retention for the signal pipeline's raw history. Only evidence that
 * nothing live or financial points at is removed:
 *
 * - `signal_events` older than the window whose occurrences never reached an
 *   open incident or an incident with an action job (occurrences, resolution
 *   and mission decisions cascade with the event);
 * - `offer_observations` older than the window that no offer snapshot cites,
 *   keeping each listing's newest observation;
 * - terminal `notification_deliveries` older than the window.
 *
 * Action jobs, action events, spend and order evidence are retained: they are
 * the shopper's purchase record and spend ledger rows reference them.
 */
export class SignalHistoryRetentionRepository {
  private readonly audit: AuditRepository;

  constructor(
    private readonly db: YoinkDatabase,
    private readonly retentionDays = SIGNAL_HISTORY_RETENTION_DAYS,
    private readonly batchSize = SIGNAL_HISTORY_RETENTION_BATCH
  ) {
    if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 3_650) {
      throw new Error("Signal history retention must be from 7 through 3,650 days.");
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100_000) {
      throw new Error("Signal history retention batch must be from 1 through 100,000 rows.");
    }
    this.audit = new AuditRepository(db);
  }

  prune(now = Date.now()): SignalHistoryRetentionResult {
    const scope = currentRequestScope();
    if (scope.actorKind !== "service") throw new Error("Signal history retention requires a trusted worker scope.");
    const signalHistoryCutoffAt = nowIso(now - this.retentionDays * DAY_MS);
    return this.db.transaction(() => {
      const deletedSignalEvents = Number(this.db.run(
        `DELETE FROM signal_events WHERE id IN (
           SELECT se.id FROM signal_events se
           WHERE se.tenant_id = ? AND se.user_id = ? AND se.received_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM signal_occurrences occurrence
               JOIN signal_incidents incident ON incident.id = occurrence.incident_id
               WHERE occurrence.event_id = se.id
                 AND (incident.status <> 'closed'
                   OR EXISTS (SELECT 1 FROM action_jobs aj WHERE aj.incident_id = incident.id))
             )
           ORDER BY se.received_at LIMIT ?
         )`,
        scope.tenantId,
        scope.userId,
        signalHistoryCutoffAt,
        this.batchSize
      ).changes ?? 0);
      const deletedOfferObservations = Number(this.db.run(
        `DELETE FROM offer_observations WHERE id IN (
           SELECT oo.id FROM offer_observations oo
           WHERE oo.observed_at <= ?
             AND NOT EXISTS (SELECT 1 FROM offer_snapshots os WHERE os.source_observation_id = oo.id)
             AND EXISTS (
               SELECT 1 FROM offer_observations newer
               WHERE newer.listing_id = oo.listing_id AND newer.observed_at > oo.observed_at
             )
           ORDER BY oo.observed_at LIMIT ?
         )`,
        signalHistoryCutoffAt,
        this.batchSize
      ).changes ?? 0);
      const deletedNotificationDeliveries = Number(this.db.run(
        `DELETE FROM notification_deliveries WHERE id IN (
           SELECT id FROM notification_deliveries
           WHERE tenant_id = ? AND user_id = ? AND updated_at <= ?
             AND state IN ('delivered', 'clicked', 'dismissed', 'failed', 'expired')
           ORDER BY updated_at LIMIT ?
         )`,
        scope.tenantId,
        scope.userId,
        signalHistoryCutoffAt,
        this.batchSize
      ).changes ?? 0);
      let signalHistoryRetentionReceiptId = "";
      if (deletedSignalEvents || deletedOfferObservations || deletedNotificationDeliveries) {
        signalHistoryRetentionReceiptId = String(this.audit.record({
          correlationId: `signal_retention_${now}`,
          aggregateType: "retention",
          eventType: "signal_history_retention_applied",
          reasonCode: "retention_window_elapsed",
          message: "Expired signal, offer observation and delivery history was removed under the documented retention policy.",
          data: {
            deletedSignalEvents,
            deletedOfferObservations,
            deletedNotificationDeliveries,
            signalHistoryCutoffAt,
            signalHistoryRetentionDays: this.retentionDays,
            batchSize: this.batchSize
          }
        }, now).id ?? "");
      }
      return {
        deletedSignalEvents,
        deletedOfferObservations,
        deletedNotificationDeliveries,
        signalHistoryCutoffAt,
        signalHistoryRetentionReceiptId
      };
    });
  }
}
