import type {
  BackgroundTaskKind,
  BackgroundTaskResult
} from "../../domain/src/background-task.js";

export type BackgroundWorkerRuntimeKind = "local_in_process" | "standalone";
export type BackgroundWorkerDeploymentState = "running" | "waiting" | "stopped";

export interface BackgroundWorkerPrincipal {
  tenantId: string;
  userId: string;
}

export interface BackgroundWorkerContext {
  principal: BackgroundWorkerPrincipal;
  workerId: string;
  runtimeKind: BackgroundWorkerRuntimeKind;
  runtimeVersion: string;
  deploymentFingerprint: string;
}

export interface BackgroundWorkerPrincipalPage {
  principals: BackgroundWorkerPrincipal[];
  nextCursor: string;
}

export interface BackgroundWorkerLease {
  id: string;
  taskKind: BackgroundTaskKind;
  capabilityToken: string;
}

export interface BackgroundWorkerDeploymentStatus {
  state: BackgroundWorkerDeploymentState;
  healthy: boolean;
  runtimeKind: BackgroundWorkerRuntimeKind;
  lastHeartbeatAt: string;
  lastErrorCode: string;
  coveredPrincipals: number;
  totalPrincipals: number;
  deploymentAttested: boolean;
  deploymentContractVersion: number;
}

export interface BackgroundWorkerStore {
  listPrincipals(cursor: string, limit: number): Promise<BackgroundWorkerPrincipalPage>;
  ensureSchedules(context: BackgroundWorkerContext, now: number): Promise<void>;
  enqueueDueSchedules(context: BackgroundWorkerContext, now: number): Promise<number>;
  leaseNext(context: BackgroundWorkerContext, leaseSeconds: number, now: number): Promise<BackgroundWorkerLease | null>;
  complete(
    context: BackgroundWorkerContext,
    taskId: string,
    capabilityToken: string,
    result: BackgroundTaskResult,
    now: number
  ): Promise<void>;
  fail(
    context: BackgroundWorkerContext,
    taskId: string,
    capabilityToken: string,
    errorCode: string,
    now: number
  ): Promise<void>;
  heartbeat(context: BackgroundWorkerContext, lastErrorCode: string, now: number): Promise<void>;
  stopWorker(workerId: string, runtimeKind: BackgroundWorkerRuntimeKind, lastErrorCode: string, now: number): Promise<void>;
  deploymentStatus(
    runtimeKind: BackgroundWorkerRuntimeKind,
    expectedDeploymentFingerprint: string,
    now: number
  ): Promise<BackgroundWorkerDeploymentStatus>;
}

export interface BackgroundWorkerTaskHandler {
  execute(context: BackgroundWorkerContext, taskKind: BackgroundTaskKind, now: number): Promise<BackgroundTaskResult>;
}
