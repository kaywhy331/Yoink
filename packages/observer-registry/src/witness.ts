import { createHash, createPublicKey, verify } from "node:crypto";
import type {
  ObserverRecipeWitnessCheckpoint,
  ObserverRecipeWitnessPublishRequest,
  ObserverRecipeWitnessReceiptPayload,
  SignedObserverRecipeWitnessReceipt
} from "../../contracts/src/index.js";
import { OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION } from "../../contracts/src/index.js";
import type { ObserverRecipeSigner } from "./signer.js";
import { canonicalJson } from "./trust.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{80,120}$/;
const SPKI_PATTERN = /^[A-Za-z0-9_-]{40,120}$/;
const LOG_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const MAX_RECEIPT_LIFETIME_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type ObserverRecipeWitnessFailureCode =
  | "unavailable"
  | "invalid_contract"
  | "invalid_signature"
  | "checkpoint_conflict"
  | "chain_conflict"
  | "stale_receipt";

export class ObserverRecipeWitnessError extends Error {
  constructor(
    readonly code: ObserverRecipeWitnessFailureCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ObserverRecipeWitnessError";
  }
}

export interface ObserverRecipeWitnessKey {
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
}

export interface ObserverRecipeWitnessClientOptions {
  endpoint: string;
  logId: string;
  key: ObserverRecipeWitnessKey;
  maxAgeSeconds: number;
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
}

export interface ObserverRecipeWitnessPublisher {
  readonly verifier: ObserverRecipeWitnessVerifier;
  readonly endpointOrigin: string;
  publish(
    checkpoint: ObserverRecipeWitnessCheckpoint,
    previousReceiptHash: string,
    now?: number
  ): Promise<SignedObserverRecipeWitnessReceipt>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function keyIdForSpki(publicKeySpki: string): string {
  try {
    return createHash("sha256").update(Buffer.from(publicKeySpki, "base64url")).digest("hex");
  } catch {
    return "";
  }
}

function validateCheckpointShape(value: unknown): ObserverRecipeWitnessCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ObserverRecipeWitnessError("invalid_contract", "The observer recipe witness checkpoint is invalid.");
  }
  const checkpoint = value as ObserverRecipeWitnessCheckpoint;
  if (!exactKeys(checkpoint as unknown as Record<string, unknown>, [
    "contractVersion", "logId", "rootKeyId", "manifestGeneration", "manifestHash",
    "transparencySequence", "transparencyEventHash"
  ])
    || checkpoint.contractVersion !== OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION
    || !LOG_ID_PATTERN.test(String(checkpoint.logId ?? ""))
    || !HASH_PATTERN.test(String(checkpoint.rootKeyId ?? ""))
    || !Number.isSafeInteger(checkpoint.manifestGeneration) || checkpoint.manifestGeneration < 1
    || !HASH_PATTERN.test(String(checkpoint.manifestHash ?? ""))
    || !Number.isSafeInteger(checkpoint.transparencySequence) || checkpoint.transparencySequence < 1
    || !HASH_PATTERN.test(String(checkpoint.transparencyEventHash ?? ""))) {
    throw new ObserverRecipeWitnessError("invalid_contract", "The observer recipe witness checkpoint is invalid.");
  }
  return checkpoint;
}

export function observerRecipeWitnessCheckpointHash(checkpoint: ObserverRecipeWitnessCheckpoint): string {
  validateCheckpointShape(checkpoint);
  return createHash("sha256")
    .update("yoink-observer-recipe-witness-checkpoint-v1|")
    .update(canonicalJson(checkpoint))
    .digest("hex");
}

export function observerRecipeWitnessScopedLogId(namespace: string, tenantId: string): string {
  if (!LOG_ID_PATTERN.test(namespace) || !/^[A-Za-z0-9_-]{3,120}$/.test(tenantId)) {
    throw new Error("The observer recipe witness namespace or tenant scope is invalid.");
  }
  return `yrw-${createHash("sha256")
    .update("yoink-observer-recipe-witness-log-v1|")
    .update(namespace)
    .update("|")
    .update(tenantId)
    .digest("hex")
    .slice(0, 32)}`;
}

export function observerRecipeWitnessReceiptHash(receipt: SignedObserverRecipeWitnessReceipt): string {
  return createHash("sha256")
    .update("yoink-observer-recipe-witness-receipt-v1|")
    .update(canonicalJson(receipt))
    .digest("hex");
}

