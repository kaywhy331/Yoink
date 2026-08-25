import { BACKGROUND_TASK_KINDS } from "../../../packages/domain/src/background-task.js";
import { newId } from "../../../packages/domain/src/ids.js";
import {
  BackgroundTaskRepository,
  type BackgroundTaskResult
} from "../../../packages/database/src/background-task-repository.js";
import type { YoinkDatabase } from "../../../packages/database/src/database.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../../../packages/database/src/request-scope.js";
import {
  BackgroundMaintenanceHandler,
  type BackgroundTaskHandler
} from "../../../packages/engine/src/background-maintenance.js";

export type BackgroundWorkerRuntimeState = "stopped" | "running";

export interface BackgroundWorkerRuntimeStatus {
  workerId: string;
  runtimeKind: "local_in_process";
  state: BackgroundWorkerRuntimeState;
  healthy: boolean;
  cycleActive: boolean;
  lastStartedAt: string;
  lastHeartbeatAt: string;
  lastCompletedAt: string;
  lastErrorCode: string;
  cycles: number;
  tasksSucceeded: number;
  tasksFailed: number;
}

export interface BackgroundWorkerCycleResult {
  enqueued: number;
  leased: number;
  succeeded: number;
  failed: number;
}

export interface BackgroundWorkerRuntimeOptions {
  db: YoinkDatabase;
  version: string;
  workerId?: string;
  pollIntervalMs?: number;
  leaseSeconds?: number;
  maximumTasksPerCycle?: number;
  scope?: RequestScope;
  handler?: BackgroundTaskHandler;
  unrefTimer?: boolean;
}

function runtimeErrorCode(error: unknown): string {
  const candidate = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const normalized = candidate.toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_").slice(0, 80);
  return normalized || "background_handler_failed";
}

export class BackgroundWorkerRuntime {
  private readonly tasks: BackgroundTaskRepository;
  private readonly handler: BackgroundTaskHandler;
  private readonly scope: RequestScope;
  private readonly workerId: string;
  private readonly version: string;
  private readonly pollIntervalMs: number;
  private readonly leaseSeconds: number;
  private readonly maximumTasksPerCycle: number;
  private readonly unrefTimer: boolean;
  private timer: NodeJS.Timeout | null = null;
  private cycleActive = false;
  private runtimeState: BackgroundWorkerRuntimeState = "stopped";
  private lastStartedAt = "";
  private lastHeartbeatAt = "";
  private lastCompletedAt = "";
  private lastErrorCode = "";
  private cycles = 0;
  private tasksSucceeded = 0;
  private tasksFailed = 0;

  constructor(options: BackgroundWorkerRuntimeOptions) {
    this.tasks = new BackgroundTaskRepository(options.db);
    this.handler = options.handler ?? new BackgroundMaintenanceHandler(options.db);
    this.workerId = options.workerId ?? "background_worker_local";
    this.version = String(options.version || "0.0.0").slice(0, 40);
    this.pollIntervalMs = Math.max(500, Math.min(60_000, Math.floor(Number(options.pollIntervalMs) || 2_000)));
    this.leaseSeconds = Math.max(15, Math.min(300, Math.floor(Number(options.leaseSeconds) || 60)));
    this.maximumTasksPerCycle = Math.max(1, Math.min(100, Math.floor(Number(options.maximumTasksPerCycle) || 20)));
    this.unrefTimer = options.unrefTimer !== false;
    this.scope = options.scope ?? {
      tenantId: LOCAL_REQUEST_SCOPE.tenantId,
      userId: LOCAL_REQUEST_SCOPE.userId,
      actorKind: "service",
      actorId: this.workerId
    };
    if (!BACKGROUND_TASK_KINDS.length) throw new Error("The background task registry is empty.");
  }

