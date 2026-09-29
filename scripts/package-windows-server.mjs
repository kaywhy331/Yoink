#!/usr/bin/env node
// Builds the Windows server package: a ZIP holding the official Node for
// Windows and the compiled app, so the PC runs Yoink without installing
// Node, git or npm. The tray app (or `Start Yoink.cmd`) runs it.
//
//   node scripts/package-windows-server.mjs                 # release/Yoink-Server-win-x64-<version>.zip
//   node scripts/package-windows-server.mjs --node=22.22.0  # a different Node release
//   node scripts/package-windows-server.mjs --out=<dir>     # write the ZIP elsewhere
//
// Layout inside the ZIP:
//   node/node.exe                  Node for Windows x64, checked against nodejs.org's SHASUMS256
//   app/package.json               version source for the app
//   app/dist/                      a fresh compile of this tree (never the running service's dist/)
//   app/node_modules/              production dependencies only (pg and its closure)
//   app/release/                   the companion ZIP of this version, for in-app companion updates
//   Start Yoink.cmd                runs the server in a console window, data in %LOCALAPPDATA%\Yoink\data
//   yoink-server.json              what the tray app reads: entry, version, build, Node, exit codes
//
// The compile goes into a scratch directory with build-dist.mjs --no-swap, so
// packaging never replaces the dist/ tree a running local service loads from.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_SCHEMA_VERSION = 1;
export const SERVER_ENTRY = "dist/apps/api/src/server.js";
/** Exit status the app uses for configuration, lock, disk and migration failures (see server.ts). */
export const NON_RETRYABLE_EXIT_STATUS = 78;
const argv = process.argv.slice(2);
const option = (name) => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";

/**
 * Lock-file entries the server needs at run time: everything under
 * node_modules/ that is neither a dev dependency nor an optional one (pg's
 * optional pg-cloudflare targets Workers and is never loaded on Node).
 */
export function productionPackagePaths(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([path, entry]) => path.startsWith("node_modules/") && !entry.dev && !entry.devOptional && !entry.optional)
    .map(([path]) => path)
    .sort();
}

/** The console launcher. CRLF line endings; paths are relative to the extracted folder. */
export function renderStartScript({ port = "32991" } = {}) {
  return [
    "@echo off",
    "rem Runs the Yoink server in this window. Close the window or press Ctrl+C to stop it.",
    "rem The tray app runs the same command and stops it cleanly over stdin.",
    "setlocal",
    "set \"YOINK_HOME=%~dp0\"",
    "if not defined YOINK_DATA_DIR set \"YOINK_DATA_DIR=%LOCALAPPDATA%\\Yoink\\data\"",
    `if not defined YOINK_PORT set "YOINK_PORT=${port}"`,
    "set \"NODE_OPTIONS=--disable-warning=ExperimentalWarning\"",
    "cd /d \"%YOINK_HOME%app\"",
    `"%YOINK_HOME%node\\node.exe" ${SERVER_ENTRY.replaceAll("/", "\\")}`,
    "set \"YOINK_EXIT=%ERRORLEVEL%\"",
    "if not \"%YOINK_EXIT%\"==\"0\" pause",
    "exit /b %YOINK_EXIT%",
    ""
  ].join("\r\n");
}

/** What the tray app reads to start, stop and describe the server. */
export function renderManifest({ version, build, nodeVersion, nodeSha256 }) {
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    product: "yoink-server",
    platform: "win-x64",
    version,
    build: {
      commit: String(build.commit ?? ""),
      committedAt: String(build.committedAt ?? ""),
      dirty: build.dirty === true,
      buildId: String(build.buildId ?? ""),
      builtAt: String(build.builtAt ?? "")
    },
    node: { version: nodeVersion, path: "node/node.exe", sha256: nodeSha256 },
    server: {
      workingDirectory: "app",
      entry: SERVER_ENTRY,
      defaultPort: 32991,
      healthPath: "/api/v1/health",
      environment: { NODE_OPTIONS: "--disable-warning=ExperimentalWarning", YOINK_CONTROL_STDIN: "1" },
      dataDirectoryVariable: "YOINK_DATA_DIR",
      portVariable: "YOINK_PORT",
      stop: "Write the line `stop` to the server's stdin; closing stdin also stops it. Allow 15 seconds before ending the process.",
      nonRetryableExitCode: NON_RETRYABLE_EXIT_STATUS
    }
  };
}

