#!/usr/bin/env node
// Builds the compiled tree without ever leaving a half-built `dist/` behind
// (PLAT-02). The unit runs `dist/apps/api/src/server.js` with Restart=on-
// failure, so whatever sits in dist is what the next crash or reboot loads.
//
//   1. tsc (noEmitOnError) into `dist.next/`; a type error emits nothing.
//   2. copy the web UI into `dist.next/web/`, so the served UI is the one
//      this build was made from (PLAT-09).
//   3. stamp `dist.next/build-info.json` (commit, dirty, buildId).
//   4. swap: drop `dist.prev/`, move `dist/` to `dist.prev/` (one rollback
//      copy), move `dist.next/` to `dist/`. Orphaned modules from deleted
//      sources do not survive a build because every build starts empty.
//
// `--dist=<dir>` builds and swaps a different tree (tests, dry runs); the
// staging and rollback directories are always `<dir>.next` and `<dir>.prev`.
// `--no-swap` stops after stamping `<dir>.next`.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBuildInfo } from "./write-build-info.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name) => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
const target = resolve(ROOT, option("--dist") || "dist");
const next = `${target}.next`;
const previous = `${target}.prev`;
const swap = !argv.includes("--no-swap");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

rmSync(next, { recursive: true, force: true });
process.stdout.write(`Compiling into ${next}\n`);
const compile = spawnSync(process.execPath, [
  "--stack-size=4096",
  join(ROOT, "node_modules", "typescript", "bin", "tsc"),
  "-p", join(ROOT, "tsconfig.build.json"),
  "--outDir", next
], { cwd: ROOT, stdio: "inherit", env: process.env });
if (compile.error) fail(compile.error.message);
if (compile.status !== 0) {
  rmSync(next, { recursive: true, force: true });
  fail(`TypeScript failed (status ${compile.status}); ${target} was left untouched.`);
}
if (!existsSync(join(next, "apps", "api", "src", "server.js"))) {
  fail(`${next} has no apps/api/src/server.js; ${target} was left untouched.`);
}

cpSync(join(ROOT, "apps", "web"), join(next, "web"), { recursive: true });
const { info } = writeBuildInfo(next);
process.stdout.write(`Build stamp ${info.commit.slice(0, 12)}${info.dirty ? " (dirty)" : ""} build ${info.buildId.slice(0, 12)}\n`);

if (!swap) {
  process.stdout.write(`Swap skipped (--no-swap); the build is in ${next}.\n`);
  process.exit(0);
}
rmSync(previous, { recursive: true, force: true });
const hadTarget = existsSync(target);
if (hadTarget) renameSync(target, previous);
try {
  renameSync(next, target);
} catch (error) {
  // Put the previous build back rather than leave no dist at all.
  if (hadTarget && !existsSync(target)) renameSync(previous, target);
  fail(`Could not move ${next} into place (${error instanceof Error ? error.message : String(error)}); ${target} was restored.`);
}
process.stdout.write(`Swapped the new build into ${target}${existsSync(previous) ? ` (rollback copy: ${previous})` : ""}.\n`);