export function createObserverRecipeWitnessReceipt(
  signer: Pick<ObserverRecipeSigner, "keyId" | "signCanonical">,
  input: Omit<ObserverRecipeWitnessReceiptPayload, "contractVersion" | "checkpointHash">
): SignedObserverRecipeWitnessReceipt {
  const checkpoint = validateCheckpointShape(input.checkpoint);
  const payload: ObserverRecipeWitnessReceiptPayload = {
    contractVersion: OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION,
    checkpoint,
    checkpointHash: observerRecipeWitnessCheckpointHash(checkpoint),
    witnessSequence: input.witnessSequence,
    previousReceiptHash: input.previousReceiptHash,
    witnessedAt: input.witnessedAt,
    validUntil: input.validUntil
  };
  return {
    algorithm: "Ed25519",
    keyId: signer.keyId,
    payload,
    signature: signer.signCanonical(canonicalJson(payload))
  };
}

export class ObserverRecipeWitnessVerifier {
  readonly logId: string;
  readonly key: ObserverRecipeWitnessKey;
  readonly maxAgeSeconds: number;

  constructor(logId: string, key: ObserverRecipeWitnessKey, maxAgeSeconds: number) {
    if (!LOG_ID_PATTERN.test(logId)) {
      throw new Error("The observer recipe witness log ID must use 3-64 lowercase identifier characters.");
    }
    if (!key || key.algorithm !== "Ed25519" || !HASH_PATTERN.test(String(key.keyId ?? ""))
      || !SPKI_PATTERN.test(String(key.publicKeySpki ?? "")) || keyIdForSpki(key.publicKeySpki) !== key.keyId) {
      throw new Error("The observer recipe witness public key pin is invalid.");
    }
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 60 || maxAgeSeconds > 86_400) {
      throw new Error("The observer recipe witness maximum age must be 60-86400 seconds.");
    }
    this.logId = logId;
    this.key = key;
    this.maxAgeSeconds = maxAgeSeconds;
  }

  validate(
    value: unknown,
    expectedCheckpoint: ObserverRecipeWitnessCheckpoint,
    expectedPreviousReceiptHash: string,
    now = Date.now()
  ): SignedObserverRecipeWitnessReceipt {
    const checkpoint = validateCheckpointShape(expectedCheckpoint);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ObserverRecipeWitnessError("invalid_contract", "The observer recipe witness receipt is invalid.");
    }
    const receipt = value as SignedObserverRecipeWitnessReceipt;
    if (!exactKeys(receipt as unknown as Record<string, unknown>, ["algorithm", "keyId", "payload", "signature"])
      || receipt.algorithm !== "Ed25519" || receipt.keyId !== this.key.keyId
      || !SIGNATURE_PATTERN.test(String(receipt.signature ?? ""))) {
      throw new ObserverRecipeWitnessError("invalid_contract", "The observer recipe witness receipt envelope is invalid.");
    }
    const payload = receipt.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || !exactKeys(payload as unknown as Record<string, unknown>, [
        "contractVersion", "checkpoint", "checkpointHash", "witnessSequence",
        "previousReceiptHash", "witnessedAt", "validUntil"
      ])
      || payload.contractVersion !== OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION
      || !Number.isSafeInteger(payload.witnessSequence) || payload.witnessSequence < 1
      || (!HASH_PATTERN.test(String(payload.previousReceiptHash ?? "")) && payload.previousReceiptHash !== "")
      || !HASH_PATTERN.test(String(payload.checkpointHash ?? ""))) {
      throw new ObserverRecipeWitnessError("invalid_contract", "The observer recipe witness receipt payload is invalid.");
    }
    const receivedCheckpoint = validateCheckpointShape(payload.checkpoint);
    const checkpointHash = observerRecipeWitnessCheckpointHash(receivedCheckpoint);
    if (canonicalJson(receivedCheckpoint) !== canonicalJson(checkpoint)
      || payload.checkpointHash !== checkpointHash) {
      throw new ObserverRecipeWitnessError("checkpoint_conflict", "The witness receipt does not cover the requested observer recipe checkpoint.");
    }
    if (payload.previousReceiptHash !== expectedPreviousReceiptHash) {
      throw new ObserverRecipeWitnessError("chain_conflict", "The observer recipe witness receipt does not extend the pinned witness chain.");
    }
    const witnessedAt = new Date(payload.witnessedAt).getTime();
    const validUntil = new Date(payload.validUntil).getTime();
    if (!Number.isFinite(witnessedAt) || !Number.isFinite(validUntil)
      || witnessedAt > now + CLOCK_SKEW_MS || validUntil <= now || validUntil <= witnessedAt
      || validUntil - witnessedAt > MAX_RECEIPT_LIFETIME_MS) {
      throw new ObserverRecipeWitnessError("stale_receipt", "The observer recipe witness receipt lifetime is invalid or stale.");
    }
    let verified = false;
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(this.key.publicKeySpki, "base64url"),
        format: "der",
        type: "spki"
      });
      verified = verify(
        null,
        Buffer.from(canonicalJson(payload), "utf8"),
        publicKey,
        Buffer.from(receipt.signature, "base64url")
      );
    } catch {
      verified = false;
    }
    if (!verified) {
      throw new ObserverRecipeWitnessError("invalid_signature", "The observer recipe witness signature is invalid.");
    }
    return receipt;
  }

  receiptFresh(receipt: SignedObserverRecipeWitnessReceipt, now = Date.now()): boolean {
    const witnessedAt = new Date(receipt.payload.witnessedAt).getTime();
    const validUntil = new Date(receipt.payload.validUntil).getTime();
    return Number.isFinite(witnessedAt) && Number.isFinite(validUntil)
      && witnessedAt <= now + CLOCK_SKEW_MS
      && witnessedAt + this.maxAgeSeconds * 1_000 > now
      && validUntil > now;
  }
}

