import type { Readable } from "node:stream";

/**
 * A supervisor's stop request over the child's stdin (YOINK_CONTROL_STDIN=1).
 * Windows has no SIGTERM a parent can send, and killing the process skips the
 * database close and lock release, so the tray app writes `stop` on a line
 * instead. A closed stdin also stops the app: the supervisor exited or
 * crashed, and nobody is left to stop it later.
 */
export type ControlStopReason = "CONTROL_STOP" | "CONTROL_CLOSED";

export function watchControlStdin(input: Readable, onStop: (reason: ControlStopReason) => void): () => void {
  let buffered = "";
  let stopped = false;
  const stop = (reason: ControlStopReason): void => {
    if (stopped) return;
    stopped = true;
    onStop(reason);
  };
  const onData = (chunk: Buffer | string): void => {
    buffered = `${buffered}${String(chunk)}`.slice(-1_024);
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    if (lines.some((line) => line.trim().toLowerCase() === "stop")) stop("CONTROL_STOP");
  };
  const onEnd = (): void => { stop("CONTROL_CLOSED"); };
  input.on("data", onData);
  input.once("end", onEnd);
  input.once("close", onEnd);
  input.resume();
  return () => {
    input.off("data", onData);
    input.off("end", onEnd);
    input.off("close", onEnd);
  };
}
