import type {
  BackgroundWorkerContext,
  BackgroundWorkerRuntimeKind,
  BackgroundWorkerStore,
  BackgroundWorkerTaskHandler
} from "../../contracts/src/background-worker.js";
import { BACKGROUND_TASK_KINDS } from "../../domain/src/background-task.js";
import { BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION } from "../../domain/src/background-worker-deployment.js";

export type BackgroundWorkerRuntimeState = "stopped" | "starting" | "running" | "stopping";

export interface BackgroundWorkerRuntimeStatus {
  workerId: string;
  runtimeKind: BackgroundWorkerRuntimeKind;
  state: BackgroundWorkerRuntimeState;
  healthy: boolean;
  cycleActive: boolean;
  lastStartedAt: string;
  lastHeartbeatAt: string;
  lastCompletedAt: string;
  lastErrorCode: string;
  deploymentAttested: boolean;
  deploymentContractVersion: number;
  cycles: number;
  principalsVisited: number;
  lastPrincipalCount: number;
  tasksSucceeded: number;
  tasksFailed: number;
  uncertainTransitions: number;
}

export interface BackgroundWorkerCycleResult {
  principalsVisited: number;
  enqueued: number;
  leased: number;
  succeeded: number;
  failed: number;
  uncertainTransitions: number;
  principalFailures: number;
}

export interface BackgroundWorkerRuntimeOptions {
  store: BackgroundWorkerStore;
  handler: BackgroundWorkerTaskHandler;
  version: string;
  deploymentFingerprint: string;
  runtimeKind?: BackgroundWorkerRuntimeKind;
  workerId?: string;
  pollIntervalMs?: number;
  leaseSeconds?: number;
  maximumPrincipalsPerCycle?: number;
  maximumTasksPerCycle?: number;
  maximumTasksPerPrincipal?: number;
  unrefTimer?: boolean;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function runtimeErrorCode(error: unknown, fallback = "background_store_failed"): string {
  const candidate = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const normalized = candidate.toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_").slice(0, 80);
  return normalized || fallback;
}

function emptyCycle(): BackgroundWorkerCycleResult {
  return {
    principalsVisited: 0,
    enqueued: 0,
    leased: 0,
    succeeded: 0,
    failed: 0,
    uncertainTransitions: 0,
    principalFailures: 0
  };
}

export class BackgroundWorkerRuntime {
  private readonly store: BackgroundWorkerStore;
  private readonly handler: BackgroundWorkerTaskHandler;
  private readonly workerId: string;
  private readonly version: string;
  private readonly deploymentFingerprint: string;
  private readonly runtimeKind: BackgroundWorkerRuntimeKind;
  private readonly pollIntervalMs: number;
  private readonly leaseSeconds: number;
  private readonly maximumPrincipalsPerCycle: number;
  private readonly maximumTasksPerCycle: number;
  private readonly maximumTasksPerPrincipal: number;
  private readonly unrefTimer: boolean;
  private timer: NodeJS.Timeout | null = null;
  private cyclePromise: Promise<BackgroundWorkerCycleResult> | null = null;
  private runtimeState: BackgroundWorkerRuntimeState = "stopped";
  private principalCursor = "";
  private lastStartedAt = "";
  private lastHeartbeatAt = "";
  private lastCompletedAt = "";
  private lastErrorCode = "";
  private cycles = 0;
  private principalsVisited = 0;
  private lastPrincipalCount = 0;
  private tasksSucceeded = 0;
  private tasksFailed = 0;
  private uncertainTransitions = 0;

  constructor(options: BackgroundWorkerRuntimeOptions) {
    this.store = options.store;
    this.handler = options.handler;
    this.workerId = String(options.workerId ?? "background_worker_local").slice(0, 120);
    this.version = String(options.version || "0.0.0").slice(0, 40);
    this.deploymentFingerprint = String(options.deploymentFingerprint ?? "");
    this.runtimeKind = options.runtimeKind ?? "local_in_process";
    this.pollIntervalMs = boundedInteger(options.pollIntervalMs, 2_000, 500, 60_000);
    this.leaseSeconds = boundedInteger(options.leaseSeconds, 60, 15, 300);
    this.maximumPrincipalsPerCycle = boundedInteger(options.maximumPrincipalsPerCycle, 100, 1, 500);
    this.maximumTasksPerCycle = boundedInteger(options.maximumTasksPerCycle, 100, 1, 1_000);
    this.maximumTasksPerPrincipal = boundedInteger(options.maximumTasksPerPrincipal, 20, 1, 100);
    this.unrefTimer = options.unrefTimer !== false;
    if (!this.store || !this.handler || !BACKGROUND_TASK_KINDS.length
      || !/^[a-f0-9]{64}$/.test(this.deploymentFingerprint)) {
      throw new Error("The background worker runtime contract is incomplete.");
    }
  }

  async start(now = Date.now()): Promise<void> {
    if (this.runtimeState === "running" || this.runtimeState === "starting") return;
    if (this.runtimeState === "stopping") throw new Error("The background worker is stopping.");
    this.runtimeState = "starting";
    this.lastStartedAt = new Date(now).toISOString();
    try {
      await this.runOnce(now);
      if (this.runtimeState !== "starting") return;
      this.runtimeState = "running";
      this.timer = setInterval(() => {
        void this.runOnce().catch(() => {
          // The bounded status code is retained; one failed cycle must not kill the timer.
        });
      }, this.pollIntervalMs);
      if (this.unrefTimer) this.timer.unref();
    } catch (error) {
      this.runtimeState = "stopped";
      throw error;
    }
  }

