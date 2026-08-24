import { createHash, createPublicKey, verify } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ObserverRecipeTrustKey,
  ObserverRecipeTrustManifestPayload,
  SignedObserverRecipeEnvelope,
  SignedObserverRecipePayload,
  SignedObserverRecipeTrustManifest
} from "../../contracts/src/index.js";
import { PACKAGED_OBSERVER_RECIPE_ROOT } from "./package-root.js";
import { ObserverRecipeSigner } from "./signer.js";

const MANIFEST_FILE = "observer-recipe-trust-manifest.json";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{80,120}$/;
const SPKI_PATTERN = /^[A-Za-z0-9_-]{40,120}$/;
const MAX_MANIFEST_LIFETIME_MS = 400 * 24 * 60 * 60_000;

export interface ObserverRecipeRootInfo {
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
}

export interface ValidatedObserverRecipeTrustManifest {
  manifest: SignedObserverRecipeTrustManifest;
  manifestHash: string;
  activeKey: ObserverRecipeTrustKey;
}

function historicalValidationTime(value: unknown, now = Date.now()): number {
  const record = value as { payload?: { issuedAt?: unknown; expiresAt?: unknown } } | null;
  const issuedAt = new Date(String(record?.payload?.issuedAt ?? "")).getTime();
  const expiresAt = new Date(String(record?.payload?.expiresAt ?? "")).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt > now) return now;
  return Math.max(issuedAt, expiresAt - 1);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function keyIdForSpki(publicKeySpki: string): string {
  return createHash("sha256").update(Buffer.from(publicKeySpki, "base64url")).digest("hex");
}

export function observerRecipeTrustManifestHash(manifest: SignedObserverRecipeTrustManifest): string {
  return createHash("sha256")
    .update("yoink-observer-recipe-trust-manifest-v1|")
    .update(canonicalJson(manifest))
    .digest("hex");
}

function verifiedRootSignature(
  manifest: SignedObserverRecipeTrustManifest,
  root: ObserverRecipeRootInfo
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(root.publicKeySpki, "base64url"),
      format: "der",
      type: "spki"
    });
    return verify(
      null,
      Buffer.from(canonicalJson(manifest.payload), "utf8"),
      publicKey,
      Buffer.from(manifest.signature, "base64url")
    );
  } catch {
    return false;
  }
}

