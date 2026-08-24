import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(process.cwd());
const extensionRoot = join(projectRoot, "apps", "extension");
const releaseRoot = join(projectRoot, "release");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(extensionRoot, "manifest.json"), "utf8"));
if (packageJson.version !== manifest.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error("The package and extension manifest versions must match before packaging.");
}

const files = [
  "manifest.json",
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
  "trackalacker-push.js",
  "trackalacker-sync.js",
  "yoink-icon.svg",
  "README.md"
];
for (const file of files) readFileSync(join(extensionRoot, file));

mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
const archive = join(releaseRoot, `Yoink-Companion-${packageJson.version}.zip`);
rmSync(archive, { force: true });
const packaged = spawnSync("zip", ["-X", "-j", "-q", archive, ...files.map((file) => join(extensionRoot, file))], {
  cwd: projectRoot,
  encoding: "utf8"
});
if (packaged.status !== 0) throw new Error(packaged.stderr || "Extension packaging failed.");
const body = readFileSync(archive);
const sha256 = createHash("sha256").update(body).digest("hex");
process.stdout.write(`Packaged ${archive}\nSHA-256 ${sha256}\n`);
