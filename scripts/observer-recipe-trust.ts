import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadConfig } from "../apps/api/src/config.js";
import type {
  ObserverRecipeTrustKey,
  SignedObserverRecipeTrustManifest
} from "../packages/contracts/src/index.js";
import { PACKAGED_OBSERVER_RECIPE_ROOT } from "../packages/observer-registry/src/package-root.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import {
  createObserverRecipeTrustManifest,
  observerRecipeTrustManifestHash,
  validateObserverRecipeTrustManifest
} from "../packages/observer-registry/src/trust.js";

const MANIFEST_FILE = "observer-recipe-trust-manifest.json";
const PENDING_MANIFEST_FILE = "observer-recipe-trust-manifest.pending.json";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : "";
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function explicitPath(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required.`);
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function privateRootSigner(path: string): ObserverRecipeSigner {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error("The offline root private key must not be readable by group or other users.");
  const signer = ObserverRecipeSigner.fromPrivatePem(readFileSync(path));
  if (signer.keyId !== PACKAGED_OBSERVER_RECIPE_ROOT.keyId
    || signer.publicKeySpki !== PACKAGED_OBSERVER_RECIPE_ROOT.publicKeySpki) {
    throw new Error("The offline root private key does not match the public root pinned in the package.");
  }
  return signer;
}

function boundedDays(): number {
  const days = Number(option("--days") || 365);
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new Error("--days must be a whole number from 1 through 400.");
  }
  return days;
}

function historicalValidationTime(manifest: SignedObserverRecipeTrustManifest, now: number): number {
  const issuedAt = new Date(manifest.payload.issuedAt).getTime();
  const expiresAt = new Date(manifest.payload.expiresAt).getTime();
  return expiresAt > now ? now : Math.max(issuedAt, expiresAt - 1);
}

function readCurrent(path: string, now: number) {
  if (!existsSync(path)) throw new Error("No active observer recipe trust manifest exists to rotate or renew.");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as SignedObserverRecipeTrustManifest;
  return validateObserverRecipeTrustManifest(
    manifest,
    PACKAGED_OBSERVER_RECIPE_ROOT,
    historicalValidationTime(manifest, now),
    undefined
  );
}

function writeManifest(path: string, manifest: SignedObserverRecipeTrustManifest): void {
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing trust manifest output: ${path}`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

function key(
  signer: ObserverRecipeSigner,
  status: ObserverRecipeTrustKey["status"],
  notBefore: string,
  notAfter: string
): ObserverRecipeTrustKey {
  return {
    algorithm: "Ed25519",
    keyId: signer.keyId,
    publicKeySpki: signer.publicKeySpki,
    usage: "observer_recipe_signing",
    status,
    notBefore,
    notAfter
  };
}

const command = String(process.argv[2] ?? "");
if (!["initialize", "renew", "rotate"].includes(command)) {
  throw new Error(
    "Usage: npm run recipe-trust -- <initialize|renew|rotate> --root-private <private.pem> "
    + "[--data-dir <directory>] [--days 365] [--output <manifest.json>] [--revoke-current] [--revoke <key-id,...>]"
  );
}

const now = Date.now();
const issuedAt = new Date(now).toISOString();
const expiresAt = new Date(now + boundedDays() * 24 * 60 * 60_000).toISOString();
const config = loadConfig();
const dataDirectory = option("--data-dir") ? explicitPath(option("--data-dir"), "--data-dir") : config.dataDirectory;
const currentPath = join(dataDirectory, MANIFEST_FILE);
const defaultOutput = command === "initialize" ? currentPath : join(dataDirectory, PENDING_MANIFEST_FILE);
const outputPath = option("--output") ? explicitPath(option("--output"), "--output") : defaultOutput;
const rootSigner = privateRootSigner(explicitPath(option("--root-private"), "--root-private"));

let candidate: SignedObserverRecipeTrustManifest;
let activeIntermediate: ObserverRecipeSigner;
if (command === "initialize") {
  if (existsSync(currentPath)) throw new Error("Rooted observer recipe trust is already initialized.");
  activeIntermediate = ObserverRecipeSigner.persistent(dataDirectory);
  candidate = createObserverRecipeTrustManifest(rootSigner, {
    generation: 1,
    issuedAt,
    expiresAt,
    previousManifestHash: "",
    keys: [key(activeIntermediate, "active", issuedAt, expiresAt)],
    revokedKeyIds: []
  }, PACKAGED_OBSERVER_RECIPE_ROOT);
  validateObserverRecipeTrustManifest(candidate, PACKAGED_OBSERVER_RECIPE_ROOT, now, null);
} else {
  const current = readCurrent(currentPath, now);
  const requestedRevocations = option("--revoke").split(",").map((value) => value.trim()).filter(Boolean);
  if (requestedRevocations.some((keyId) => !/^[a-f0-9]{64}$/.test(keyId))) {
    throw new Error("--revoke accepts only comma-separated 64-character key IDs.");
  }
  const revoked = new Set([...current.manifest.payload.revokedKeyIds, ...requestedRevocations]);
  let keys: ObserverRecipeTrustKey[];
  if (command === "rotate") {
    activeIntermediate = ObserverRecipeSigner.named(dataDirectory);
    if (flag("--revoke-current")) revoked.add(current.activeKey.keyId);
    const retained = current.manifest.payload.keys.slice(-7).map((item) => ({ ...item, status: "retired" as const }));
    for (const removed of current.manifest.payload.keys.slice(0, -7)) revoked.add(removed.keyId);
    keys = [...retained, key(activeIntermediate, "active", issuedAt, expiresAt)];
  } else {
    activeIntermediate = ObserverRecipeSigner.fromNamed(dataDirectory, current.activeKey.keyId)
      ?? ObserverRecipeSigner.persistent(dataDirectory);
    if (activeIntermediate.keyId !== current.activeKey.keyId
      || activeIntermediate.publicKeySpki !== current.activeKey.publicKeySpki) {
      throw new Error("The active intermediate private key is unavailable; use rotate instead of renew.");
    }
    keys = current.manifest.payload.keys.map((item) => item.keyId === current.activeKey.keyId
      ? { ...item, status: "active", notAfter: expiresAt }
      : { ...item, status: "retired" });
  }
  if (revoked.has(activeIntermediate.keyId)) throw new Error("The candidate active key cannot also be revoked.");
  if (revoked.size > 32) throw new Error("The observer recipe revocation set exceeds its bounded size.");
  candidate = createObserverRecipeTrustManifest(rootSigner, {
    generation: current.manifest.payload.generation + 1,
    issuedAt,
    expiresAt,
    previousManifestHash: current.manifestHash,
    keys,
    revokedKeyIds: [...revoked].sort()
  }, PACKAGED_OBSERVER_RECIPE_ROOT);
  validateObserverRecipeTrustManifest(candidate, PACKAGED_OBSERVER_RECIPE_ROOT, now, current);
}

writeManifest(outputPath, candidate);
process.stdout.write(`${JSON.stringify({
  output: outputPath,
  generation: candidate.payload.generation,
  manifestHash: observerRecipeTrustManifestHash(candidate),
  rootKeyId: candidate.rootKeyId,
  activeIntermediateKeyId: activeIntermediate.keyId,
  revokedKeyCount: candidate.payload.revokedKeyIds.length,
  expiresAt: candidate.payload.expiresAt,
  privateMaterialPrinted: false
}, null, 2)}\n`);
