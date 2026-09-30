#!/usr/bin/env node
// Publishes a built Windows release to the depot so the tray app on the PC
// installs it by itself:
//
//   node scripts/publish-release.mjs                 # release/Yoink-win-x64-<version>.zip
//   node scripts/publish-release.mjs --file=<zip>
//   node scripts/publish-release.mjs --print-public-key
//
// Writes <depot>/releases/<zip>, latest.json and latest.sig. latest.sig is an
// ECDSA P-256 / SHA-256 signature (IEEE P1363, base64) over the exact bytes of
// latest.json, made with the release key in ~/.config/yoink/release-signing-key.pem
// (created on first use). The tray pins the matching public key
// (apps/windows-tray/release-public-key.txt) and refuses anything else.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DEPOT_ROOT } from "./depot-server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SIGNING_KEY_PATH = process.env.YOINK_RELEASE_KEY || join(homedir(), ".config", "yoink", "release-signing-key.pem");
export const PUBLIC_KEY_PATH = join(ROOT, "apps", "windows-tray", "release-public-key.txt");
const argv = process.argv.slice(2);
const option = (name) => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";

/** The release private key; created owner-only the first time. */
export function releaseSigningKey(path = SIGNING_KEY_PATH) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  }
  return createPrivateKey(readFileSync(path, "utf8"));
}

/** SubjectPublicKeyInfo, DER, base64: what the tray pins. */
export function publicKeyText(privateKey) {
  return createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
}

export function signManifest(manifestText, privateKey) {
  return sign("sha256", Buffer.from(manifestText, "utf8"), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
}

export function renderManifest({ version, file, sha256, size, commit, publishedAt = new Date().toISOString() }) {
  return `${JSON.stringify({ schemaVersion: 1, product: "yoink-windows", version, file, sha256, size, commit, publishedAt }, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const key = releaseSigningKey();
    const publicKey = publicKeyText(key);
    if (argv.includes("--print-public-key")) {
      process.stdout.write(`${publicKey}\n`);
      process.exit(0);
    }
    const pinned = existsSync(PUBLIC_KEY_PATH) ? readFileSync(PUBLIC_KEY_PATH, "utf8").trim() : "";
    if (pinned !== publicKey) {
      throw new Error(`The tray pins a different release key than ${SIGNING_KEY_PATH}. Update ${PUBLIC_KEY_PATH} and rebuild the release, or restore the matching key.`);
    }
    const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
    const source = resolve(option("--file") || join(ROOT, "release", `Yoink-win-x64-${version}.zip`));
    if (!existsSync(source)) throw new Error(`${source} does not exist; run npm run package:windows first.`);
    const file = basename(source);
    const releases = join(DEPOT_ROOT, "releases");
    mkdirSync(releases, { recursive: true, mode: 0o700 });
    copyFileSync(source, join(releases, `${file}.part`));
    renameSync(join(releases, `${file}.part`), join(releases, file));
    const sha256 = createHash("sha256").update(readFileSync(source)).digest("hex");
    const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    const manifest = renderManifest({ version, file, sha256, size: statSync(source).size, commit });
    const signature = signManifest(manifest, key);
    // Signature first, then the manifest: a reader never sees a new manifest with an old signature for long,
    // and the tray re-verifies both on every check anyway.
    writeFileSync(join(releases, "latest.sig.part"), `${signature}\n`, { mode: 0o600 });
    writeFileSync(join(releases, "latest.json.part"), manifest, { mode: 0o600 });
    renameSync(join(releases, "latest.sig.part"), join(releases, "latest.sig"));
    renameSync(join(releases, "latest.json.part"), join(releases, "latest.json"));
    process.stdout.write(`Published ${file} (${version}, sha256 ${sha256.slice(0, 16)}…) to ${releases}.\n`);
  } catch (error) {
    process.stderr.write(`Publish failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
