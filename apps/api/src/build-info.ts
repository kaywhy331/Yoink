import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * What the running process was built from, so health can distinguish the
 * source tree, the compiled tree and the process that is actually serving.
 */
export interface BuildInfo {
  /** `dist` when served from a stamped compiled tree, `source` under tsx, `unknown` when the stamp is missing. */
  kind: "dist" | "source" | "unknown";
  version: string;
  commit: string;
  committedAt: string;
  dirty: boolean;
  builtAt: string;
  startedAt: string;
  /** The checked-out source commit at start, when git is available; empty otherwise. */
  sourceCommit: string;
  sourceCommittedAt: string;
  /** True when the compiled tree is older than the source commit it should contain. */
  staleAgainstSource: boolean;
  /**
   * Content hash of the compiled tree from the stamp, so two builds of one
   * commit are told apart (PLAT-04). Empty under tsx or without a stamp.
   */
  buildId: string;
  /** Untracked files in the tree the build (or source run) came from; they count towards `dirty`. */
  untrackedFiles: number;
}

function git(projectRoot: string, args: string[]): string {
  try {
    const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", timeout: 3_000 });
    return result.status === 0 ? String(result.stdout).trim() : "";
  } catch {
    return "";
  }
}

type BuildStamp = Partial<{
  version: string;
  commit: string;
  committedAt: string;
  dirty: boolean;
  builtAt: string;
  buildId: string;
  untrackedFiles: number;
}>;

function stampCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function readBuildStamp(stampPath: string): BuildStamp | null {
  if (!existsSync(stampPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(stampPath, "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed as BuildStamp : null;
  } catch {
    return null;
  }
}

export function loadBuildInfo(projectRoot: string, options: { runningFromDist: boolean; startedAt?: string; version: string }): BuildInfo {
  const stampPath = join(projectRoot, "dist", "build-info.json");
  const startedAt = options.startedAt ?? new Date().toISOString();
  const sourceCommit = git(projectRoot, ["rev-parse", "HEAD"]);
  const sourceCommittedAt = git(projectRoot, ["log", "-1", "--format=%cI"]);
  const stamp = readBuildStamp(stampPath);
  if (!options.runningFromDist) {
    // Untracked files count: a new, never-committed module runs under tsx just
    // like an edited one (same rule as scripts/write-build-info.mjs).
    const status = git(projectRoot, ["status", "--porcelain"]).split("\n").filter(Boolean);
    return {
      kind: "source",
      version: options.version,
      commit: sourceCommit || "unknown",
      committedAt: sourceCommittedAt,
      dirty: status.length > 0,
      builtAt: "",
      startedAt,
      sourceCommit,
      sourceCommittedAt,
      staleAgainstSource: false,
      buildId: "",
      untrackedFiles: status.filter((line) => line.startsWith("??")).length
    };
  }
  if (!stamp) {
    let builtAt = "";
    try {
      builtAt = statSync(join(projectRoot, "dist", "apps", "api", "src", "app.js")).mtime.toISOString();
    } catch {
      builtAt = "";
    }
    return {
      kind: "unknown",
      version: options.version,
      commit: "unknown",
      committedAt: "",
      dirty: false,
      builtAt,
      startedAt,
      sourceCommit,
      sourceCommittedAt,
      staleAgainstSource: Boolean(sourceCommit),
      buildId: "",
      untrackedFiles: 0
    };
  }
  const commit = String(stamp.commit ?? "unknown");
  return {
    kind: "dist",
    version: String(stamp.version ?? options.version),
    commit,
    committedAt: String(stamp.committedAt ?? ""),
    dirty: stamp.dirty === true,
    builtAt: String(stamp.builtAt ?? ""),
    startedAt,
    sourceCommit,
    sourceCommittedAt,
    staleAgainstSource: Boolean(sourceCommit) && commit !== sourceCommit,
    buildId: typeof stamp.buildId === "string" ? stamp.buildId : "",
    untrackedFiles: stampCount(stamp.untrackedFiles)
  };
}

/** Age in whole hours between two ISO timestamps, or null when either is missing. */
export function hoursBetween(earlier: string, later: string): number | null {
  const start = Date.parse(earlier);
  const end = Date.parse(later);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 3_600_000));
}