  start(now = Date.now()): void {
    if (this.runtimeState === "running") return;
    this.runtimeState = "running";
    this.lastStartedAt = new Date(now).toISOString();
    runWithRequestScope(this.scope, () => {
      this.tasks.ensureDefaultSchedules(now);
      this.tasks.heartbeat(this.workerId, "local_in_process", this.version, "", now);
    });
    this.lastHeartbeatAt = new Date(now).toISOString();
    this.timer = setInterval(() => {
      try {
        this.runOnce();
      } catch {
        // runOnce records a bounded error code. The timer must survive one failed cycle.
      }
    }, this.pollIntervalMs);
    if (this.unrefTimer) this.timer.unref();
    queueMicrotask(() => {
      if (this.runtimeState !== "running") return;
      try {
        this.runOnce();
      } catch {
        // The heartbeat exposes degraded state without crashing the HTTP process.
      }
    });
  }

  stop(now = Date.now()): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.runtimeState === "running") {
      runWithRequestScope(this.scope, () => this.tasks.stopWorker(this.workerId, this.lastErrorCode, now));
    }
    this.runtimeState = "stopped";
    this.cycleActive = false;
  }

  runOnce(now = Date.now()): BackgroundWorkerCycleResult {
    if (this.cycleActive) return { enqueued: 0, leased: 0, succeeded: 0, failed: 0 };
    this.cycleActive = true;
    const result: BackgroundWorkerCycleResult = { enqueued: 0, leased: 0, succeeded: 0, failed: 0 };
    try {
      runWithRequestScope(this.scope, () => {
        this.tasks.ensureDefaultSchedules(now);
        result.enqueued = this.tasks.enqueueDueSchedules(now);
        for (let index = 0; index < this.maximumTasksPerCycle; index += 1) {
          const lease = this.tasks.leaseNext(this.workerId, this.leaseSeconds, now);
          if (!lease) break;
          result.leased += 1;
          try {
            const handlerResult = this.handler.execute(lease.taskKind, now) as BackgroundTaskResult;
            this.tasks.complete(lease.id, lease.capabilityToken, handlerResult, now);
            result.succeeded += 1;
            this.tasksSucceeded += 1;
          } catch (error) {
            this.lastErrorCode = runtimeErrorCode(error);
            this.tasks.fail(lease.id, lease.capabilityToken, this.lastErrorCode, 0, now);
            result.failed += 1;
            this.tasksFailed += 1;
          }
        }
        if (result.failed === 0) this.lastErrorCode = "";
        this.tasks.heartbeat(this.workerId, "local_in_process", this.version, this.lastErrorCode, now);
      });
      this.cycles += 1;
      this.lastHeartbeatAt = new Date(now).toISOString();
      this.lastCompletedAt = new Date(now).toISOString();
      return result;
    } catch (error) {
      this.lastErrorCode = runtimeErrorCode(error);
      try {
        runWithRequestScope(this.scope, () => this.tasks.heartbeat(
          this.workerId,
          "local_in_process",
          this.version,
          this.lastErrorCode,
          now
        ));
        this.lastHeartbeatAt = new Date(now).toISOString();
      } catch {
        // The caller receives the original failure; no unbounded diagnostics are persisted.
      }
      throw error;
    } finally {
      this.cycleActive = false;
    }
  }

  status(now = Date.now()): BackgroundWorkerRuntimeStatus {
    const heartbeatTime = new Date(this.lastHeartbeatAt).getTime();
    return {
      workerId: this.workerId,
      runtimeKind: "local_in_process",
      state: this.runtimeState,
      healthy: this.runtimeState === "running" && Number.isFinite(heartbeatTime) && heartbeatTime >= now - 30_000,
      cycleActive: this.cycleActive,
      lastStartedAt: this.lastStartedAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastCompletedAt: this.lastCompletedAt,
      lastErrorCode: this.lastErrorCode,
      cycles: this.cycles,
      tasksSucceeded: this.tasksSucceeded,
      tasksFailed: this.tasksFailed
    };
  }
}