  async stop(now = Date.now()): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.runtimeState === "stopped") return;
    this.runtimeState = "stopping";
    if (this.cyclePromise) {
      try {
        await this.cyclePromise;
      } catch {
        // The cycle already recorded a bounded error code.
      }
    }
    await this.store.stopWorker(this.workerId, this.runtimeKind, this.lastErrorCode, now);
    this.runtimeState = "stopped";
  }

  async runOnce(now = Date.now()): Promise<BackgroundWorkerCycleResult> {
    if (this.cyclePromise) return emptyCycle();
    const operation = this.executeCycle(now);
    this.cyclePromise = operation;
    try {
      return await operation;
    } finally {
      if (this.cyclePromise === operation) this.cyclePromise = null;
    }
  }

  status(now = Date.now()): BackgroundWorkerRuntimeStatus {
    const heartbeatTime = new Date(this.lastHeartbeatAt).getTime();
    return {
      workerId: this.workerId,
      runtimeKind: this.runtimeKind,
      state: this.runtimeState,
      healthy: this.runtimeState === "running"
        && Number.isFinite(heartbeatTime)
        && heartbeatTime >= now - 30_000
        && !this.lastErrorCode,
      cycleActive: this.cyclePromise !== null,
      lastStartedAt: this.lastStartedAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastCompletedAt: this.lastCompletedAt,
      lastErrorCode: this.lastErrorCode,
      deploymentAttested: true,
      deploymentContractVersion: BACKGROUND_WORKER_DEPLOYMENT_CONTRACT_VERSION,
      cycles: this.cycles,
      principalsVisited: this.principalsVisited,
      lastPrincipalCount: this.lastPrincipalCount,
      tasksSucceeded: this.tasksSucceeded,
      tasksFailed: this.tasksFailed,
      uncertainTransitions: this.uncertainTransitions
    };
  }

  private async executeCycle(now: number): Promise<BackgroundWorkerCycleResult> {
    const result = emptyCycle();
    let heartbeatRecorded = false;
    let cycleErrorCode = "";
    try {
      let page = await this.store.listPrincipals(this.principalCursor, this.maximumPrincipalsPerCycle);
      if (!page.principals.length && this.principalCursor) {
        this.principalCursor = "";
        page = await this.store.listPrincipals("", this.maximumPrincipalsPerCycle);
      }
      this.principalCursor = page.nextCursor;
      for (const principal of page.principals) {
        const context: BackgroundWorkerContext = {
          principal,
          workerId: this.workerId,
          runtimeKind: this.runtimeKind,
          runtimeVersion: this.version,
          deploymentFingerprint: this.deploymentFingerprint
        };
        result.principalsVisited += 1;
        let principalErrorCode = "";
        try {
          await this.store.ensureSchedules(context, now);
          result.enqueued += await this.store.enqueueDueSchedules(context, now);
          let principalTasks = 0;
          while (result.leased < this.maximumTasksPerCycle && principalTasks < this.maximumTasksPerPrincipal) {
            const lease = await this.store.leaseNext(context, this.leaseSeconds, now);
            if (!lease) break;
            result.leased += 1;
            principalTasks += 1;
            let handlerResult;
            try {
              handlerResult = await this.handler.execute(context, lease.taskKind, now);
            } catch (error) {
              principalErrorCode = runtimeErrorCode(error, "background_handler_failed");
              result.failed += 1;
              this.tasksFailed += 1;
              try {
                await this.store.fail(context, lease.id, lease.capabilityToken, principalErrorCode, now);
              } catch {
                principalErrorCode = "background_failure_transition_uncertain";
                result.uncertainTransitions += 1;
                this.uncertainTransitions += 1;
              }
              continue;
            }
            try {
              await this.store.complete(context, lease.id, lease.capabilityToken, handlerResult, now);
              result.succeeded += 1;
              this.tasksSucceeded += 1;
            } catch {
              principalErrorCode = "background_completion_uncertain";
              result.uncertainTransitions += 1;
              this.uncertainTransitions += 1;
            }
          }
          await this.store.heartbeat(context, principalErrorCode, now);
          heartbeatRecorded = true;
          if (principalErrorCode) cycleErrorCode = principalErrorCode;
        } catch (error) {
          principalErrorCode = runtimeErrorCode(error);
          cycleErrorCode = principalErrorCode;
          result.principalFailures += 1;
          try {
            await this.store.heartbeat(context, principalErrorCode, now);
            heartbeatRecorded = true;
          } catch {
            // No raw exception content is persisted or surfaced.
          }
        }
      }
      this.lastErrorCode = cycleErrorCode;
      this.cycles += 1;
      this.principalsVisited += result.principalsVisited;
      this.lastPrincipalCount = result.principalsVisited;
      if (heartbeatRecorded) this.lastHeartbeatAt = new Date(now).toISOString();
      this.lastCompletedAt = new Date(now).toISOString();
      return result;
    } catch (error) {
      this.lastErrorCode = runtimeErrorCode(error);
      throw error;
    }
  }
}