export function validateObserverRecipeTrustManifest(
  value: unknown,
  root: ObserverRecipeRootInfo = PACKAGED_OBSERVER_RECIPE_ROOT,
  now = Date.now(),
  previous: ValidatedObserverRecipeTrustManifest | null | undefined = undefined
): ValidatedObserverRecipeTrustManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The observer recipe trust manifest envelope is invalid.");
  const manifest = value as SignedObserverRecipeTrustManifest;
  if (!exactKeys(manifest as unknown as Record<string, unknown>, ["algorithm", "rootKeyId", "payload", "signature"])
    || manifest.algorithm !== "Ed25519" || manifest.rootKeyId !== root.keyId
    || !SIGNATURE_PATTERN.test(String(manifest.signature ?? ""))) {
    throw new Error("The observer recipe trust manifest envelope is invalid.");
  }
  const payload = manifest.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !exactKeys(payload as unknown as Record<string, unknown>, [
      "contractVersion", "generation", "rootKeyId", "issuedAt", "expiresAt",
      "previousManifestHash", "keys", "revokedKeyIds"
    ]) || payload.contractVersion !== 1 || payload.rootKeyId !== root.keyId
    || !Number.isSafeInteger(payload.generation) || payload.generation < 1
    || !Array.isArray(payload.keys) || payload.keys.length < 1 || payload.keys.length > 8
    || !Array.isArray(payload.revokedKeyIds) || payload.revokedKeyIds.length > 32) {
    throw new Error("The observer recipe trust manifest payload is invalid.");
  }
  const issuedAt = new Date(payload.issuedAt).getTime();
  const expiresAt = new Date(payload.expiresAt).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + 5 * 60_000
    || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_MANIFEST_LIFETIME_MS) {
    throw new Error("The observer recipe trust manifest lifetime is invalid or expired.");
  }
  const revokedKeyIds = payload.revokedKeyIds.map((keyId) => String(keyId));
  if (new Set(revokedKeyIds).size !== revokedKeyIds.length || revokedKeyIds.some((keyId) => !HASH_PATTERN.test(keyId))) {
    throw new Error("The observer recipe trust revocation set is invalid.");
  }
  const seenKeys = new Set<string>();
  const keys = payload.keys as ObserverRecipeTrustKey[];
  for (const key of keys) {
    if (!key || typeof key !== "object" || Array.isArray(key)
      || !exactKeys(key as unknown as Record<string, unknown>, [
        "algorithm", "keyId", "publicKeySpki", "usage", "status", "notBefore", "notAfter"
      ]) || key.algorithm !== "Ed25519" || key.usage !== "observer_recipe_signing"
      || !["active", "retired"].includes(key.status) || !HASH_PATTERN.test(String(key.keyId ?? ""))
      || !SPKI_PATTERN.test(String(key.publicKeySpki ?? "")) || keyIdForSpki(key.publicKeySpki) !== key.keyId
      || seenKeys.has(key.keyId)) {
      throw new Error("The observer recipe intermediate-key manifest is invalid.");
    }
    seenKeys.add(key.keyId);
    const notBefore = new Date(key.notBefore).getTime();
    const notAfter = new Date(key.notAfter).getTime();
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notBefore > now + 5 * 60_000
      || notAfter <= notBefore) {
      throw new Error("The observer recipe intermediate-key lifetime is invalid.");
    }
  }
  const activeKeys = keys.filter((key) => key.status === "active" && !revokedKeyIds.includes(key.keyId));
  if (activeKeys.length !== 1 || revokedKeyIds.some((keyId) => activeKeys[0]?.keyId === keyId)) {
    throw new Error("The observer recipe trust manifest must identify exactly one unrevoked active intermediate key.");
  }
  const activeNotBefore = new Date(activeKeys[0]?.notBefore ?? "").getTime();
  const activeNotAfter = new Date(activeKeys[0]?.notAfter ?? "").getTime();
  if (activeNotBefore > now + 5 * 60_000 || activeNotAfter <= now || activeNotAfter > expiresAt) {
    throw new Error("The active observer recipe intermediate-key lifetime is invalid.");
  }
  if (!verifiedRootSignature(manifest, root)) throw new Error("The observer recipe trust manifest root signature is invalid.");
  if (previous) {
    if (payload.generation !== previous.manifest.payload.generation + 1
      || payload.previousManifestHash !== previous.manifestHash
      || issuedAt < new Date(previous.manifest.payload.issuedAt).getTime()
      || previous.manifest.payload.revokedKeyIds.some((keyId) => !revokedKeyIds.includes(keyId))) {
      throw new Error("The observer recipe trust manifest is not a monotonic successor.");
    }
    const known = new Set([...keys.map((key) => key.keyId), ...revokedKeyIds]);
    if (previous.manifest.payload.keys.some((key) => !known.has(key.keyId))) {
      throw new Error("The observer recipe trust manifest silently removed a prior key.");
    }
  } else if (previous === null && (payload.generation !== 1 || payload.previousManifestHash !== "")) {
    throw new Error("The first observer recipe trust manifest must start at generation one.");
  } else if (previous === undefined
    && ((payload.generation === 1) !== (payload.previousManifestHash === ""))) {
    throw new Error("The observer recipe trust manifest generation and predecessor are inconsistent.");
  }
  return { manifest, manifestHash: observerRecipeTrustManifestHash(manifest), activeKey: activeKeys[0] as ObserverRecipeTrustKey };
}

export function createObserverRecipeTrustManifest(
  rootSigner: ObserverRecipeSigner,
  input: Omit<ObserverRecipeTrustManifestPayload, "contractVersion" | "rootKeyId">,
  root: ObserverRecipeRootInfo = { algorithm: "Ed25519", keyId: rootSigner.keyId, publicKeySpki: rootSigner.publicKeySpki }
): SignedObserverRecipeTrustManifest {
  if (rootSigner.keyId !== root.keyId || rootSigner.publicKeySpki !== root.publicKeySpki) {
    throw new Error("The offline root signer does not match the packaged root.");
  }
  const payload: ObserverRecipeTrustManifestPayload = {
    contractVersion: 1,
    generation: input.generation,
    rootKeyId: root.keyId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    previousManifestHash: input.previousManifestHash,
    keys: input.keys,
    revokedKeyIds: input.revokedKeyIds
  };
  return {
    algorithm: "Ed25519",
    rootKeyId: root.keyId,
    payload,
    signature: rootSigner.signCanonical(canonicalJson(payload))
  };
}

export class ObserverRecipeTrustAuthority {
  private current: ValidatedObserverRecipeTrustManifest | null;

  private constructor(
    readonly root: ObserverRecipeRootInfo,
    readonly intermediateSigner: ObserverRecipeSigner,
    current: ValidatedObserverRecipeTrustManifest | null,
    private readonly manifestPath: string | null
  ) {
    this.current = current;
  }

