import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type {
  ObserverRecipeTrustKey,
  ObserverRecipeTrustManifestPayload,
  SignedObserverRecipeTrustManifest
} from "../packages/contracts/src/index.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import { PACKAGED_OBSERVER_RECIPE_ROOT } from "../packages/observer-registry/src/package-root.js";
import {
  createObserverRecipeTrustManifest,
  ObserverRecipeTrustAuthority,
  observerRecipeTrustManifestHash,
  validateObserverRecipeTrustManifest,
  type ObserverRecipeRootInfo
} from "../packages/observer-registry/src/trust.js";

const NOW = new Date("2026-08-24T12:00:00.000Z").getTime();

test("the server and extension package pin the same public offline root", () => {
  const asset = readFileSync(join(process.cwd(), "apps", "extension", "observer-recipe-root.js"), "utf8");
  assert.match(asset, new RegExp(PACKAGED_OBSERVER_RECIPE_ROOT.keyId));
  assert.match(asset, new RegExp(PACKAGED_OBSERVER_RECIPE_ROOT.publicKeySpki));
  assert.match(asset, new RegExp(`minimumManifestGeneration: ${PACKAGED_OBSERVER_RECIPE_ROOT.minimumManifestGeneration}`));
  assert.doesNotMatch(asset, /BEGIN PRIVATE KEY|privateKey/);
});

function rootFixture(): { signer: ObserverRecipeSigner; root: ObserverRecipeRootInfo } {
  const signer = ObserverRecipeSigner.ephemeral();
  return {
    signer,
    root: { algorithm: "Ed25519", keyId: signer.keyId, publicKeySpki: signer.publicKeySpki }
  };
}

function trustKey(
  signer: ObserverRecipeSigner,
  status: ObserverRecipeTrustKey["status"],
  issuedAt: string,
  expiresAt: string
): ObserverRecipeTrustKey {
  return {
    algorithm: "Ed25519",
    keyId: signer.keyId,
    publicKeySpki: signer.publicKeySpki,
    usage: "observer_recipe_signing",
    status,
    notBefore: issuedAt,
    notAfter: expiresAt
  };
}

function manifest(
  rootSigner: ObserverRecipeSigner,
  root: ObserverRecipeRootInfo,
  input: Omit<ObserverRecipeTrustManifestPayload, "contractVersion" | "rootKeyId">
): SignedObserverRecipeTrustManifest {
  return createObserverRecipeTrustManifest(rootSigner, input, root);
}

test("offline-root manifests require an exact valid Ed25519 signature and bounded active key", () => {
  const { signer: rootSigner, root } = rootFixture();
  const intermediate = ObserverRecipeSigner.ephemeral();
  const issuedAt = new Date(NOW - 60_000).toISOString();
  const expiresAt = new Date(NOW + 30 * 24 * 60 * 60_000).toISOString();
  const signed = manifest(rootSigner, root, {
    generation: 1,
    issuedAt,
    expiresAt,
    previousManifestHash: "",
    keys: [trustKey(intermediate, "active", issuedAt, expiresAt)],
    revokedKeyIds: []
  });
  const validated = validateObserverRecipeTrustManifest(signed, root, NOW, null);
  assert.equal(validated.activeKey.keyId, intermediate.keyId);
  assert.equal(validated.manifestHash, observerRecipeTrustManifestHash(signed));

  const badSignature = {
    ...signed,
    signature: `${signed.signature.startsWith("A") ? "B" : "A"}${signed.signature.slice(1)}`
  };
  assert.throws(
    () => validateObserverRecipeTrustManifest(badSignature, root, NOW, null),
    /root signature/
  );
  const wrongRoot = rootFixture().root;
  assert.throws(
    () => validateObserverRecipeTrustManifest(signed, wrongRoot, NOW, null),
    /envelope/
  );
});

test("manifest rotation is monotonic, retains prior keys, and cannot undo revocation", () => {
  const { signer: rootSigner, root } = rootFixture();
  const firstSigner = ObserverRecipeSigner.ephemeral();
  const secondSigner = ObserverRecipeSigner.ephemeral();
  const issuedAt = new Date(NOW - 60_000).toISOString();
  const expiresAt = new Date(NOW + 60 * 24 * 60 * 60_000).toISOString();
  const first = manifest(rootSigner, root, {
    generation: 1,
    issuedAt,
    expiresAt,
    previousManifestHash: "",
    keys: [trustKey(firstSigner, "active", issuedAt, expiresAt)],
    revokedKeyIds: []
  });
  const validatedFirst = validateObserverRecipeTrustManifest(first, root, NOW, null);
  const second = manifest(rootSigner, root, {
    generation: 2,
    issuedAt: new Date(NOW).toISOString(),
    expiresAt,
    previousManifestHash: validatedFirst.manifestHash,
    keys: [
      trustKey(firstSigner, "retired", issuedAt, expiresAt),
      trustKey(secondSigner, "active", issuedAt, expiresAt)
    ],
    revokedKeyIds: [firstSigner.keyId]
  });
  const validatedSecond = validateObserverRecipeTrustManifest(second, root, NOW + 1_000, validatedFirst);
  assert.equal(validatedSecond.activeKey.keyId, secondSigner.keyId);

  const skippedGeneration = manifest(rootSigner, root, {
    ...second.payload,
    generation: 3,
    previousManifestHash: validatedFirst.manifestHash
  });
  assert.throws(
    () => validateObserverRecipeTrustManifest(skippedGeneration, root, NOW + 1_000, validatedFirst),
    /monotonic successor/
  );
  const unrevoked = manifest(rootSigner, root, {
    generation: 3,
    issuedAt: new Date(NOW + 2_000).toISOString(),
    expiresAt,
    previousManifestHash: validatedSecond.manifestHash,
    keys: second.payload.keys,
    revokedKeyIds: []
  });
  assert.throws(
    () => validateObserverRecipeTrustManifest(unrevoked, root, NOW + 2_000, validatedSecond),
    /monotonic successor/
  );
});

test("a rotated authority refuses signing until its active intermediate private key matches", () => {
  const { signer: rootSigner, root } = rootFixture();
  const oldSigner = ObserverRecipeSigner.ephemeral();
  const newSigner = ObserverRecipeSigner.ephemeral();
  const issuedAt = new Date(NOW - 60_000).toISOString();
  const expiresAt = new Date(NOW + 30 * 24 * 60 * 60_000).toISOString();
  const signed = manifest(rootSigner, root, {
    generation: 1,
    issuedAt,
    expiresAt,
    previousManifestHash: "",
    keys: [trustKey(newSigner, "active", issuedAt, expiresAt)],
    revokedKeyIds: [oldSigner.keyId]
  });
  const unavailable = ObserverRecipeTrustAuthority.inMemory(root, oldSigner, signed, NOW);
  assert.equal(unavailable.ready(NOW), false);
  const ready = ObserverRecipeTrustAuthority.inMemory(root, newSigner, signed, NOW);
  assert.equal(ready.ready(NOW), true);
});
