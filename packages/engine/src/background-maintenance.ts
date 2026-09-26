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
import { AuditRepository } from "../../database/src/audit-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import { ExecutionRepository } from "../../database/src/execution-repository.js";
import { HostedDeliveryRepository } from "../../database/src/hosted-delivery-repository.js";
import { NotificationRepository } from "../../database/src/notification-repository.js";
import { OperationalTelemetryRepository } from "../../database/src/operational-telemetry-repository.js";
import { ObserverRecipeRecoveryRetentionRepository } from "../../database/src/observer-recipe-recovery-retention-repository.js";
import { OperatorAlertRepository } from "../../database/src/operator-alert-repository.js";
import { SpendLedgerRepository } from "../../database/src/spend-ledger-repository.js";
import { SignalHistoryRetentionRepository } from "../../database/src/signal-history-retention-repository.js";
import { runWithRequestScope } from "../../database/src/request-scope.js";
import { DurableSignalIngressProcessor } from "./signal-ingress.js";
import { ObserverRecipeCandidateEvaluationService } from "./observer-recipe-candidate-evaluation.js";
import type {
  ObserverRecipeWitnessRefreshService,
  PrincipalBoundObserverRecipeWitnessRefreshService
} from "./observer-recipe-witness-refresh.js";
import type { OperatorAlertConnectorDispatchService } from "./operator-alert-connector-dispatch.js";
import type { OperatorAlertReconciliationService } from "./operator-alert-reconciliation.js";
import type { UserActionConnectorDispatchService } from "./user-action-connector-dispatch.js";

export type BackgroundTaskHandler = BackgroundWorkerTaskHandler;

export interface BackgroundMaintenanceHandlerOptions {
  onActionJobsCreated?: (count: number) => void | Promise<void>;
  observerRecipeWitnessRefresh?: Pick<ObserverRecipeWitnessRefreshService, "execute">;
  principalBoundObserverRecipeWitnessRefresh?: Pick<
    PrincipalBoundObserverRecipeWitnessRefreshService,
    "execute"
  >;
  operatorAlertConnectorDispatch?: Pick<OperatorAlertConnectorDispatchService, "execute">;
  operatorAlertReconciliation?: Pick<OperatorAlertReconciliationService, "execute">;
  userActionConnectorDispatch?: Pick<UserActionConnectorDispatchService, "execute">;
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
  operationalTelemetryRetention?: {
    prune(
      principal: BackgroundWorkerContext["principal"],
      now: number
    ): Promise<{
      deletedRollupRows: number;
      deletedErrorEvents: number;
      cutoffAt: string;
      receiptId: string;
      deletedTaskRuns: number;
      taskHistoryCutoffAt: string;
      deletedRecoveryEvidence: number;
      deletedRecoveryReviewEvents: number;
      recoveryEvidenceCutoffAt: string;
      recoveryEvidenceRetentionDays: number;
      recoveryEvidenceRetentionReceiptId: string;
    }>;
  };
  observerRecipeCandidateEvaluation?: {
    execute(
      principal: BackgroundWorkerContext["principal"],
      runtimeVersion: string,
      now: number
    ): Promise<BackgroundTaskResult>;
  };
}

export class BackgroundMaintenanceHandler implements BackgroundWorkerTaskHandler {
  private readonly adapterDiagnostics: AdapterDiagnosticRepository;
  private readonly audit: AuditRepository;
  private readonly backgroundTasks: BackgroundTaskRepository;
  private readonly execution: ExecutionRepository;
  private readonly hostedDelivery: HostedDeliveryRepository;
  private readonly notifications: NotificationRepository;
  private readonly operationalTelemetry: OperationalTelemetryRepository;
  private readonly observerRecipeRecoveryRetention: ObserverRecipeRecoveryRetentionRepository;
  private readonly operatorAlerts: OperatorAlertRepository;
  private readonly observerRecipeCandidates: ObserverRecipeCandidateEvaluationService;
  private readonly spendLedger: SpendLedgerRepository;
  private readonly signalHistoryRetention: SignalHistoryRetentionRepository;
  private readonly signalIngress: DurableSignalIngressProcessor;

