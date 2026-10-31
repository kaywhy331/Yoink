import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, posix, resolve, sep, win32 } from "node:path";
import test, { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/api/src/config.js";
import { loadWorkerConfig } from "../apps/worker/src/config.js";
import {
  defaultDataDirectory,
  legacyDataDirectoryWarning,
  resolveDataDirectory,
  warnAboutLegacyDataDirectory,
  type DataDirectoryHost
} from "../packages/database/src/data-directory.js";
// @ts-expect-error -- plain .mjs script without type declarations
import { forbiddenPaths } from "../scripts/lint-secret-files.mjs";

const ROOT = process.cwd();
const PRODUCTION_REFUSAL = /YOINK_DATA_DIR is required in production/;
const FAKE_KEYS: Record<string, string> = {
  "observer-recipe-ed25519-private.pem": "-----BEGIN TEST FIXTURE-----\nnot a key\n-----END TEST FIXTURE-----\n",
  "yoinkbot-secret.key": "test fixture, not a key",
  "yoink.sqlite": "test fixture, not a database"
};

function isOutside(root: string, path: string, paths: typeof posix | typeof win32): boolean {
  const between = paths.relative(root, path);
  return between === ".." || between.startsWith(`..${paths.sep}`) || paths.isAbsolute(between);
}

/** A temp app folder whose `data/` holds stand-in key files, plus a temp home. */
function legacyLayout(): { cwd: string; home: string; legacy: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), "yoink-data-dir-"));
  const cwd = join(base, "app");
  const home = join(base, "home");
  const legacy = join(cwd, "data");
  mkdirSync(legacy, { recursive: true });
  mkdirSync(home, { recursive: true });
  for (const [name, content] of Object.entries(FAKE_KEYS)) writeFileSync(join(legacy, name), content, { mode: 0o600 });
  return { cwd, home, legacy, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function homeEnvironment(home: string): NodeJS.ProcessEnv {
  return { HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), XDG_DATA_HOME: join(home, "xdg") };
}

function snapshot(directory: string): string {
  return JSON.stringify(readdirSync(directory).sort().map((name) => {
    const stats = statSync(join(directory, name));
    const digest = createHash("sha256").update(readFileSync(join(directory, name))).digest("hex");
    return [name, stats.size, stats.mtimeMs, stats.mode, digest];
  }));
}

test("production refuses to start without YOINK_DATA_DIR and accepts an explicit one", () => {
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: " production " }]) {
    assert.throws(() => loadConfig(ROOT, env), PRODUCTION_REFUSAL);
    assert.throws(() => loadWorkerConfig(ROOT, env), PRODUCTION_REFUSAL);
  }
  // Hosted mode is production too, and names the data directory before anything else.
  assert.throws(() => loadConfig(ROOT, { YOINK_HOSTED_MODE: "1" }), PRODUCTION_REFUSAL);
  assert.throws(() => loadWorkerConfig(ROOT, { YOINK_HOSTED_MODE: "1" }), PRODUCTION_REFUSAL);
  assert.throws(() => loadConfig(ROOT, { NODE_ENV: "production", YOINK_DATA_DIR: " " }), /non-empty directory/);

  const explicit = resolve(tmpdir(), "yoink-production-data");
  const config = loadConfig(ROOT, { NODE_ENV: "production", YOINK_DATA_DIR: explicit });
  assert.equal(config.dataDirectory, explicit);
  assert.equal(config.databasePath, join(explicit, "yoink.sqlite"));
  assert.equal(config.legacyDataDirectory, null);
  assert.equal(loadWorkerConfig(ROOT, { NODE_ENV: "production", YOINK_DATA_DIR: explicit }).dataDirectory, explicit);
  // An explicit relative directory keeps resolving against the working directory.
  assert.equal(loadConfig(ROOT, { YOINK_DATA_DIR: "worker-data" }).dataDirectory, resolve(ROOT, "worker-data"));
});

