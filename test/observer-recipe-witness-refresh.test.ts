import assert from "node:assert/strict";
import test from "node:test";
import type {
  ObserverRecipeWitnessCheckpoint,
  SignedObserverRecipeWitnessReceipt
} from "../packages/contracts/src/index.js";
import {
  ObserverRecipeWitnessRefreshError,
  ObserverRecipeWitnessRefreshService,
  type ObserverRecipeWitnessStatePort
} from "../packages/engine/src/observer-recipe-witness-refresh.js";
import { PACKAGED_OBSERVER_RECIPE_ROOT } from "../packages/observer-registry/src/package-root.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import { ObserverRecipeTrustAuthority } from "../packages/observer-registry/src/trust.js";
import {
  createObserverRecipeWitnessReceipt,
  ObserverRecipeWitnessError,
  ObserverRecipeWitnessVerifier,
  observerRecipeWitnessReceiptHash,
  type ObserverRecipeWitnessFailureCode,
  type ObserverRecipeWitnessPublisher
} from "../packages/observer-registry/src/witness.js";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const CHECKPOINT: ObserverRecipeWitnessCheckpoint = {
  contractVersion: 1,
  logId: "witness-refresh-test",
  rootKeyId: "a".repeat(64),
  manifestGeneration: 3,
  manifestHash: "b".repeat(64),
  transparencySequence: 7,
  transparencyEventHash: "c".repeat(64)
};

class FixtureWitnessState implements ObserverRecipeWitnessStatePort {
  private status: Record<string, unknown>;
  private previousHash = "";
  lastFailure = "";

  constructor(private readonly checkpoint: ObserverRecipeWitnessCheckpoint | null) {
    this.status = {
      state: checkpoint ? "witness_pending" : "awaiting_checkpoint",
      deliveryAllowed: false,
      checkpoint: checkpoint ? { transparencyEventHash: checkpoint.transparencyEventHash } : null,
      latestReceipt: null
    };
  }

  seedReceipt(witnessedAt: number, validUntil: number, sequence = 1): void {
    this.status = {
      state: "healthy",
      deliveryAllowed: true,
      checkpoint: { transparencyEventHash: CHECKPOINT.transparencyEventHash },
      latestReceipt: {
        witnessSequence: sequence,
        transparencyEventHash: CHECKPOINT.transparencyEventHash,
        witnessedAt: new Date(witnessedAt).toISOString(),
        validUntil: new Date(validUntil).toISOString()
      }
    };
  }

  witnessCheckpoint(): ObserverRecipeWitnessCheckpoint | null {
    return this.checkpoint;
  }

  previousWitnessReceiptHash(): string {
    return this.previousHash;
  }

  acceptWitnessReceipt(value: unknown): Record<string, unknown> {
    const receipt = value as SignedObserverRecipeWitnessReceipt;
    this.previousHash = observerRecipeWitnessReceiptHash(receipt);
    this.seedReceipt(
      new Date(receipt.payload.witnessedAt).getTime(),
      new Date(receipt.payload.validUntil).getTime(),
      receipt.payload.witnessSequence
    );
    return this.status;
  }

  recordWitnessFailure(code: ObserverRecipeWitnessFailureCode): Record<string, unknown> {
    this.lastFailure = code;
    this.status = { ...this.status, state: code === "unavailable" ? "degraded" : "inconsistent" };
    return this.status;
  }

  witnessStatus(): Record<string, unknown> {
    return this.status;
  }
}

function publisher(options: { failure?: ObserverRecipeWitnessFailureCode } = {}): {
  value: ObserverRecipeWitnessPublisher;
  calls: () => number;
} {
  const signer = ObserverRecipeSigner.ephemeral();
  const verifier = new ObserverRecipeWitnessVerifier("witness-refresh-test", {
    algorithm: "Ed25519",
    keyId: signer.keyId,
    publicKeySpki: signer.publicKeySpki
  }, 900);
  let calls = 0;
  let sequence = 0;
  return {
    value: {
      verifier,
      endpointOrigin: "https://witness.example.net",
      async publish(checkpoint, previousReceiptHash, now = NOW) {
        calls += 1;
        if (options.failure) {
          throw new ObserverRecipeWitnessError(options.failure, "Fixture witness failure.");
        }
        sequence += 1;
        return createObserverRecipeWitnessReceipt(signer, {
          checkpoint,
          witnessSequence: sequence,
          previousReceiptHash,
          witnessedAt: new Date(now).toISOString(),
          validUntil: new Date(now + 60 * 60_000).toISOString()
        });
      }
    },
    calls: () => calls
  };
}

test("witness refresh publishes a missing receipt and skips a comfortably fresh one", async () => {
  const state = new FixtureWitnessState(CHECKPOINT);
  const remote = publisher();
  const service = new ObserverRecipeWitnessRefreshService(state, remote.value);
  assert.deepEqual(await service.execute(NOW), {
    witnessConfigured: true,
    checkpointReady: true,
    refreshAttempted: true,
    receiptAccepted: true,
    deliveryAllowed: true,
    witnessState: "healthy",
    witnessSequence: 1
  });
  assert.equal(remote.calls(), 1);

  assert.deepEqual(await service.execute(NOW + 60_000), {
    witnessConfigured: true,
    checkpointReady: true,
    refreshAttempted: false,
    receiptAccepted: false,
    deliveryAllowed: true,
    witnessState: "healthy",
    witnessSequence: 1
  });
  assert.equal(remote.calls(), 1);
});

test("witness refresh renews before freshness expiry and treats no checkpoint as a safe no-op", async () => {
  const nearExpiry = new FixtureWitnessState(CHECKPOINT);
  nearExpiry.seedReceipt(NOW - 500_000, NOW + 60 * 60_000);
  const remote = publisher();
  const service = new ObserverRecipeWitnessRefreshService(nearExpiry, remote.value);
  assert.equal((await service.execute(NOW)).refreshAttempted, true);
  assert.equal(remote.calls(), 1);

  const noCheckpoint = new FixtureWitnessState(null);
  const idleRemote = publisher();
  assert.deepEqual(await new ObserverRecipeWitnessRefreshService(noCheckpoint, idleRemote.value).execute(NOW), {
    witnessConfigured: true,
    checkpointReady: false,
    refreshAttempted: false,
    receiptAccepted: false,
    deliveryAllowed: false,
    witnessState: "awaiting_checkpoint",
    witnessSequence: 0
  });
  assert.equal(idleRemote.calls(), 0);
});

test("witness refresh records one bounded failure and surfaces a retryable worker code", async () => {
  const state = new FixtureWitnessState(CHECKPOINT);
  const remote = publisher({ failure: "unavailable" });
  const service = new ObserverRecipeWitnessRefreshService(state, remote.value);
  await assert.rejects(
    service.execute(NOW),
    (error: unknown) => error instanceof ObserverRecipeWitnessRefreshError
      && error.code === "observer_recipe_witness_unavailable"
  );
  assert.equal(state.lastFailure, "unavailable");
  assert.equal(remote.calls(), 1);
});

test("the standalone witness authority exposes only the packaged public root", () => {
  const authority = ObserverRecipeTrustAuthority.witnessVerificationOnly();
  assert.deepEqual(authority.root, PACKAGED_OBSERVER_RECIPE_ROOT);
  assert.equal(authority.manifest(), null);
  assert.equal(authority.ready(NOW), false);
  assert.throws(() => authority.intermediateSigner, /signing is unavailable in verification-only mode/);
});
