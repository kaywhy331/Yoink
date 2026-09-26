#!/usr/bin/env node
// Stamps the compiled tree so a running process can say which commit it was
// built from and when. Health serves the stamp; release:local asserts the
// restarted process reports the build it just made (P-03, R-01, X-05).
//
// `buildId` is a content hash of the compiled tree, so two builds of the same
// commit (a dirty tree rebuilt without a restart) are told apart (PLAT-04).
// `dirty` counts untracked files too: a new, never-committed module compiles
// into dist just like an edited one.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BUILD_INFO_FILE = "build-info.json";

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout.trim() : "";
}

function listFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(directory);
  return files;
}

/**
 * sha256 over the sorted relative paths and contents of every emitted
 * JavaScript/JSON file and the copied web UI, excluding the stamp itself,
 * source maps and declarations (they follow the JS they describe).
 */
export function computeBuildId(distRoot) {
  const hash = createHash("sha256");
  const files = listFiles(distRoot)
    .map((path) => relative(distRoot, path).split(sep).join("/"))
    .filter((path) => path !== BUILD_INFO_FILE && !path.endsWith(".map") && !path.endsWith(".d.ts"))
    .sort();
  for (const path of files) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(distRoot, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function collectBuildInfo(distRoot = join(ROOT, "dist")) {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const commit = git(["rev-parse", "HEAD"]);
  const committedAt = git(["log", "-1", "--format=%cI"]);
  const status = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  const untrackedFiles = status.filter((line) => line.startsWith("??")).length;
  return {
    version: String(packageJson.version || "0.0.0"),
    commit: commit || "unknown",
    committedAt: committedAt || "",
    dirty: status.length > 0,
    untrackedFiles,
    buildId: computeBuildId(distRoot),
    builtAt: new Date().toISOString()
  };
}

export function writeBuildInfo(distRoot) {
  const info = collectBuildInfo(distRoot);
  const outputPath = join(distRoot, BUILD_INFO_FILE);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(info, null, 2)}\n`);
  return { info, outputPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Argument: the compiled tree to stamp (default dist/). The stamp is written
  // inside it as build-info.json.
  const distRoot = process.argv[2] ? resolve(ROOT, process.argv[2]) : join(ROOT, "dist");
  const { info, outputPath } = writeBuildInfo(distRoot);
  process.stdout.write(`Build stamp ${info.commit.slice(0, 12)}${info.dirty ? " (dirty)" : ""} build ${info.buildId.slice(0, 12)} written to ${outputPath}\n`);
}
