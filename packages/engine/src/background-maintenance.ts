import type {
  BackgroundWorkerContext,
  BackgroundWorkerTaskHandler
} from "../../contracts/src/background-worker.js";
import type {
  BackgroundTaskKind,
  BackgroundTaskResult
} from "../../domain/src/background-task.js";
import {
  BackgroundTaskRepository
} from "../../database/src/background-task-repository.js";
import { AdapterDiagnosticRepository } from "../../database/src/adapter-diagnostic-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import { ExecutionRepository } from "../../database/src/execution-repository.js";
import { HostedDeliveryRepository } from "../../database/src/hosted-delivery-repository.js";
import { NotificationRepository } from "../../database/src/notification-repository.js";
import { OperationalTelemetryRepository } from "../../database/src/operational-telemetry-repository.js";
import { ObserverRecipeRecoveryRetentionRepository } from "../../database/src/observer-recipe-recovery-retention-repository.js";
import { OperatorAlertRepository } from "../../database/src/operator-alert-repository.js";
import { SpendLedgerRepository } from "../../database/src/spend-ledger-repository.js";
import { runWithRequestScope } from "../../database/src/request-scope.js";
import { DurableSignalIngressProcessor } from "./signal-ingress.js";
import { ObserverRecipeCandidateEvaluationService } from "./observer-recipe-candidate-evaluation.js";
import type { ObserverRecipeWitnessRefreshService } from "./observer-recipe-witness-refresh.js";
import type { OperatorAlertConnectorDispatchService } from "./operator-alert-connector-dispatch.js";

export type BackgroundTaskHandler = BackgroundWorkerTaskHandler;

export interface BackgroundMaintenanceHandlerOptions {
  observerRecipeWitnessRefresh?: Pick<ObserverRecipeWitnessRefreshService, "execute">;
  operatorAlertConnectorDispatch?: Pick<OperatorAlertConnectorDispatchService, "execute">;
  notificationRecovery?: {
    recover(
      principal: BackgroundWorkerContext["principal"],
      now: number
    ): Promise<{
      expiredNotifications: number;
      requeuedLeases: number;
      failedLeases: number;
    }>;
  };
  executionRecovery?: {
    recover(
      principal: BackgroundWorkerContext["principal"],
      now: number
    ): Promise<{
      recoveredActionLeases: number;
      expiredActionJobs: number;
      releasedSpendReservations: number;
    }>;
  };
}

export class BackgroundMaintenanceHandler implements BackgroundWorkerTaskHandler {
  private readonly adapterDiagnostics: AdapterDiagnosticRepository;
  private readonly backgroundTasks: BackgroundTaskRepository;
  private readonly execution: ExecutionRepository;
  private readonly hostedDelivery: HostedDeliveryRepository;
  private readonly notifications: NotificationRepository;
  private readonly operationalTelemetry: OperationalTelemetryRepository;
  private readonly observerRecipeRecoveryRetention: ObserverRecipeRecoveryRetentionRepository;
  private readonly operatorAlerts: OperatorAlertRepository;
  private readonly observerRecipeCandidates: ObserverRecipeCandidateEvaluationService;
  private readonly spendLedger: SpendLedgerRepository;
  private readonly signalIngress: DurableSignalIngressProcessor;

  constructor(db: YoinkDatabase, private readonly options: BackgroundMaintenanceHandlerOptions = {}) {
    this.adapterDiagnostics = new AdapterDiagnosticRepository(db);
    this.backgroundTasks = new BackgroundTaskRepository(db);
    this.execution = new ExecutionRepository(db);
    this.hostedDelivery = new HostedDeliveryRepository(db);
    this.notifications = new NotificationRepository(db);
    this.operationalTelemetry = new OperationalTelemetryRepository(db);
    this.observerRecipeRecoveryRetention = new ObserverRecipeRecoveryRetentionRepository(db);
    this.operatorAlerts = new OperatorAlertRepository(db);
    this.observerRecipeCandidates = new ObserverRecipeCandidateEvaluationService(db);
    this.spendLedger = new SpendLedgerRepository(db);
    this.signalIngress = new DurableSignalIngressProcessor(db);
  }

  async execute(
    context: BackgroundWorkerContext,
    taskKind: BackgroundTaskKind,
    now = Date.now()
  ): Promise<BackgroundTaskResult> {
    return runWithRequestScope({
      tenantId: context.principal.tenantId,
      userId: context.principal.userId,
      actorKind: "service",
      actorId: context.workerId,
      ...(taskKind === "hosted_delivery_recovery"
        ? { internalServiceCapability: "internal.delivery" as const }
        : {})
    }, () => this.executeScoped(context, taskKind, context.runtimeVersion, now));
  }

  private async executeScoped(
    context: BackgroundWorkerContext,
    taskKind: BackgroundTaskKind,
    runtimeVersion: string,
    now: number
  ): Promise<BackgroundTaskResult> {
    switch (taskKind) {
      case "execution_recovery":
        return this.options.executionRecovery
          ? this.options.executionRecovery.recover(context.principal, now)
          : {
              recoveredActionLeases: this.execution.recoverExpiredLeases(now),
              expiredActionJobs: this.execution.expirePendingJobs(now),
              releasedSpendReservations: this.spendLedger.releaseExpired(now)
            };
      case "notification_recovery":
        return this.options.notificationRecovery
          ? this.options.notificationRecovery.recover(context.principal, now)
          : this.notifications.recoverExpired(now);
      case "hosted_delivery_recovery":
        return {
          ...this.hostedDelivery.recoverExpiredLeases(now),
          ...this.signalIngress.processBatch(now)
        };
      case "adapter_alert_reconciliation":
        return {
          ...this.operatorAlerts.reconcileAdapterRepairs(
            this.adapterDiagnostics.listRepairQueue(2_000),
            `background_alert_reconciliation_${new Date(now).toISOString().replace(/[^0-9]/g, "").slice(0, 17)}`,
            now
          ),
          ...(this.options.operatorAlertConnectorDispatch
            ? await this.options.operatorAlertConnectorDispatch.execute(now)
            : {
                connectorRegistryConfigured: false,
                connectorTransportConfigured: false,
                connectorDeliveriesAttempted: 0,
                connectorDeliveriesSucceeded: 0,
                connectorDeliveriesRetried: 0,
                connectorDeliveriesDeadLettered: 0
              })
        };
      case "observer_recipe_candidate_evaluation":
        return this.observerRecipeCandidates.execute(runtimeVersion, now);
      case "observer_recipe_witness_refresh":
        return this.options.observerRecipeWitnessRefresh
          ? this.options.observerRecipeWitnessRefresh.execute(now)
          : {
              witnessConfigured: false,
              checkpointReady: false,
              refreshAttempted: false,
              receiptAccepted: false,
              deliveryAllowed: true,
              witnessState: "disabled",
              witnessSequence: 0
            };
      case "operational_telemetry_retention": {
        const result = this.operationalTelemetry.pruneExpired(now);
        const taskHistory = this.backgroundTasks.pruneCompletedHistory(now);
        const recoveryEvidence = this.observerRecipeRecoveryRetention.prune(now);
        return {
          deletedRollupRows: result.deletedRollupRows,
          deletedErrorEvents: result.deletedErrorEvents,
          cutoffAt: result.cutoffAt,
          receiptId: result.receiptId,
          ...taskHistory,
          ...recoveryEvidence
        };
      }
    }
  }
}