test("the API and the standalone worker exit 78 in production without YOINK_DATA_DIR and create nothing", async () => {
  const { home, cleanup } = legacyLayout();
  try {
    // Port 1 is refused by configuration too, so a missed refusal could never bind a real port.
    const env: NodeJS.ProcessEnv = { ...process.env, ...homeEnvironment(home), NODE_ENV: "production", YOINK_PORT: "1" };
    delete env.YOINK_DATA_DIR;
    for (const entry of ["apps/api/src/server.ts", "apps/worker/src/server.ts"]) {
      const child = spawn(process.execPath, ["--import", "tsx", entry], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
      const [exitCode] = await once(child, "exit") as [number | null];
      assert.equal(exitCode, 78, `${entry} exit code:\n${output}`);
      assert.match(output, PRODUCTION_REFUSAL, entry);
    }
    assert.deepEqual(readdirSync(home), [], "nothing is created under the home folder");
  } finally {
    cleanup();
  }
});

test("the development default is a per-user folder outside the app folder on every platform", () => {
  const cases: Array<{ host: DataDirectoryHost; env: NodeJS.ProcessEnv; repo: string; expected: string }> = [
    {
      host: { platform: "win32", homeDirectory: "C:\\Users\\kevin" },
      env: { APPDATA: "C:\\Users\\kevin\\AppData\\Roaming" },
      repo: "C:\\Users\\kevin\\code\\Yoink",
      expected: "C:\\Users\\kevin\\AppData\\Roaming\\Yoink"
    },
    {
      host: { platform: "win32", homeDirectory: "C:\\Users\\kevin" },
      env: { APPDATA: "relative\\AppData" },
      repo: "C:\\Users\\kevin\\code\\Yoink",
      expected: "C:\\Users\\kevin\\AppData\\Roaming\\Yoink"
    },
    {
      host: { platform: "darwin", homeDirectory: "/Users/kevin" },
      env: { XDG_DATA_HOME: "/Users/kevin/.xdg" },
      repo: "/Users/kevin/code/Yoink",
      expected: "/Users/kevin/Library/Application Support/Yoink"
    },
    {
      host: { platform: "linux", homeDirectory: "/home/kevin" },
      env: { XDG_DATA_HOME: "/home/kevin/.data" },
      repo: "/home/kevin/project/Yoink",
      expected: "/home/kevin/.data/yoink"
    },
    {
      host: { platform: "linux", homeDirectory: "/home/kevin" },
      env: {},
      repo: "/home/kevin/project/Yoink",
      expected: "/home/kevin/.local/share/yoink"
    },
    {
      host: { platform: "linux", homeDirectory: "/home/kevin" },
      env: { XDG_DATA_HOME: "relative/xdg" },
      repo: "/home/kevin/project/Yoink",
      expected: "/home/kevin/.local/share/yoink"
    }
  ];
  for (const { host, env, repo, expected } of cases) {
    const paths = host.platform === "win32" ? win32 : posix;
    const resolved = defaultDataDirectory(env, host);
    assert.equal(resolved, expected, `${host.platform} ${JSON.stringify(env)}`);
    assert.ok(isOutside(repo, resolved, paths), `${resolved} is outside ${repo}`);
    const resolution = resolveDataDirectory(ROOT, env, host);
    assert.equal(resolution.path, expected);
    assert.equal(resolution.source, "default");
  }
  assert.throws(() => defaultDataDirectory({}, { platform: "linux", homeDirectory: "" }), /Set YOINK_DATA_DIR/);

  // The real platform, through both config loaders.
  const home = mkdtempSync(join(tmpdir(), "yoink-default-home-"));
  try {
    const env = homeEnvironment(home);
    const expected = defaultDataDirectory(env, { platform: process.platform, homeDirectory: home });
    for (const config of [loadConfig(ROOT, env), loadWorkerConfig(ROOT, env)]) {
      assert.equal(config.dataDirectory, expected);
      assert.equal(config.databasePath, join(expected, "yoink.sqlite"));
      assert.ok(isOutside(ROOT, config.dataDirectory, sep === "\\" ? win32 : posix), "the default is outside the checkout");
    }
    assert.deepEqual(readdirSync(home), [], "loading configuration creates no directory");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a legacy <cwd>/data folder is reported once and none of its files is opened, moved or copied", () => {
  const { cwd, home, legacy, cleanup } = legacyLayout();
  const before = snapshot(legacy);
  const watched = ["readFileSync", "openSync", "copyFileSync", "cpSync", "renameSync", "rmSync", "unlinkSync", "readdirSync", "createReadStream"];
  const spies = watched.map((name) => mock.method(fs as unknown as Record<string, (...args: unknown[]) => unknown>, name));
  syncBuiltinESMExports();
  try {
    const env = homeEnvironment(home);
    const expected = defaultDataDirectory(env, { platform: process.platform, homeDirectory: home });
    const config = loadConfig(cwd, env);
    const workerConfig = loadWorkerConfig(cwd, env);
    assert.equal(config.dataDirectory, expected);
    assert.equal(config.legacyDataDirectory, legacy);
    assert.equal(workerConfig.legacyDataDirectory, legacy);
    // An explicit directory is the operator's choice: no warning, even with data/ present.
    assert.equal(loadConfig(cwd, { ...env, YOINK_DATA_DIR: legacy }).legacyDataDirectory, null);

    const lines: string[] = [];
    assert.equal(warnAboutLegacyDataDirectory({ path: config.dataDirectory, legacyDirectory: config.legacyDataDirectory }, (line) => lines.push(line)), true);
    assert.equal(warnAboutLegacyDataDirectory({ path: workerConfig.dataDirectory, legacyDirectory: workerConfig.legacyDataDirectory }, (line) => lines.push(line)), false);
    assert.equal(lines.length, 1, "the warning is written once per process");
    assert.ok(lines[0]?.includes(expected), "the warning names the new location");
    assert.ok(lines[0]?.includes(legacy), "the warning names the legacy folder");
    assert.match(lines[0] ?? "", /not opened, moved or copied/);
    assert.equal(legacyDataDirectoryWarning({ path: expected, legacyDirectory: null }), null);

    const inside = (value: unknown): boolean => {
      const path = typeof value === "string" ? value : value instanceof URL ? fileURLToPath(value) : "";
      return path !== "" && resolve(path).startsWith(`${legacy}${sep}`);
    };
    assert.ok(
      spies[0]?.mock.calls.some((call) => String(call.arguments[0]).endsWith("package.json")),
      "the spies see the config loaders' own reads, so an empty list below is real"
    );
    for (const [index, spy] of spies.entries()) {
      const touched = spy.mock.calls.filter((call) => call.arguments.slice(0, 2).some(inside));
      assert.deepEqual(touched.map((call) => call.arguments[0]), [], `${watched[index]} never touches a file in the legacy folder`);
      if (watched[index] === "readdirSync") {
        assert.equal(spy.mock.calls.some((call) => resolve(String(call.arguments[0])) === legacy), false, "the legacy folder is not listed");
      }
    }
  } finally {
    for (const spy of spies) spy.mock.restore();
    syncBuiltinESMExports();
  }
  try {
    assert.equal(snapshot(legacy), before, "the legacy files keep their names, sizes, times, modes and contents");
    assert.deepEqual(readdirSync(home), [], "nothing was created or copied at the new location");
  } finally {
    cleanup();
  }
});

test("the standalone worker prints the legacy warning at startup and leaves the legacy folder alone", async () => {
  const { cwd, home, legacy, cleanup } = legacyLayout();
  try {
    const before = snapshot(legacy);
    const env: NodeJS.ProcessEnv = { ...process.env, ...homeEnvironment(home) };
    delete env.YOINK_DATA_DIR;
    delete env.NODE_ENV;
    delete env.YOINK_HOSTED_MODE;
    const expected = defaultDataDirectory(env, { platform: process.platform, homeDirectory: home });
    const child = spawn(process.execPath, [
      "--import", import.meta.resolve("tsx"),
      join(ROOT, "apps", "worker", "src", "server.ts")
    ], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    const [exitCode] = await once(child, "exit") as [number | null];
    // No database has been migrated at the new location yet, so the worker stops (transient, exit 1).
    assert.equal(exitCode, 1, output);
    assert.equal(output.split(`now keeps its data in ${expected}`).length - 1, 1, `one warning naming the new location:\n${output}`);
    assert.ok(output.includes(legacy), "the warning names the legacy folder");
    assert.equal(snapshot(legacy), before);
    assert.deepEqual(readdirSync(expected), [], "no key or database was copied to the new location");
  } finally {
    cleanup();
  }
});

test("the API and worker servers write the legacy warning right after loading configuration", () => {
  for (const entry of ["apps/api/src/server.ts", "apps/worker/src/server.ts"]) {
    const source = readFileSync(join(ROOT, entry), "utf8");
    assert.match(source, /warnAboutLegacyDataDirectory\(\s*\{ path: config\.dataDirectory, legacyDirectory: config\.legacyDataDirectory \}/, entry);
  }
});

test("the secret-file check refuses data/ files and *.pem / *.key files in the git index", () => {
  assert.deepEqual(forbiddenPaths([
    "README.md",
    "data/yoink.sqlite",
    "data/observer-recipe-ed25519-private.pem",
    "apps/api/src/config.ts",
    "docs/release.KEY",
    "keys/signing.pem",
    "test/fixtures/data/catalog.json",
    "packages/engine/src/keyboard.ts",
    "metadata/notes.md"
  ]), ["data/yoink.sqlite", "data/observer-recipe-ed25519-private.pem", "docs/release.KEY", "keys/signing.pem"]);

  const script = join(ROOT, "scripts", "lint-secret-files.mjs");
  const base = mkdtempSync(join(tmpdir(), "yoink-secret-files-"));
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: base };
  for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX"]) delete env[name];
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  };
  const lint = (cwd: string) => spawnSync(process.execPath, [script], { cwd, env, encoding: "utf8" });
  try {
    const repo = join(base, "repo");
    mkdirSync(join(repo, "data"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    git(repo, "init", "-q");
    writeFileSync(join(repo, "src", "index.ts"), "export {};\n");
    git(repo, "add", "src/index.ts");
    const clean = lint(join(repo, "src"));
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /none of 1 indexed files/);

    writeFileSync(join(repo, "data", "yoink.sqlite"), "fixture");
    writeFileSync(join(repo, "signing.KEY"), "fixture");
    git(repo, "add", "-f", "data/yoink.sqlite", "signing.KEY");
    const staged = lint(join(repo, "src"));
    assert.equal(staged.status, 1);
    assert.match(staged.stderr, /data\/yoink\.sqlite/);
    assert.match(staged.stderr, /signing\.KEY/);
    assert.match(staged.stderr, /git rm --cached/);

    git(repo, "rm", "-q", "--cached", "data/yoink.sqlite", "signing.KEY");
    assert.equal(lint(repo).status, 0, "unstaging clears the check");
    assert.equal(existsSync(join(repo, "data", "yoink.sqlite")), true, "the unstaged file stays on disk");

    const outside = join(base, "not-a-repo");
    mkdirSync(outside);
    const skipped = lint(outside);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stdout, /not a git work tree/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the repository ignores private keys and the check runs on every npm run check", () => {
  const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split(/\r?\n/);
  for (const pattern of ["data/", "*.pem", "*.key"]) assert.ok(ignore.includes(pattern), `.gitignore lists ${pattern}`);
  const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  assert.match(scripts.check ?? "", /^npm run lint:secret-files && /);
  assert.equal(scripts["lint:secret-files"], "node scripts/lint-secret-files.mjs");
  assert.match(readFileSync(join(ROOT, ".githooks", "pre-commit"), "utf8"), /npm run --silent check/);
});
