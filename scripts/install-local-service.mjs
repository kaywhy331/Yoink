#!/usr/bin/env node
// Writes a persistent systemd user unit for the local Yoink app so the
// service survives a reboot, carries its environment, and never crash-loops
// on a problem only the operator can fix (P-08, Z-04, P-01, P-12).
//
//   node scripts/install-local-service.mjs            # write + enable --now
//   node scripts/install-local-service.mjs --print    # print the unit only
//   node scripts/install-local-service.mjs --uninstall
//
// The unit runs the compiled tree (`dist/`), so run `npm run build:types`
// (or `npm run release:local`) first.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNIT_NAME = process.env.YOINK_LOCAL_API_UNIT || "yoink-local-api.service";
const UNIT_DIRECTORY = join(homedir(), ".config", "systemd", "user");
const UNIT_PATH = join(UNIT_DIRECTORY, UNIT_NAME);
/** Exit status the app uses for configuration, lock, disk and migration failures. */
export const NON_RETRYABLE_EXIT_STATUS = 78;
const argv = process.argv.slice(2);

function argument(name) {
  return argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

/** A double-quoted systemd word: survives spaces, quotes and `%` specifiers (PLAT-07). */
export function systemdQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("%", "%%")}"`;
}

/** A single-value path setting (WorkingDirectory=) needs only specifier escaping. */
function systemdPath(value) {
  return String(value).replaceAll("%", "%%");
}

/**
 * The node the unit should run: the one on PATH, not the installing shell's
 * execPath, and a warning when it lives in a version manager's directory
 * that a node upgrade removes (exit 203/EXEC, PLAT-07).
 */
export function resolveNodePath() {
  const probe = spawnSync("sh", ["-c", "command -v node"], { encoding: "utf8" });
  const onPath = probe.status === 0 ? probe.stdout.trim() : "";
  const nodePath = onPath.startsWith("/") ? onPath : process.execPath;
  const warning = /\/\.(?:nvm|volta|fnm|asdf)\//.test(nodePath)
    ? `Warning: ${nodePath} belongs to a version manager; a node upgrade can remove it and stop the unit. Prefer a system node (e.g. /usr/bin/node) on PATH when installing.`
    : "";
  return { nodePath, warning };
}

export function renderUnit({
  projectRoot = ROOT,
  dataDirectory = argument("--data-dir") || process.env.YOINK_DATA_DIR || join(ROOT, "data"),
  port = argument("--port") || process.env.YOINK_PORT || "32991",
  nodePath = process.execPath
} = {}) {
  return [
    "[Unit]",
    "Description=Yoink local app (API, embedded worker, companion updates)",
    `Documentation=${pathToFileURL(join(projectRoot, "README.md")).href.replaceAll("%", "%%")}`,
    "# Five failed starts within ten minutes stop the unit instead of looping (P-01).",
    "StartLimitIntervalSec=600",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdPath(projectRoot)}`,
    `Environment=${systemdQuote(`YOINK_DATA_DIR=${dataDirectory}`)}`,
    `Environment=${systemdQuote(`YOINK_PORT=${port}`)}`,
    "Environment=NODE_OPTIONS=--disable-warning=ExperimentalWarning",
    `ExecStart=${systemdQuote(nodePath)} dist/apps/api/src/server.js`,
    "Restart=on-failure",
    "RestartSec=2s",
    `# Exit ${NON_RETRYABLE_EXIT_STATUS} means configuration, lock, disk or migration trouble: do not retry.`,
    `RestartPreventExitStatus=${NON_RETRYABLE_EXIT_STATUS}`,
    "TimeoutStopSec=15",
    "KillSignal=SIGTERM",
    "# The data directory holds pairing and session tokens.",
    "UMask=0077",
    "NoNewPrivileges=yes",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
}

/** Whether a transient unit (systemd-run) of the same name is loaded now. */
function transientUnitLoaded() {
  const probe = spawnSync("systemctl", ["--user", "show", UNIT_NAME, "--property=Transient,LoadState", "--no-pager"], { encoding: "utf8" });
  if (probe.status !== 0) return false;
  const values = Object.fromEntries(probe.stdout.trim().split("\n").map((line) => line.split("=")));
  return values.Transient === "yes" && values.LoadState === "loaded";
}

function systemctl(args, { allowFailure = false } = {}) {
  const result = spawnSync("systemctl", ["--user", ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`systemctl --user ${args.join(" ")} failed with status ${result.status}.`);
  return result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (argv.includes("--print")) {
      const { nodePath, warning } = resolveNodePath();
      if (warning) process.stderr.write(`${warning}\n`);
      process.stdout.write(renderUnit({ nodePath }));
    } else if (argv.includes("--uninstall")) {
      const dataDirectory = process.env.YOINK_DATA_DIR || join(ROOT, "data");
      systemctl(["disable", "--now", UNIT_NAME], { allowFailure: true });
      if (existsSync(UNIT_PATH)) unlinkSync(UNIT_PATH);
      systemctl(["daemon-reload"], { allowFailure: true });
      process.stdout.write([
        `Stopped and removed ${UNIT_NAME}.`,
        "Nothing else was deleted. To finish removing Yoink:",
        `  data directory (your plans, calls, backups): ${dataDirectory}`,
        `  compiled app and companion ZIPs:            ${join(ROOT, "dist")}, ${join(ROOT, "release")}`,
        "  Chrome companion:                            chrome://extensions → Yoink → Remove",
        "  Windows capture app (if installed):          Settings → Apps → Yoink Capture → Uninstall",
        "The full checklist is at /remove on the app and in README.md (Remove Yoink).",
        ""
      ].join("\n"));
    } else {
      if (!existsSync(join(ROOT, "dist", "apps", "api", "src", "server.js"))) {
        throw new Error("dist/apps/api/src/server.js is missing; run npm run build:types first.");
      }
      const { nodePath, warning } = resolveNodePath();
      if (warning) process.stderr.write(`${warning}\n`);
      // A transient unit of the same name (systemd-run) shadows the file in
      // ~/.config/systemd/user and cannot be enabled. Stopping it removes it;
      // then the persistent unit can take its name (PLAT-06).
      if (transientUnitLoaded()) {
        process.stdout.write(`Replacing the transient ${UNIT_NAME} (it would not survive a reboot): stopping it first.\n`);
        systemctl(["stop", UNIT_NAME]);
        if (transientUnitLoaded()) {
          throw new Error(`The transient ${UNIT_NAME} is still loaded after stopping it; run systemctl --user reset-failed ${UNIT_NAME} and retry.`);
        }
      }
      mkdirSync(UNIT_DIRECTORY, { recursive: true });
      const unit = renderUnit({ nodePath });
      const unchanged = existsSync(UNIT_PATH) && readFileSync(UNIT_PATH, "utf8") === unit;
      if (!unchanged) writeFileSync(UNIT_PATH, unit);
      systemctl(["daemon-reload"]);
      systemctl(["enable", "--now", UNIT_NAME]);
      process.stdout.write(`${unchanged ? "Kept" : "Wrote"} ${UNIT_PATH} and enabled ${UNIT_NAME}.\n`);
      process.stdout.write("To keep it running after logout or reboot without an open session: loginctl enable-linger $USER\n");
      process.stdout.write("Check it: npm run doctor\n");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
