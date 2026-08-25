import type { BackgroundTaskKind } from "../../domain/src/background-task.js";
import {
  BackgroundTaskRepository,
  type BackgroundTaskResult
} from "../../database/src/background-task-repository.js";
import { AdapterDiagnosticRepository } from "../../database/src/adapter-diagnostic-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import { ExecutionRepository } from "../../database/src/execution-repository.js";
import { HostedDeliveryRepository } from "../../database/src/hosted-delivery-repository.js";
import { NotificationRepository } from "../../database/src/notification-repository.js";
import { OperationalTelemetryRepository } from "../../database/src/operational-telemetry-repository.js";
import { OperatorAlertRepository } from "../../database/src/operator-alert-repository.js";
import { SpendLedgerRepository } from "../../database/src/spend-ledger-repository.js";

export interface BackgroundTaskHandler {
  execute(taskKind: BackgroundTaskKind, now?: number): BackgroundTaskResult;
}

export class BackgroundMaintenanceHandler implements BackgroundTaskHandler {
  private readonly adapterDiagnostics: AdapterDiagnosticRepository;
  private readonly backgroundTasks: BackgroundTaskRepository;
  private readonly execution: ExecutionRepository;
  private readonly hostedDelivery: HostedDeliveryRepository;
  private readonly notifications: NotificationRepository;
  private readonly operationalTelemetry: OperationalTelemetryRepository;
  private readonly operatorAlerts: OperatorAlertRepository;
  private readonly spendLedger: SpendLedgerRepository;

  constructor(db: YoinkDatabase) {
    this.adapterDiagnostics = new AdapterDiagnosticRepository(db);
    this.backgroundTasks = new BackgroundTaskRepository(db);
    this.execution = new ExecutionRepository(db);
    this.hostedDelivery = new HostedDeliveryRepository(db);
    this.notifications = new NotificationRepository(db);
    this.operationalTelemetry = new OperationalTelemetryRepository(db);
    this.operatorAlerts = new OperatorAlertRepository(db);
    this.spendLedger = new SpendLedgerRepository(db);
  }

  execute(taskKind: BackgroundTaskKind, now = Date.now()): BackgroundTaskResult {
    switch (taskKind) {
      case "execution_recovery":
        return {
          recoveredActionLeases: this.execution.recoverExpiredLeases(now),
          expiredActionJobs: this.execution.expirePendingJobs(now),
          releasedSpendReservations: this.spendLedger.releaseExpired(now)
        };
      case "notification_recovery":
        return this.notifications.recoverExpired(now);
      case "hosted_delivery_recovery":
        return this.hostedDelivery.recoverExpiredLeases(now);
      case "adapter_alert_reconciliation":
        return this.operatorAlerts.reconcileAdapterRepairs(
          this.adapterDiagnostics.listRepairQueue(2_000),
          `background_alert_reconciliation_${new Date(now).toISOString().replace(/[^0-9]/g, "").slice(0, 17)}`,
          now
        );
      case "operational_telemetry_retention": {
        const result = this.operationalTelemetry.pruneExpired(now);
        const taskHistory = this.backgroundTasks.pruneCompletedHistory(now);
        return {
          deletedRollupRows: result.deletedRollupRows,
          deletedErrorEvents: result.deletedErrorEvents,
          cutoffAt: result.cutoffAt,
          receiptId: result.receiptId,
          ...taskHistory
        };
      }
    }
  }
}
