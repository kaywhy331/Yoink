import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, posix, resolve, win32 } from "node:path";

/**
 * Where Yoink keeps its database, backups, Ed25519 signing keys and the
 * YoinkBot secret key (YOINK-DATA-DIR). An explicit YOINK_DATA_DIR always
 * wins. Production refuses to guess; development uses a per-user folder
 * outside any checkout, so a stray `git add -f` can never commit a key.
 */
export interface DataDirectoryResolution {
  path: string;
  source: "configured" | "default";
  /**
   * A `<cwd>/data` folder from before the per-user default, left where it is.
   * Only its existence is checked; nothing inside it is opened, moved or copied.
   */
  legacyDirectory: string | null;
}

export interface DataDirectoryHost {
  platform: NodeJS.Platform;
  homeDirectory: string;
}

function currentHost(): DataDirectoryHost {
  let homeDirectory = "";
  try { homeDirectory = homedir(); } catch { /* no home: defaultDataDirectory names the fix */ }
  return { platform: process.platform, homeDirectory };
}

/** NODE_ENV=production or hosted mode: the data directory must be named, never defaulted. */
export function isProductionEnvironment(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV ?? "").trim() === "production" || env.YOINK_HOSTED_MODE === "1";
}

/**
 * The per-user default: %APPDATA%\Yoink on Windows, ~/Library/Application
 * Support/Yoink on macOS, and $XDG_DATA_HOME/yoink (else ~/.local/share/yoink)
 * elsewhere. A relative APPDATA or XDG_DATA_HOME is ignored, as the XDG spec asks.
 */
export function defaultDataDirectory(env: NodeJS.ProcessEnv, host: DataDirectoryHost = currentHost()): string {
  const paths = host.platform === "win32" ? win32 : posix;
  if (!host.homeDirectory || !paths.isAbsolute(host.homeDirectory)) {
    throw new Error("Yoink could not find your home folder for its data directory. Set YOINK_DATA_DIR to a private directory outside the app folder.");
  }
  if (host.platform === "win32") {
    const appData = String(env.APPDATA ?? "").trim();
    return win32.join(win32.isAbsolute(appData) ? appData : win32.join(host.homeDirectory, "AppData", "Roaming"), "Yoink");
  }
  if (host.platform === "darwin") return posix.join(host.homeDirectory, "Library", "Application Support", "Yoink");
  const dataHome = String(env.XDG_DATA_HOME ?? "").trim();
  return posix.join(posix.isAbsolute(dataHome) ? dataHome : posix.join(host.homeDirectory, ".local", "share"), "yoink");
}

export function resolveDataDirectory(
  cwd: string,
  env: NodeJS.ProcessEnv,
  host: DataDirectoryHost = currentHost()
): DataDirectoryResolution {
  const projectRoot = resolve(cwd);
  if (env.YOINK_DATA_DIR !== undefined) {
    const requested = String(env.YOINK_DATA_DIR).trim();
    if (!requested) throw new Error("YOINK_DATA_DIR must identify a non-empty directory.");
    return {
      path: isAbsolute(requested) ? requested : resolve(projectRoot, requested),
      source: "configured",
      legacyDirectory: null
    };
  }
  if (isProductionEnvironment(env)) {
    throw new Error(
      "YOINK_DATA_DIR is required in production (NODE_ENV=production or YOINK_HOSTED_MODE=1). "
      + "Set it to a private directory outside the app folder; it holds the database and the signing and bot keys."
    );
  }
  const path = defaultDataDirectory(env, host);
  const legacy = resolve(projectRoot, "data");
  let legacyExists = false;
  // Only the folder itself is stat'ed; a folder Yoink cannot even stat is not reported.
  try { legacyExists = legacy !== path && statSync(legacy, { throwIfNoEntry: false })?.isDirectory() === true; } catch { /* unreadable */ }
  return { path, source: "default", legacyDirectory: legacyExists ? legacy : null };
}

/** The startup line for a legacy `<cwd>/data` folder, or null when there is none. */
export function legacyDataDirectoryWarning(
  resolution: Pick<DataDirectoryResolution, "path" | "legacyDirectory">
): string | null {
  if (!resolution.legacyDirectory) return null;
  return `Warning: Yoink now keeps its data in ${resolution.path}, outside the app folder. `
    + `An earlier data directory is still at ${resolution.legacyDirectory}; it was not opened, moved or copied. `
    + "To keep its plans, calls and keys, stop Yoink and move it yourself (README › Move the data directory out of the app folder), "
    + "or set YOINK_DATA_DIR to the folder you want.";
}

let legacyWarningWritten = false;

/** Writes the legacy-folder warning at most once per process. */
export function warnAboutLegacyDataDirectory(
  resolution: Pick<DataDirectoryResolution, "path" | "legacyDirectory">,
  write: (line: string) => void
): boolean {
  const warning = legacyDataDirectoryWarning(resolution);
  if (!warning || legacyWarningWritten) return false;
  legacyWarningWritten = true;
  write(warning);
  return true;
}