function run(label, command, args, options = {}) {
  process.stdout.write(`\n== ${label}\n`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", env: process.env, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}.`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

/**
 * node.exe for a Node release, cached under ~/.cache/yoink/node and verified
 * against the release's SHASUMS256.txt every time (a cached file is not trusted
 * just because it exists).
 */
async function windowsNode(version) {
  const name = `node-v${version}-win-x64`;
  const cache = join(homedir(), ".cache", "yoink", "node");
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, `${name}.zip`);
  const sums = join(cache, `SHASUMS256-v${version}.txt`);
  const base = `https://nodejs.org/dist/v${version}`;
  if (!existsSync(sums)) await download(`${base}/SHASUMS256.txt`, sums);
  const expected = readFileSync(sums, "utf8").split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === `${name}.zip`)?.[0];
  if (!expected) throw new Error(`SHASUMS256.txt for Node ${version} lists no ${name}.zip.`);
  if (!existsSync(archive) || sha256(archive) !== expected) {
    process.stdout.write(`Downloading ${base}/${name}.zip\n`);
    await download(`${base}/${name}.zip`, archive);
  }
  const actual = sha256(archive);
  if (actual !== expected) {
    rmSync(archive, { force: true });
    throw new Error(`${name}.zip failed its checksum (expected ${expected}, got ${actual}).`);
  }
  return { archive, name };
}

async function main() {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const version = packageJson.version;
  const nodeVersion = (option("--node") || process.versions.node).replace(/^v/, "");
  const outputDirectory = resolve(ROOT, option("--out") || "release");
  const companion = join(ROOT, "release", `Yoink-Companion-${version}.zip`);
  if (!existsSync(companion)) {
    throw new Error(`${companion} is missing; run npm run package:extension first so the PC can serve companion updates.`);
  }

  const scratch = mkdtempSync(join(tmpdir(), "yoink-windows-server-"));
  try {
    const stage = join(scratch, "Yoink-Server");
    const app = join(stage, "app");
    mkdirSync(join(stage, "node"), { recursive: true });
    mkdirSync(join(app, "release"), { recursive: true });

    run("Compile the app into a scratch tree", process.execPath, [
      "scripts/build-dist.mjs", `--dist=${join(scratch, "dist")}`, "--no-swap"
    ]);
    cpSync(join(scratch, "dist.next"), join(app, "dist"), { recursive: true });
    const build = JSON.parse(readFileSync(join(app, "dist", "build-info.json"), "utf8"));

    writeFileSync(join(app, "package.json"), `${JSON.stringify({
      name: packageJson.name,
      version,
      private: true,
      type: packageJson.type,
      description: packageJson.description,
      engines: packageJson.engines,
      dependencies: packageJson.dependencies
    }, null, 2)}\n`);
    for (const path of productionPackagePaths(lock)) {
      const source = join(ROOT, path);
      if (!existsSync(source)) throw new Error(`${path} is not installed; run npm ci first.`);
      cpSync(source, join(app, path), { recursive: true });
    }
    cpSync(companion, join(app, "release", `Yoink-Companion-${version}.zip`));

    const { archive, name } = await windowsNode(nodeVersion);
    run("Extract node.exe", "unzip", ["-q", "-j", archive, `${name}/node.exe`, `${name}/LICENSE`, "-d", join(stage, "node")]);
    const nodeSha256 = sha256(join(stage, "node", "node.exe"));

    writeFileSync(join(stage, "Start Yoink.cmd"), renderStartScript());
    writeFileSync(join(stage, "yoink-server.json"), `${JSON.stringify(renderManifest({ version, build, nodeVersion, nodeSha256 }), null, 2)}\n`);

    mkdirSync(outputDirectory, { recursive: true });
    const output = join(outputDirectory, `Yoink-Server-win-x64-${version}.zip`);
    rmSync(output, { force: true });
    run("Zip the package", "zip", ["-X", "-r", "-q", output, "."], { cwd: stage });
    const megabytes = (statSync(output).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`\nWrote ${output} (${megabytes} MB): Yoink ${version}, build ${String(build.commit).slice(0, 12)}${build.dirty ? " (dirty tree)" : ""}, Node ${nodeVersion}.\n`);
    if (build.dirty) process.stdout.write("Warning: the tree had uncommitted or untracked files; package a clean checkout for a release.\n");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Windows server package failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
