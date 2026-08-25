import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(process.cwd());
const extensionRoot = join(projectRoot, "apps", "extension");
const argument = (name) => process.argv.slice(2).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
const profile = argument("--profile") || "local";
if (!["local", "production"].includes(profile)) {
  throw new Error("Extension package profile must be local or production.");
}
const outputDirectory = argument("--output-directory");
const releaseRoot = outputDirectory ? resolve(projectRoot, outputDirectory) : join(projectRoot, "release");

function exactHttpsOrigin(value, name) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(`${name} must be an exact credential-free HTTPS origin.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash
    || parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost")
    || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]") {
    throw new Error(`${name} must be an exact credential-free HTTPS origin.`);
  }
  return parsed.origin;
}

const apiOriginArgument = argument("--api-origin") || process.env.YOINK_EXTENSION_API_ORIGIN || "";
const appOriginArgument = argument("--app-origin") || process.env.YOINK_EXTENSION_APP_ORIGIN || apiOriginArgument;
if (profile === "local" && (apiOriginArgument || argument("--app-origin") || process.env.YOINK_EXTENSION_APP_ORIGIN)) {
  throw new Error("The local extension profile has a fixed loopback origin and accepts no origin override.");
}
const runtimeConfig = profile === "production" ? {
  profile,
  apiOrigin: exactHttpsOrigin(apiOriginArgument, "Production extension API origin"),
  appOrigin: exactHttpsOrigin(appOriginArgument, "Production extension app origin"),
  localPackageUpdates: false
} : {
  profile,
  apiOrigin: "http://127.0.0.1:32991",
  appOrigin: "http://127.0.0.1:32991",
  localPackageUpdates: true
};
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(extensionRoot, "manifest.json"), "utf8"));
if (packageJson.version !== manifest.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error("The package and extension manifest versions must match before packaging.");
}

const files = [
  "manifest.json",
  "runtime-config.js",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "target-shadow.js",
  "target-action.js",
  "walmart-action.js",
  "amazon-action.js",
  "bestbuy-action.js",
  "retailer-shadow.js",
  "observer-recipe-oracle.js",
  "trackalacker-push.js",
  "trackalacker-sync.js",
  "observer-recipe-root.js",
  "yoink-icon.svg",
  "README.md"
];
for (const file of files) readFileSync(join(extensionRoot, file));

mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
const archive = join(releaseRoot, `Yoink-Companion-${packageJson.version}${profile === "production" ? "-production" : ""}.zip`);
rmSync(archive, { force: true });
const stagingRoot = mkdtempSync(join(tmpdir(), "yoink-extension-package-"));
const fixedTime = new Date("1980-01-01T00:00:00.000Z");
let packaged;
try {
  for (const file of files) {
    const staged = join(stagingRoot, file);
    if (profile === "production" && file === "manifest.json") {
      writeFileSync(staged, `${JSON.stringify({
        ...manifest,
        host_permissions: [`${runtimeConfig.apiOrigin}/*`]
      }, null, 2)}\n`, { mode: 0o600 });
    } else if (profile === "production" && file === "runtime-config.js") {
      writeFileSync(
        staged,
        `"use strict";\n\nglobalThis.YoinkRuntimeConfig = Object.freeze(${JSON.stringify(runtimeConfig, null, 2)});\n`,
        { mode: 0o600 }
      );
    } else {
      copyFileSync(join(extensionRoot, file), staged);
    }
    chmodSync(staged, 0o644);
    utimesSync(staged, fixedTime, fixedTime);
  }
  packaged = spawnSync("zip", ["-X", "-j", "-q", archive, ...files.map((file) => join(stagingRoot, file))], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" }
  });
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
if (packaged.status !== 0) {
  rmSync(archive, { force: true });
  throw new Error(packaged.stderr || "Extension packaging failed.");
}
const body = readFileSync(archive);
const sha256 = createHash("sha256").update(body).digest("hex");
process.stdout.write(`Packaged ${archive}\nProfile ${profile}\nSHA-256 ${sha256}\n`);
