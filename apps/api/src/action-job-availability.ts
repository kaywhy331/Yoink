import { randomUUID } from "node:crypto";

export interface ActionJobAvailabilityWaiter {
  currentEpoch(): string;
  currentVersion(): number;
  waitAfter(version: number, timeoutMs: number): Promise<number>;
}

export interface ActionJobAvailabilityPulse extends ActionJobAvailabilityWaiter {
  notify(options?: { rapid?: boolean }): number;
  rapidRecheckUntil?(): number;
}

export const USER_ACTION_HANDOFF_WAIT_MAX_MS = 5_000;
export const DEVICE_ACTION_JOB_WAIT_MAX_MS = 25_000;
export const DEVICE_ACTION_HANDOFF_WAIT_MAX_MS = 25_000;
export const DEVICE_NOTIFICATION_WAIT_MAX_MS = 25_000;
export const DEVICE_ACTION_JOB_FALLBACK_RECHECK_MS = 1_000;
export const DEVICE_ACTION_JOB_RAPID_RECHECK_MS = 250;
export const DEVICE_ACTION_JOB_RAPID_RECHECK_WINDOW_MS = 2_500;
const ACTION_JOB_AVAILABILITY_PULSE_WAIT_MAX_MS = USER_ACTION_HANDOFF_WAIT_MAX_MS;

interface PulseWaiter {
  timer: ReturnType<typeof setTimeout>;
  resolve: (version: number) => void;
}

function boundedTimeout(value: unknown): number {
  const parsed = Math.floor(Number(value));
  return Number.isSafeInteger(parsed)
    ? Math.max(0, Math.min(ACTION_JOB_AVAILABILITY_PULSE_WAIT_MAX_MS, parsed))
    : 0;
}

export function createActionJobAvailabilityPulse(): ActionJobAvailabilityPulse {
  let epoch = randomUUID().replaceAll("-", "");
  let version = 0;
  let rapidRecheckUntil = 0;
  const waiters = new Set<PulseWaiter>();

  const finish = (waiter: PulseWaiter, nextVersion: number): void => {
    if (!waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    waiter.resolve(nextVersion);
  };

  return {
    currentEpoch: () => epoch,
    currentVersion: () => version,
    rapidRecheckUntil: () => rapidRecheckUntil,
    notify: (options = {}) => {
      if (options.rapid === true) {
        rapidRecheckUntil = Math.max(
          rapidRecheckUntil,
          Date.now() + DEVICE_ACTION_JOB_RAPID_RECHECK_WINDOW_MS
        );
      }
      if (version >= Number.MAX_SAFE_INTEGER) {
        epoch = randomUUID().replaceAll("-", "");
        version = 1;
      } else {
        version += 1;
      }
      for (const waiter of [...waiters]) finish(waiter, version);
      return version;
    },
    waitAfter: (observedVersion, timeoutMs) => {
      const waitMs = boundedTimeout(timeoutMs);
      if (observedVersion !== version || waitMs === 0) return Promise.resolve(version);
      return new Promise<number>((resolve) => {
        const waiter: PulseWaiter = {
          timer: setTimeout(() => finish(waiter, version), waitMs),
          resolve
        };
        waiters.add(waiter);
      });
    }
  };
}
