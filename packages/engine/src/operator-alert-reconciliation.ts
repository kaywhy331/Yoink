import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";

type MaybePromise<T> = T | Promise<T>;

export interface OperatorAlertReconciliationResult {
  opened: number;
  updated: number;
  resolved: number;
  escalated: number;
  routed: number;
}

export interface OperatorAlertReconciliationRepositoryPort {
  reconcile(
    principal: BackgroundWorkerPrincipal,
    runtimeVersion: string,
    now?: number
  ): MaybePromise<OperatorAlertReconciliationResult>;
}

export class OperatorAlertReconciliationService {
  constructor(private readonly repository: OperatorAlertReconciliationRepositoryPort) {}

  async execute(
    principal: BackgroundWorkerPrincipal,
    runtimeVersion: string,
    now = Date.now()
  ): Promise<OperatorAlertReconciliationResult> {
    return this.repository.reconcile(principal, runtimeVersion, now);
  }
}
