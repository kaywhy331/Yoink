#!/usr/bin/env node
// Builds the Windows release: release/Yoink-win-x64-<version>.zip, holding
//   Yoink.exe                          the tray app (self-contained .NET 8, no install needed)
//   Yoink-Server-win-x64-<version>.zip the server package the tray installs on first run
//   README.txt                         install, move-from-TrixBot and update steps
//
//   node scripts/package-windows.mjs               # server package, tray tests, tray publish, ZIP
//   node scripts/package-windows.mjs --skip-server # reuse release/Yoink-Server-win-x64-<version>.zip
//
// Needs the .NET 8 SDK: `dotnet` on PATH, $DOTNET, or ~/.dotnet/dotnet.
// The same ZIP is what "Install update from ZIP…" in the tray accepts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRAY = join(ROOT, "apps", "windows-tray");
const argv = process.argv.slice(2);

function run(label, command, args, options = {}) {
  process.stdout.write(`\n== ${label}\n`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", ...options, env: { ...process.env, ...options.env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}.`);
}

export function dotnetPath(env = process.env) {
  if (env.DOTNET) return env.DOTNET;
  const probe = spawnSync("sh", ["-c", "command -v dotnet"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
  const local = join(homedir(), ".dotnet", "dotnet");
  if (existsSync(local)) return local;
  throw new Error("The .NET 8 SDK is not installed; install it (dotnet-install.sh --channel 8.0) or set DOTNET.");
}

export function renderReadme(version) {
  return [
    `Yoink ${version} for Windows`,
    "",
    "INSTALL",
    "1. Extract this ZIP to a folder you keep, for example C:\\Yoink. Keep the ZIP's files together.",
    "2. Run Yoink.exe. A Y icon appears in the notification area (it may be under the ^ arrow).",
    "   On first run it installs the server into %LOCALAPPDATA%\\Yoink\\server and starts it.",
    "3. Right-click the icon > Settings... > tick \"Start Yoink when I sign in to Windows\".",
    "",
    "Windows SmartScreen may warn that Yoink.exe is from an unknown publisher (it is not code-signed):",
    "choose More info > Run anyway.",
    "",
    "The icon's colour is the server's state: green running, amber starting or stopping,",
    "red needs attention (hover or right-click for the reason), grey stopped.",
    "",
    "MOVING FROM TRIXBOT",
    "1. On TrixBot: systemctl --user stop yoink-local-api, then node scripts/export-data.mjs.",
    "   It writes ~/Yoink-Data-<time>.zip (database snapshot, keys, evidence).",
    "2. Copy that ZIP next to Yoink.exe on this PC (for example with scp over Tailscale).",
    "3. Close the SSH tunnel to TrixBot: it holds port 32991 on this PC, and the tray app says so if",
    "   it is still open.",
    "4. Run Yoink.exe. On first run it imports the Yoink-Data ZIP (any name starting Yoink-Data) into an empty data folder, then starts.",
    "   Later imports: right-click > Import data from ZIP... (the current data is kept beside it).",
    "5. Delete the Yoink-Data ZIP on both machines: it holds keys and pairing hashes.",
    "The Chrome companion keeps its pairing: it talks to http://127.0.0.1:32991 either way.",
    "",
    "UPDATE",
    "Right-click the icon > Install update from ZIP... and choose the new Yoink-win-x64 ZIP.",
    "The tray stops the server, installs the new version beside the old one, and starts it again.",
    "The two previous versions are kept in %LOCALAPPDATA%\\Yoink\\server.",
    "",
    "FILES",
    "%LOCALAPPDATA%\\Yoink\\data             database, keys and backups (keep this)",
    "%LOCALAPPDATA%\\Yoink\\logs             tray-*.log and server-*.log, 14 days",
    "%LOCALAPPDATA%\\Yoink\\tray-settings.json",
    "Dashboard: http://127.0.0.1:32991/  (double-click the icon)",
    ""
  ].join("\r\n");
}

const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = packageJson.version;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scratch = mkdtempSync(join(tmpdir(), "yoink-windows-"));
  try {
    const dotnet = dotnetPath();
    const dotnetEnv = { DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" };
    const serverZip = join(ROOT, "release", `Yoink-Server-win-x64-${version}.zip`);
    if (!argv.includes("--skip-server") || !existsSync(serverZip)) {
      run("Server package", process.execPath, ["scripts/package-windows-server.mjs"]);
    }
    run("Tray app tests", dotnet, ["run", "-c", "Release", "--project", join(TRAY, "tests"), "--", ROOT], { env: dotnetEnv });
    const publish = join(scratch, "publish");
    run("Tray app publish (win-x64, self-contained, single file)", dotnet, [
      "publish", join(TRAY, "Yoink.Tray.csproj"), "-c", "Release", "-r", "win-x64", "--self-contained", "true",
      "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true", "-p:EnableCompressionInSingleFile=true",
      "-p:DebugType=none", `-p:Version=${version}`, "-o", publish
    ], { env: dotnetEnv });

    const stage = join(scratch, "stage");
    mkdirSync(stage, { recursive: true });
    copyFileSync(join(publish, "Yoink.exe"), join(stage, "Yoink.exe"));
    copyFileSync(serverZip, join(stage, `Yoink-Server-win-x64-${version}.zip`));
    writeFileSync(join(stage, "README.txt"), renderReadme(version));
    const output = join(ROOT, "release", `Yoink-win-x64-${version}.zip`);
    rmSync(output, { force: true });
    run("Zip the release", "zip", ["-X", "-q", output, "Yoink.exe", `Yoink-Server-win-x64-${version}.zip`, "README.txt"], { cwd: stage });
    const megabytes = (statSync(output).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`\nWrote ${output} (${megabytes} MB).\n`);
  } catch (error) {
    process.stderr.write(`Windows release failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