export class ObserverRecipeWitnessClient implements ObserverRecipeWitnessPublisher {
  readonly verifier: ObserverRecipeWitnessVerifier;
  readonly endpointOrigin: string;
  private readonly endpoint: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ObserverRecipeWitnessClientOptions) {
    let endpoint: URL;
    try {
      endpoint = new URL(options.endpoint);
    } catch {
      throw new Error("The observer recipe witness endpoint is invalid.");
    }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error("The observer recipe witness endpoint must be an HTTPS URL without credentials, query, or fragment.");
    }
    if (!endpoint.pathname || endpoint.pathname === "/") {
      throw new Error("The observer recipe witness endpoint must include an explicit publish path.");
    }
    const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 500 || requestTimeoutMs > 30_000) {
      throw new Error("The observer recipe witness request timeout must be 500-30000 milliseconds.");
    }
    this.endpoint = endpoint.toString();
    this.endpointOrigin = endpoint.origin;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetchImpl = options.fetch ?? fetch;
    this.verifier = new ObserverRecipeWitnessVerifier(options.logId, options.key, options.maxAgeSeconds);
  }

  async publish(
    checkpoint: ObserverRecipeWitnessCheckpoint,
    previousReceiptHash: string,
    now = Date.now()
  ): Promise<SignedObserverRecipeWitnessReceipt> {
    const checkpointHash = observerRecipeWitnessCheckpointHash(checkpoint);
    const request: ObserverRecipeWitnessPublishRequest = {
      contractVersion: OBSERVER_RECIPE_WITNESS_CONTRACT_VERSION,
      checkpoint,
      checkpointHash,
      previousReceiptHash
    };
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Yoink-Observer-Witness/1"
        },
        body: JSON.stringify(request),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch {
      throw new ObserverRecipeWitnessError("unavailable", "The independent observer recipe witness is unavailable.");
    }
    if (!response.ok) {
      throw new ObserverRecipeWitnessError("unavailable", "The independent observer recipe witness rejected the checkpoint.");
    }
    const contentType = String(response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
    if (contentType !== "application/json") {
      throw new ObserverRecipeWitnessError("invalid_contract", "The independent witness returned an invalid content type.");
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
      throw new ObserverRecipeWitnessError("invalid_contract", "The independent witness response is too large.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ObserverRecipeWitnessError("invalid_contract", "The independent witness returned invalid JSON.");
    }
    const receipt = this.verifier.validate(parsed, checkpoint, previousReceiptHash, now);
    if (!this.verifier.receiptFresh(receipt, now)) {
      throw new ObserverRecipeWitnessError("stale_receipt", "The independent witness returned a receipt outside the configured freshness window.");
    }
    return receipt;
  }
}
