import assert from "node:assert/strict";
import test from "node:test";
import type {
  ObserverRecipeWitnessCheckpoint,
  ObserverRecipeWitnessPublishRequest,
  SignedObserverRecipeWitnessReceipt
} from "../packages/contracts/src/index.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import {
  ObserverRecipeWitnessClient,
  ObserverRecipeWitnessError,
  ObserverRecipeWitnessVerifier,
  createObserverRecipeWitnessReceipt,
  observerRecipeWitnessCheckpointHash,
  observerRecipeWitnessReceiptHash,
  observerRecipeWitnessScopedLogId
} from "../packages/observer-registry/src/witness.js";

const NOW = new Date("2026-08-24T20:00:00.000Z").getTime();

function checkpoint(logId = "yoink-production"): ObserverRecipeWitnessCheckpoint {
  return {
    contractVersion: 1,
    logId,
    rootKeyId: "a".repeat(64),
    manifestGeneration: 3,
    manifestHash: "b".repeat(64),
    transparencySequence: 17,
    transparencyEventHash: "c".repeat(64)
  };
}

function receipt(
  signer: ObserverRecipeSigner,
  value = checkpoint(),
  previousReceiptHash = ""
): SignedObserverRecipeWitnessReceipt {
  return createObserverRecipeWitnessReceipt(signer, {
    checkpoint: value,
    witnessSequence: previousReceiptHash ? 2 : 1,
    previousReceiptHash,
    witnessedAt: new Date(NOW - 1_000).toISOString(),
    validUntil: new Date(NOW + 60 * 60_000).toISOString()
  });
}

test("the witness verifier accepts only an exact, fresh, chain-extending Ed25519 checkpoint receipt", () => {
  const signer = ObserverRecipeSigner.ephemeral();
  const verifier = new ObserverRecipeWitnessVerifier("yoink-production", {
    algorithm: "Ed25519",
    keyId: signer.keyId,
    publicKeySpki: signer.publicKeySpki
  }, 600);
  const expected = checkpoint();
  const signed = receipt(signer, expected);
  assert.deepEqual(verifier.validate(signed, expected, "", NOW), signed);
  assert.match(observerRecipeWitnessCheckpointHash(expected), /^[a-f0-9]{64}$/);
  assert.match(observerRecipeWitnessReceiptHash(signed), /^[a-f0-9]{64}$/);
  assert.equal(verifier.receiptFresh(signed, NOW), true);
  assert.equal(verifier.receiptFresh(signed, NOW + 601_000), false);

  const wrongCheckpoint = { ...expected, transparencyEventHash: "d".repeat(64) };
  assert.throws(() => verifier.validate(signed, wrongCheckpoint, "", NOW), (error) =>
    error instanceof ObserverRecipeWitnessError && error.code === "checkpoint_conflict");
  assert.throws(() => verifier.validate(signed, expected, "e".repeat(64), NOW), (error) =>
    error instanceof ObserverRecipeWitnessError && error.code === "chain_conflict");
  const tampered = structuredClone(signed);
  tampered.payload.witnessSequence = 9;
  assert.throws(() => verifier.validate(tampered, expected, "", NOW), (error) =>
    error instanceof ObserverRecipeWitnessError && error.code === "invalid_signature");
  assert.throws(() => verifier.validate(signed, expected, "", NOW + 2 * 60 * 60_000), (error) =>
    error instanceof ObserverRecipeWitnessError && error.code === "stale_receipt");
});

test("witness log namespaces derive stable isolated tenant pseudonyms", () => {
  const first = observerRecipeWitnessScopedLogId("yoink-production", "tenant_alpha");
  assert.equal(first, observerRecipeWitnessScopedLogId("yoink-production", "tenant_alpha"));
  assert.notEqual(first, observerRecipeWitnessScopedLogId("yoink-production", "tenant_beta"));
  assert.notEqual(first, observerRecipeWitnessScopedLogId("yoink-staging", "tenant_alpha"));
  assert.match(first, /^yrw-[a-f0-9]{32}$/);
  assert.equal(first.includes("tenant_alpha"), false);
});

test("the witness client posts only the bounded public checkpoint contract and verifies the response", async () => {
  const signer = ObserverRecipeSigner.ephemeral();
  const requests: ObserverRecipeWitnessPublishRequest[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const observed = JSON.parse(String(init?.body ?? "")) as ObserverRecipeWitnessPublishRequest;
    requests.push(observed);
    const signed = createObserverRecipeWitnessReceipt(signer, {
      checkpoint: observed.checkpoint,
      witnessSequence: 1,
      previousReceiptHash: observed.previousReceiptHash,
      witnessedAt: new Date(NOW - 1_000).toISOString(),
      validUntil: new Date(NOW + 60 * 60_000).toISOString()
    });
    return new Response(JSON.stringify(signed), {
      status: 201,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }) as typeof fetch;
  const client = new ObserverRecipeWitnessClient({
    endpoint: "https://witness.example.net/v1/checkpoints",
    logId: "yoink-production",
    key: { algorithm: "Ed25519", keyId: signer.keyId, publicKeySpki: signer.publicKeySpki },
    maxAgeSeconds: 600,
    fetch: fetchImpl
  });
  const result = await client.publish(checkpoint(), "", NOW);
  assert.equal(result.keyId, signer.keyId);
  const observed = requests[0];
  assert.ok(observed);
  assert.deepEqual(Object.keys(observed).sort(), ["checkpoint", "checkpointHash", "contractVersion", "previousReceiptHash"]);
  assert.equal(observed.checkpointHash, observerRecipeWitnessCheckpointHash(observed.checkpoint));
  assert.equal(JSON.stringify(observed).includes("selector"), false);
  assert.equal(client.endpointOrigin, "https://witness.example.net");
});

test("the witness client fails closed on transport and response-contract errors", async () => {
  const signer = ObserverRecipeSigner.ephemeral();
  const base = {
    endpoint: "https://witness.example.net/v1/checkpoints",
    logId: "yoink-production",
    key: { algorithm: "Ed25519" as const, keyId: signer.keyId, publicKeySpki: signer.publicKeySpki },
    maxAgeSeconds: 600
  };
  const unavailable = new ObserverRecipeWitnessClient({
    ...base,
    fetch: (async () => { throw new Error("private transport detail"); }) as typeof fetch
  });
  await assert.rejects(() => unavailable.publish(checkpoint(), "", NOW), (error) =>
    error instanceof ObserverRecipeWitnessError && error.code === "unavailable");
  const invalid = new ObserverRecipeWitnessClient({
    ...base,
    fetch: (async () => new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    })) as typeof fetch
  });
  await assert.rejects(() => invalid.publish(checkpoint(), "", NOW), (error) =>
    error instanceof ObserverRecipeWitnessError && error.code === "invalid_contract");
});