  constructor(db: YoinkDatabase, private readonly options: BackgroundMaintenanceHandlerOptions = {}) {
    this.adapterDiagnostics = new AdapterDiagnosticRepository(db);
    this.audit = new AuditRepository(db);
    this.backgroundTasks = new BackgroundTaskRepository(db);
    this.execution = new ExecutionRepository(db);
    this.hostedDelivery = new HostedDeliveryRepository(db);
    this.notifications = new NotificationRepository(db);
    this.operationalTelemetry = new OperationalTelemetryRepository(db);
    this.observerRecipeRecoveryRetention = new ObserverRecipeRecoveryRetentionRepository(db);
    this.operatorAlerts = new OperatorAlertRepository(db);
    this.observerRecipeCandidates = new ObserverRecipeCandidateEvaluationService(db);
    this.spendLedger = new SpendLedgerRepository(db);
    this.signalHistoryRetention = new SignalHistoryRetentionRepository(db);
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
        return this.processHostedDelivery(now);
      case "adapter_alert_reconciliation":
        return {
          ...(this.options.operatorAlertReconciliation
            ? await this.options.operatorAlertReconciliation.execute(
                context.principal,
                runtimeVersion,
                now
              )
            : this.operatorAlerts.reconcileAdapterRepairs(
                this.adapterDiagnostics.listRepairQueue(2_000, now),
                `background_alert_reconciliation_${new Date(now).toISOString().replace(/[^0-9]/g, "").slice(0, 17)}`,
                now
              )),
          ...(this.options.operatorAlertConnectorDispatch
            ? await this.options.operatorAlertConnectorDispatch.execute(now)
            : {
                connectorRegistryConfigured: false,
                connectorTransportConfigured: false,
                connectorDeliveriesAttempted: 0,
                connectorDeliveriesSucceeded: 0,
                connectorDeliveriesRetried: 0,
                connectorDeliveriesDeadLettered: 0
              }),
          ...(this.options.userActionConnectorDispatch
            ? await this.options.userActionConnectorDispatch.execute(now)
            : {
                userConnectorConfigured: false,
                userConnectorTransportConfigured: false,
                userConnectorDeliveriesAttempted: 0,
                userConnectorDeliveriesSucceeded: 0,
                userConnectorDeliveriesRetried: 0,
                userConnectorDeliveriesDeadLettered: 0
              })
        };
      case "observer_recipe_candidate_evaluation":
        return this.options.observerRecipeCandidateEvaluation
          ? this.options.observerRecipeCandidateEvaluation.execute(
              context.principal,
              runtimeVersion,
              now
            )
          : this.observerRecipeCandidates.execute(runtimeVersion, now);
      case "observer_recipe_witness_refresh":
        return this.options.principalBoundObserverRecipeWitnessRefresh
          ? this.options.principalBoundObserverRecipeWitnessRefresh.execute(
              context.principal,
              runtimeVersion,
              now
            )
          : this.options.observerRecipeWitnessRefresh
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
        if (this.options.operationalTelemetryRetention) {
          return this.options.operationalTelemetryRetention.prune(context.principal, now);
        }
        const result = this.operationalTelemetry.pruneExpired(now);
        const taskHistory = this.backgroundTasks.pruneCompletedHistory(now);
        const recoveryEvidence = this.observerRecipeRecoveryRetention.prune(now);
        const auditHistory = this.audit.pruneRetainedHistory(now);
        // Raw signal/observation/delivery history is bounded too (DB-08); it
        // never runs anywhere else, so without this the tables grow forever.
        const signalHistory = this.signalHistoryRetention.prune(now);
        return {
          deletedRollupRows: result.deletedRollupRows,
          deletedErrorEvents: result.deletedErrorEvents,
          cutoffAt: result.cutoffAt,
          receiptId: result.receiptId,
          ...taskHistory,
          ...recoveryEvidence,
          ...auditHistory,
          ...signalHistory
        };
      }
    }
  }

  private processHostedDelivery(now: number): BackgroundTaskResult {
    const recovery = this.hostedDelivery.recoverExpiredLeases(now);
    const signals = this.signalIngress.processBatch(now);
    if (signals.signalActionJobsCreated > 0 && this.options.onActionJobsCreated) {
      try {
        void Promise.resolve(this.options.onActionJobsCreated(
          signals.signalActionJobsCreated
        )).catch(() => undefined);
      } catch {
        // Availability notification is a latency optimization. The API's
        // bounded database recheck remains authoritative if it cannot fire.
      }
    }
    return { ...recovery, ...signals };
  }
}