  static ephemeral(now = Date.now()): ObserverRecipeTrustAuthority {
    const rootSigner = ObserverRecipeSigner.ephemeral();
    const intermediateSigner = ObserverRecipeSigner.ephemeral();
    const root = { algorithm: "Ed25519" as const, keyId: rootSigner.keyId, publicKeySpki: rootSigner.publicKeySpki };
    const issuedAt = new Date(now - 60_000).toISOString();
    const expiresAt = new Date(now + 365 * 24 * 60 * 60_000).toISOString();
    const manifest = createObserverRecipeTrustManifest(rootSigner, {
      generation: 1,
      issuedAt,
      expiresAt,
      previousManifestHash: "",
      keys: [{
        algorithm: "Ed25519",
        keyId: intermediateSigner.keyId,
        publicKeySpki: intermediateSigner.publicKeySpki,
        usage: "observer_recipe_signing",
        status: "active",
        notBefore: issuedAt,
        notAfter: expiresAt
      }],
      revokedKeyIds: []
    }, root);
    return new ObserverRecipeTrustAuthority(
      root,
      intermediateSigner,
      validateObserverRecipeTrustManifest(manifest, root, now, null),
      null
    );
  }

  static inMemory(
    root: ObserverRecipeRootInfo,
    intermediateSigner: ObserverRecipeSigner,
    manifest: SignedObserverRecipeTrustManifest,
    now = Date.now()
  ): ObserverRecipeTrustAuthority {
    return new ObserverRecipeTrustAuthority(
      root,
      intermediateSigner,
      validateObserverRecipeTrustManifest(manifest, root, now, undefined),
      null
    );
  }

  static persistent(dataDirectory: string): ObserverRecipeTrustAuthority {
    const manifestPath = join(dataDirectory, MANIFEST_FILE);
    let current: ValidatedObserverRecipeTrustManifest | null = null;
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
      current = validateObserverRecipeTrustManifest(
        parsed,
        PACKAGED_OBSERVER_RECIPE_ROOT,
        historicalValidationTime(parsed),
        undefined
      );
      chmodSync(manifestPath, 0o600);
    }
    const signer = current
      ? ObserverRecipeSigner.fromNamed(dataDirectory, current.activeKey.keyId) ?? ObserverRecipeSigner.persistent(dataDirectory)
      : ObserverRecipeSigner.persistent(dataDirectory);
    return new ObserverRecipeTrustAuthority(PACKAGED_OBSERVER_RECIPE_ROOT, signer, current, manifestPath);
  }

  manifest(): ValidatedObserverRecipeTrustManifest | null {
    return this.current;
  }

  ready(now = Date.now()): boolean {
    const current = this.current;
    return Boolean(current
      && current.activeKey.keyId === this.intermediateSigner.keyId
      && current.activeKey.publicKeySpki === this.intermediateSigner.publicKeySpki
      && new Date(current.manifest.payload.expiresAt).getTime() > now
      && new Date(current.activeKey.notAfter).getTime() > now);
  }

  validateSuccessor(value: unknown, now = Date.now()): ValidatedObserverRecipeTrustManifest {
    if (this.current && observerRecipeTrustManifestHash(value as SignedObserverRecipeTrustManifest) === this.current.manifestHash) {
      return this.current;
    }
    return validateObserverRecipeTrustManifest(value, this.root, now, this.current);
  }

  activate(value: unknown, now = Date.now()): ValidatedObserverRecipeTrustManifest {
    const validated = this.validateSuccessor(value, now);
    if (validated.manifestHash === this.current?.manifestHash) return validated;
    if (this.manifestPath) {
      const temporary = `${this.manifestPath}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(validated.manifest, null, 2)}\n`, { mode: 0o600, flag: "w" });
      renameSync(temporary, this.manifestPath);
      chmodSync(this.manifestPath, 0o600);
    }
    this.current = validated;
    return validated;
  }

  envelope(payload: SignedObserverRecipePayload, now = Date.now()): SignedObserverRecipeEnvelope {
    if (!this.ready(now)) throw new Error("Rooted observer recipe signing is unavailable.");
    return this.intermediateSigner.envelope(payload);
  }

  verifyEnvelope(envelope: SignedObserverRecipeEnvelope, now = Date.now()): boolean {
    if (!this.ready(now) || envelope.keyId !== this.current?.activeKey.keyId
      || envelope.publicKeySpki !== this.current.activeKey.publicKeySpki
      || this.current.manifest.payload.revokedKeyIds.includes(envelope.keyId)) return false;
    return this.intermediateSigner.verify(envelope);
  }
}
