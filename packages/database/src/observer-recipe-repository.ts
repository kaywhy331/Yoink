import {
  OBSERVER_RECIPE_CONTRACT_VERSION,
  OBSERVER_RECIPE_FIELDS,
  OBSERVER_RECIPE_MODES,
  RETAILER_OBSERVER_VERSIONS,
  INSTALL_OBSERVER_RECIPE_TRUST_MANIFEST_CONFIRMATION,
  type ObserverRecipeField,
  type ObserverRecipeFieldInput,
  type ObserverRecipePromotionInput,
  type ObserverRecipeProposalInput,
  type ObserverRecipeResignInput,
  type ObserverRecipeState,
  type ObserverRecipeTrialInput,
  type ObserverRecipeTrustManifestInstallInput,
  type ObserverRecipeTrustTransparencyReceipt,
  type ObserverRecipeWitnessCheckpoint,
  type SignedObserverRecipeWitnessReceipt,
  type SignedObserverRecipeEnvelope,
  type SignedObserverRecipeTrustManifest,
  type SignedObserverRecipePayload,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import {
  ObserverRecipeTrustAuthority,
  validateObserverRecipeTrustManifest,
  type ValidatedObserverRecipeTrustManifest
} from "../../observer-registry/src/trust.js";
import {
  ObserverRecipeWitnessError,
  ObserverRecipeWitnessVerifier,
  observerRecipeWitnessCheckpointHash,
  observerRecipeWitnessReceiptHash,
  observerRecipeWitnessScopedLogId,
  type ObserverRecipeWitnessFailureCode
} from "../../observer-registry/src/witness.js";
import { AuditRepository } from "./audit-repository.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const FIELD_NAMES = new Set(OBSERVER_RECIPE_FIELDS);
const MODES = new Set(OBSERVER_RECIPE_MODES);
const ATTRIBUTES = new Set(["aria-label", "content", "data-testid", "data-automation-id"]);
const ACTIVE_STATES = new Set(["shadow", "canary", "trusted_read_only"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{1,39}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const MAX_TRIAL_AGE_MS = 10 * 60_000;
const SKU_PATTERNS: Record<SupportedRetailerId, RegExp> = {
  target: /^\d{6,20}$/,
  walmart: /^\d{5,20}$/,
  amazon: /^[A-Z0-9]{10}$/,
  bestbuy: /^\d{5,20}$/,
  disney: /^\d{10,20}$/,
  ravensburger: /^\d{5,20}$/,
  riot: /^[A-Z0-9](?:[A-Z0-9-]{1,118}[A-Z0-9])?$/,
  booksamillion: /^[A-Z0-9]{10,20}$/,
  fanatics: /^\d{6,20}$/,
  kohls: /^\d{5,12}$/,
  macys: /^\d{5,20}$/,
  pbandai: /^[A-Z]\d{10}$/,
  pokemoncenter: /^\d{2,3}-\d{5}(?:-\d{3})?$/
};

interface RecipeRow {
  id: string;
  retailerId: SupportedRetailerId;
  recipeVersion: string;
  minimumExtensionVersion: string;
  recipeJson: string;
  recipeFingerprint: string;
  lifecycleState: ObserverRecipeState;
  rollbackRecipeId: string;
  killSwitch: number;
  provenanceCode: string;
  signatureKeyId: string;
  signature: string;
  signedAt: string;
  expiresAt: string;
  disabledReason: string;
  trustManifestGeneration: number;
  trustManifestHash: string;
  createdAt: string;
  updatedAt: string;
}

interface TrustManifestRow {
  id: string;
  generation: number;
  rootKeyId: string;
  manifestHash: string;
  previousManifestHash: string;
  payloadJson: string;
  signature: string;
  activeIntermediateKeyId: string;
  revokedKeyIdsJson: string;
  issuedAt: string;
  expiresAt: string;
  installedAt: string;
}

interface TrialSummary {
  passed: number;
  failed: number;
  distinctSkus: number;
  distinctLayouts: number;
}

interface WitnessReceiptRow {
  id: string;
  logId: string;
  witnessKeyId: string;
  witnessSequence: number;
  checkpointHash: string;
  manifestGeneration: number;
  manifestHash: string;
  transparencySequence: number;
  transparencyEventHash: string;
  previousReceiptHash: string;
  receiptHash: string;
  payloadJson: string;
  signature: string;
  witnessedAt: string;
  validUntil: string;
  receivedAt: string;
}

interface WitnessCheckRow {
  outcome: "accepted" | "unavailable" | "invalid" | "conflict" | "stale";
  reasonCode: string;
  checkpointHash: string;
  transparencyEventHash: string;
  receiptHash: string;
  checkedAt: string;
}

export interface ObserverRecipeRepositoryOptions {
  witnessVerifier?: ObserverRecipeWitnessVerifier;
  witnessRequired?: boolean;
  witnessEndpointOrigin?: string;
}

function selector(value: unknown): string {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  const lower = normalized.toLocaleLowerCase("en-US");
  const forbiddenTerms = [
    "password", "passwd", "payment", "credit", "debit", "card-number", "cardnumber",
    "cvv", "cvc", "account", "address", "email", "phone", "cookie", "csrf", "token",
    "authorization", "checkout", "place-order", "submit-order", "buy-now"
  ];
  if (normalized.length < 2 || normalized.length > 160
    || !/^[A-Za-z0-9#.\[\]="' _>+~-]+$/.test(normalized)
    || /[*,():;{}@/\\]/.test(normalized)
    || lower.includes("xpath")
    || forbiddenTerms.some((term) => lower.includes(term))) {
    throw new Error("Observer recipe selectors must use the bounded non-sensitive CSS subset.");
  }
  return normalized;
}

function normalizedFields(value: unknown): Partial<Record<ObserverRecipeField, ObserverRecipeFieldInput>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Observer recipe fields are required.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((field) => !FIELD_NAMES.has(field as ObserverRecipeField))) {
    throw new Error("Observer recipes may contain only packaged read-only commerce fields.");
  }
  const result: Partial<Record<ObserverRecipeField, ObserverRecipeFieldInput>> = {};
  let selectorCount = 0;
  for (const field of OBSERVER_RECIPE_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Each observer recipe field requires a bounded definition.");
    const definition = raw as Record<string, unknown>;
    if (Object.keys(definition).some((key) => !["mode", "selectors", "attribute"].includes(key))
      || !MODES.has(definition.mode as ObserverRecipeFieldInput["mode"])
      || !Array.isArray(definition.selectors)
      || definition.selectors.length < 1
      || definition.selectors.length > 5) {
      throw new Error("Observer recipe field definitions are outside the packaged interpreter schema.");
    }
    const mode = definition.mode as ObserverRecipeFieldInput["mode"];
    const allowedModes: Record<ObserverRecipeField, Set<ObserverRecipeFieldInput["mode"]>> = {
      availability: new Set(["text", "presence", "disabled_state"]),
      unitPrice: new Set(["text", "attribute"]),
      seller: new Set(["text", "attribute"]),
      fulfillment: new Set(["text", "presence"]),
      addControl: new Set(["presence", "disabled_state", "attribute"])
    };
    if (!allowedModes[field].has(mode)) throw new Error("The observer recipe extraction mode is invalid for its field.");
    const candidates = [...new Set(definition.selectors.map(selector))];
    selectorCount += candidates.length;
    if (selectorCount > 25) throw new Error("Observer recipes may contain at most 25 selector candidates.");
    if (mode === "attribute") {
      if (!ATTRIBUTES.has(String(definition.attribute))) throw new Error("Observer recipe attributes are restricted to a fixed safe list.");
      const attribute = definition.attribute as NonNullable<ObserverRecipeFieldInput["attribute"]>;
      result[field] = { mode, selectors: candidates, attribute };
    } else {
      if (definition.attribute !== undefined) throw new Error("Only attribute extraction may declare an attribute name.");
      result[field] = { mode, selectors: candidates };
    }
  }
  if (!Object.keys(result).length) throw new Error("An observer recipe must define at least one read-only field.");
  return result;
}

function parsedFields(value: string): Partial<Record<ObserverRecipeField, ObserverRecipeFieldInput>> {
  return normalizedFields(JSON.parse(value) as unknown);
}

function trialSummary(db: YoinkDatabase, recipeId: string): TrialSummary {
  const row = db.get<{ passed: number; failed: number; distinctSkus: number; distinctLayouts: number }>(
    `SELECT
       SUM(CASE WHEN outcome = 'passed' THEN 1 ELSE 0 END) AS passed,
       SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
       COUNT(DISTINCT CASE WHEN outcome = 'passed' THEN retailer_sku END) AS distinctSkus,
       COUNT(DISTINCT CASE WHEN outcome = 'passed' THEN layout_fingerprint END) AS distinctLayouts
     FROM observer_recipe_trials WHERE recipe_id = ?`,
    recipeId
  );
  return {
    passed: Number(row?.passed ?? 0),
    failed: Number(row?.failed ?? 0),
    distinctSkus: Number(row?.distinctSkus ?? 0),
    distinctLayouts: Number(row?.distinctLayouts ?? 0)
  };
}

function recipeProjection(row: RecipeRow, trials: TrialSummary): Record<string, unknown> {
  return {
    id: row.id,
    retailerId: row.retailerId,
    recipeVersion: row.recipeVersion,
    minimumExtensionVersion: row.minimumExtensionVersion,
    fields: parsedFields(row.recipeJson),
    recipeFingerprint: row.recipeFingerprint,
    lifecycleState: row.lifecycleState,
    rollbackRecipeId: row.rollbackRecipeId,
    killSwitch: row.killSwitch === 1,
    provenanceCode: row.provenanceCode,
    signatureKeyId: row.signatureKeyId,
    trustManifestGeneration: row.trustManifestGeneration,
    trustManifestHash: row.trustManifestHash,
    rootedTrust: row.trustManifestGeneration > 0 && FINGERPRINT_PATTERN.test(row.trustManifestHash),
    signedAt: row.signedAt,
    expiresAt: row.expiresAt,
    disabledReason: row.disabledReason,
    trials,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class ObserverRecipeRepository {
  private readonly audit: AuditRepository;
  private readonly witnessVerifier: ObserverRecipeWitnessVerifier | null;
  private readonly witnessRequired: boolean;
  private readonly witnessEndpointOrigin: string;

  constructor(
    private readonly db: YoinkDatabase,
    private readonly trust: ObserverRecipeTrustAuthority,
    options: ObserverRecipeRepositoryOptions = {}
  ) {
    this.audit = new AuditRepository(db);
    this.witnessVerifier = options.witnessVerifier ?? null;
    this.witnessRequired = options.witnessRequired === true;
    this.witnessEndpointOrigin = String(options.witnessEndpointOrigin ?? "");
  }

  keyInfo(now = Date.now()): Record<string, unknown> {
    const installed = this.currentTrustManifest();
    const authority = this.trust.manifest();
    const ready = this.trust.ready(now) && Boolean(installed && authority
      && installed.generation === authority.manifest.payload.generation
      && installed.manifestHash === authority.manifestHash
      && installed.activeIntermediateKeyId === authority.activeKey.keyId);
    return {
      algorithm: "Ed25519",
      packagePinnedRoot: true,
      rootKeyId: this.trust.root.keyId,
      manifestInstalled: Boolean(installed),
      generation: installed?.generation ?? 0,
      manifestHash: installed?.manifestHash ?? "",
      previousManifestHash: installed?.previousManifestHash ?? "",
      keyId: ready ? authority?.activeKey.keyId ?? "" : "",
      publicKeySpki: ready ? authority?.activeKey.publicKeySpki ?? "" : "",
      revokedKeyCount: installed ? this.parsedRevocations(installed).length : 0,
      expiresAt: installed?.expiresAt ?? "",
      signingReady: ready,
      mutationCapable: false
    };
  }

  installTrustManifest(input: ObserverRecipeTrustManifestInstallInput, now = Date.now()): Record<string, unknown> {
    if (!input || !input.manifest || input.confirmation !== INSTALL_OBSERVER_RECIPE_TRUST_MANIFEST_CONFIRMATION) {
      throw new Error("Explicit rooted observer recipe trust-manifest installation is required.");
    }
    const scope = currentRequestScope();
    const currentRow = this.currentTrustManifest();
    const standalone = validateObserverRecipeTrustManifest(input.manifest, this.trust.root, now, undefined);
    if (currentRow && standalone.manifestHash === currentRow.manifestHash) {
      const installed = this.validatedManifestFromRow(currentRow, now);
      if (installed.manifestHash !== standalone.manifestHash) {
        throw new Error("The installed observer recipe trust receipt conflicts with the signed manifest.");
      }
      const authorityCandidate = this.trust.validateSuccessor(input.manifest, now);
      if (authorityCandidate.manifestHash !== installed.manifestHash) {
        throw new Error("The online observer recipe authority rejected the installed trust manifest.");
      }
      this.trust.activate(input.manifest, now);
      return this.trustStatus(now);
    }
    const previousValidationTime = currentRow
      ? Math.min(now, Math.max(new Date(currentRow.issuedAt).getTime(), new Date(currentRow.expiresAt).getTime() - 1))
      : now;
    const previous = currentRow ? this.validatedManifestFromRow(currentRow, previousValidationTime) : null;
    const validated = validateObserverRecipeTrustManifest(input.manifest, this.trust.root, now, previous);
    const authorityCandidate = this.trust.validateSuccessor(input.manifest, now);
    if (authorityCandidate.manifestHash !== validated.manifestHash) {
      throw new Error("The online observer recipe authority rejected the trust manifest.");
    }
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO observer_recipe_trust_manifests(
           id, tenant_id, generation, root_key_id, manifest_hash, previous_manifest_hash,
           payload_json, signature, active_intermediate_key_id, revoked_key_ids_json,
           issued_at, expires_at, installed_by_actor_id, installed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId("observer_recipe_trust"),
        scope.tenantId,
        validated.manifest.payload.generation,
        validated.manifest.rootKeyId,
        validated.manifestHash,
        validated.manifest.payload.previousManifestHash,
        JSON.stringify(validated.manifest.payload),
        validated.manifest.signature,
        validated.activeKey.keyId,
        JSON.stringify(validated.manifest.payload.revokedKeyIds),
        validated.manifest.payload.issuedAt,
        validated.manifest.payload.expiresAt,
        scope.actorId,
        timestamp
      );
      this.transparency("manifest_installed", validated, validated.manifestHash, validated.activeKey.keyId, now);
      this.audit.record({
        correlationId: validated.manifestHash,
        aggregateType: "observer_recipe_trust_manifest",
        eventType: "observer_recipe_trust_manifest_installed",
        reasonCode: validated.manifest.payload.revokedKeyIds.length ? "rooted_manifest_with_revocations" : "rooted_manifest_installed",
        message: "A root-signed monotonic observer recipe trust manifest was installed.",
        data: {
          generation: validated.manifest.payload.generation,
          manifestHash: validated.manifestHash,
          rootKeyId: validated.manifest.rootKeyId,
          activeIntermediateKeyId: validated.activeKey.keyId,
          revokedKeyCount: validated.manifest.payload.revokedKeyIds.length,
          mutationCapable: false
        }
      }, now);
      this.trust.activate(input.manifest, now);
    });
    return this.trustStatus(now);
  }

  trustStatus(now = Date.now()): Record<string, unknown> {
    return {
      ...this.keyInfo(now),
      witness: this.witnessStatus(now),
      transparency: this.transparencyEvents(100),
      manifests: this.trustManifests(50)
    };
  }

  witnessCheckpoint(): ObserverRecipeWitnessCheckpoint | null {
    if (!this.witnessVerifier) return null;
    const installed = this.currentTrustManifest();
    const authority = this.trust.manifest();
    if (!installed || !authority
      || installed.rootKeyId !== this.trust.root.keyId
      || installed.generation !== authority.manifest.payload.generation
      || installed.manifestHash !== authority.manifestHash) return null;
    const event = this.latestTransparencyEvent();
    if (!event || event.manifestGeneration !== installed.generation
      || event.manifestHash !== installed.manifestHash) return null;
    return {
      contractVersion: 1,
      logId: this.witnessLogId(),
      rootKeyId: this.trust.root.keyId,
      manifestGeneration: event.manifestGeneration,
      manifestHash: event.manifestHash,
      transparencySequence: event.sequence,
      transparencyEventHash: event.eventHash
    };
  }

  previousWitnessReceiptHash(): string {
    return this.latestWitnessReceipt()?.receiptHash ?? "";
  }

  acceptWitnessReceipt(value: unknown, now = Date.now()): Record<string, unknown> {
    const verifier = this.witnessVerifier;
    const checkpoint = this.witnessCheckpoint();
    if (!verifier || !checkpoint) {
      throw new ObserverRecipeWitnessError("checkpoint_conflict", "No configured observer recipe checkpoint is available to witness.");
    }
    const prior = this.latestWitnessReceipt();
    const candidateHash = value && typeof value === "object" && !Array.isArray(value)
      ? observerRecipeWitnessReceiptHash(value as SignedObserverRecipeWitnessReceipt)
      : "";
    const existing = this.db.get<{ receiptHash: string }>(
      `SELECT receipt_hash AS receiptHash FROM observer_recipe_witness_receipts
       WHERE tenant_id = ? AND receipt_hash = ?`,
      currentRequestScope().tenantId,
      candidateHash
    );
    if (existing) return this.witnessStatus(now);
    const receipt = verifier.validate(value, checkpoint, prior?.receiptHash ?? "", now);
    if (!verifier.receiptFresh(receipt, now)) {
      throw new ObserverRecipeWitnessError("stale_receipt", "The observer recipe witness receipt is outside the configured freshness window.");
    }
    const receiptHash = observerRecipeWitnessReceiptHash(receipt);
    const expectedSequence = Number(prior?.witnessSequence ?? 0) + 1;
    if (receipt.payload.witnessSequence !== expectedSequence) {
      throw new ObserverRecipeWitnessError("chain_conflict", "The observer recipe witness sequence does not extend the pinned witness chain.");
    }
    const scope = currentRequestScope();
    const receivedAt = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO observer_recipe_witness_receipts(
           id, tenant_id, log_id, witness_key_id, witness_sequence,
           checkpoint_hash, manifest_generation, manifest_hash,
           transparency_sequence, transparency_event_hash, previous_receipt_hash,
           receipt_hash, payload_json, signature, witnessed_at, valid_until, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId("observer_recipe_witness_receipt"),
        scope.tenantId,
        this.witnessLogId(),
        receipt.keyId,
        receipt.payload.witnessSequence,
        receipt.payload.checkpointHash,
        receipt.payload.checkpoint.manifestGeneration,
        receipt.payload.checkpoint.manifestHash,
        receipt.payload.checkpoint.transparencySequence,
        receipt.payload.checkpoint.transparencyEventHash,
        receipt.payload.previousReceiptHash,
        receiptHash,
        JSON.stringify(receipt.payload),
        receipt.signature,
        receipt.payload.witnessedAt,
        receipt.payload.validUntil,
        receivedAt
      );
      this.recordWitnessCheck(
        "accepted",
        "witness_receipt_accepted",
        receipt.payload.checkpointHash,
        receipt.payload.checkpoint.transparencyEventHash,
        receiptHash,
        now
      );
      this.audit.record({
        correlationId: receiptHash,
        aggregateType: "observer_recipe_witness",
        eventType: "observer_recipe_checkpoint_witnessed",
        reasonCode: "independent_signature_verified",
        message: "An independently signed observer recipe transparency checkpoint was verified and pinned.",
        data: {
          logId: this.witnessLogId(),
          witnessKeyId: receipt.keyId,
          witnessSequence: receipt.payload.witnessSequence,
          checkpointHash: receipt.payload.checkpointHash,
          transparencySequence: receipt.payload.checkpoint.transparencySequence,
          transparencyEventHash: receipt.payload.checkpoint.transparencyEventHash,
          validUntil: receipt.payload.validUntil,
          privacyClassification: "public_cryptographic_metadata",
          mutationCapable: false
        }
      }, now);
    });
    return this.witnessStatus(now);
  }

  recordWitnessFailure(code: ObserverRecipeWitnessFailureCode, now = Date.now()): Record<string, unknown> {
    const checkpoint = this.witnessCheckpoint();
    const outcome: WitnessCheckRow["outcome"] = code === "unavailable"
      ? "unavailable"
      : code === "stale_receipt" ? "stale"
        : ["checkpoint_conflict", "chain_conflict"].includes(code) ? "conflict" : "invalid";
    const checkpointHash = checkpoint ? observerRecipeWitnessCheckpointHash(checkpoint) : "";
    const eventHash = checkpoint?.transparencyEventHash ?? "";
    this.db.transaction(() => {
      this.recordWitnessCheck(outcome, `witness_${code}`, checkpointHash, eventHash, "", now);
      this.audit.record({
        correlationId: checkpointHash || "observer_recipe_witness",
        aggregateType: "observer_recipe_witness",
        eventType: "observer_recipe_witness_check_failed",
        reasonCode: `witness_${code}`,
        message: "The observer recipe witness check failed closed.",
        data: {
          logId: this.witnessLogId(),
          checkpointHash,
          transparencyEventHash: eventHash,
          outcome,
          privacyClassification: "public_cryptographic_metadata",
          distributionAllowed: false,
          mutationCapable: false
        }
      }, now);
    });
    return this.witnessStatus(now);
  }

  witnessStatus(now = Date.now()): Record<string, unknown> {
    const verifier = this.witnessVerifier;
    const counts = this.witnessCounts();
    if (!verifier) {
      return {
        required: this.witnessRequired,
        configured: false,
        enforcement: this.witnessRequired ? "required" : "disabled",
        state: this.witnessRequired ? "configuration_missing" : "disabled",
        healthy: false,
        deliveryAllowed: !this.witnessRequired,
        alarmCode: this.witnessRequired ? "observer_recipe_witness_configuration_missing" : "",
        mutationCapable: false,
        ...counts
      };
    }
    const checkpoint = this.witnessCheckpoint();
    const latest = this.latestWitnessReceipt();
    const matching = checkpoint ? this.receiptForCheckpoint(checkpoint.transparencyEventHash) : undefined;
    const latestCheck = this.latestWitnessCheck();
    let state = "awaiting_checkpoint";
    let healthy = false;
    let alarmCode = "observer_recipe_witness_checkpoint_missing";
    if (checkpoint && !matching) {
      state = "witness_pending";
      alarmCode = latestCheck && latestCheck.outcome !== "accepted"
        ? `observer_recipe_witness_${latestCheck.outcome}`
        : "observer_recipe_witness_receipt_missing";
    } else if (checkpoint && matching) {
      const envelope = this.witnessReceiptFromRow(matching);
      if (!envelope) {
        state = "inconsistent";
        alarmCode = "observer_recipe_witness_receipt_corrupt";
      } else {
        const historicalNow = Math.min(
          now,
          Math.max(new Date(envelope.payload.witnessedAt).getTime(), new Date(envelope.payload.validUntil).getTime() - 1)
        );
        try {
          verifier.validate(envelope, checkpoint, envelope.payload.previousReceiptHash, historicalNow);
          if (verifier.receiptFresh(envelope, now)) {
            const failedOutcome = latestCheck && latestCheck.outcome !== "accepted"
              && new Date(latestCheck.checkedAt).getTime() > new Date(matching.receivedAt).getTime()
              ? latestCheck.outcome : "";
            state = failedOutcome ? "degraded" : "healthy";
            healthy = true;
            alarmCode = failedOutcome ? `observer_recipe_witness_${failedOutcome}` : "";
          } else {
            state = "stale";
            alarmCode = "observer_recipe_witness_receipt_stale";
          }
        } catch {
          state = "inconsistent";
          alarmCode = "observer_recipe_witness_receipt_invalid";
        }
      }
    }
    return {
      required: this.witnessRequired,
      configured: true,
      enforcement: this.witnessRequired ? "required" : "advisory",
      endpointOrigin: this.witnessEndpointOrigin,
      logId: this.witnessLogId(),
      witnessKeyId: verifier.key.keyId,
      maxAgeSeconds: verifier.maxAgeSeconds,
      state,
      healthy,
      deliveryAllowed: !this.witnessRequired || healthy,
      alarmCode,
      checkpoint: checkpoint ? {
        manifestGeneration: checkpoint.manifestGeneration,
        manifestHash: checkpoint.manifestHash,
        transparencySequence: checkpoint.transparencySequence,
        transparencyEventHash: checkpoint.transparencyEventHash,
        checkpointHash: observerRecipeWitnessCheckpointHash(checkpoint)
      } : null,
      latestReceipt: latest ? {
        witnessSequence: latest.witnessSequence,
        checkpointHash: latest.checkpointHash,
        transparencySequence: latest.transparencySequence,
        transparencyEventHash: latest.transparencyEventHash,
        receiptHash: latest.receiptHash,
        witnessedAt: latest.witnessedAt,
        validUntil: latest.validUntil,
        receivedAt: latest.receivedAt,
        privacyClassification: "public_cryptographic_metadata"
      } : null,
      latestCheck: latestCheck ? {
        outcome: latestCheck.outcome,
        reasonCode: latestCheck.reasonCode,
        checkpointHash: latestCheck.checkpointHash,
        transparencyEventHash: latestCheck.transparencyEventHash,
        receiptHash: latestCheck.receiptHash,
        checkedAt: latestCheck.checkedAt
      } : null,
      mutationCapable: false,
      ...counts
    };
  }

  trustBundle(now = Date.now()): Record<string, unknown> | null {
    const row = this.currentTrustManifest();
    const authority = this.trust.manifest();
    if (!row || !authority || !this.trust.ready(now)
      || row.manifestHash !== authority.manifestHash
      || row.generation !== authority.manifest.payload.generation) return null;
    const receipt = this.db.get<ObserverRecipeTrustTransparencyReceipt>(
      `SELECT sequence, event_type AS eventType, manifest_generation AS manifestGeneration,
              manifest_hash AS manifestHash, signing_key_id AS signingKeyId,
              subject_hash AS subjectHash, previous_event_hash AS previousEventHash,
              event_hash AS eventHash, created_at AS createdAt
       FROM observer_recipe_transparency_events
       WHERE tenant_id = ? AND event_type = 'manifest_installed' AND manifest_hash = ?
       ORDER BY sequence DESC LIMIT 1`,
      currentRequestScope().tenantId,
      row.manifestHash
    );
    return {
      contractVersion: 1,
      rootKeyId: this.trust.root.keyId,
      manifestHash: row.manifestHash,
      manifest: authority.manifest,
      manifestChain: this.trustManifestChain(),
      transparencyReceipt: receipt ?? null
    };
  }

  propose(input: ObserverRecipeProposalInput, now = Date.now()): Record<string, unknown> {
    if (!input || typeof input !== "object" || input.contractVersion !== OBSERVER_RECIPE_CONTRACT_VERSION
      || input.confirmation !== "PROPOSE_OBSERVER_ONLY_RECIPE"
      || !Object.hasOwn(RETAILER_OBSERVER_VERSIONS, input.retailerId)) {
      throw new Error("An explicitly confirmed observer-only recipe proposal is required.");
    }
    const recipeVersion = cleanText(input.recipeVersion, 40).toLocaleLowerCase("en-US");
    const minimumExtensionVersion = cleanText(input.minimumExtensionVersion, 40);
    const provenanceCode = cleanText(input.provenanceCode, 80).toLocaleLowerCase("en-US");
    if (!VERSION_PATTERN.test(recipeVersion) || !SEMVER_PATTERN.test(minimumExtensionVersion)
      || !REASON_PATTERN.test(provenanceCode)) {
      throw new Error("Observer recipe versions and provenance must use bounded version/reason formats.");
    }
    const expires = new Date(input.expiresAt).getTime();
    if (!Number.isFinite(expires) || expires < now + 60 * 60_000 || expires > now + 30 * 24 * 60 * 60_000) {
      throw new Error("Observer recipes must expire between one hour and 30 days from proposal time.");
    }
    const fields = normalizedFields(input.fields);
    const recipeJson = JSON.stringify(fields);
    const rollbackRecipeId = cleanText(input.rollbackRecipeId, 120);
    if (rollbackRecipeId && !ID_PATTERN.test(rollbackRecipeId)) throw new Error("The observer recipe rollback ID is invalid.");
    if (rollbackRecipeId) {
      const rollback = this.row(rollbackRecipeId);
      if (!rollback || rollback.retailerId !== input.retailerId || rollback.lifecycleState === "disabled") {
        throw new Error("The rollback observer recipe must be an existing active recipe for the same retailer.");
      }
    }
    const timestamp = nowIso(now);
    const id = newId("observer_recipe");
    const fingerprint = stableHash(
      "declarative-observer-recipe-v1",
      input.retailerId,
      recipeVersion,
      minimumExtensionVersion,
      recipeJson
    );
    return this.db.transaction(() => {
      this.db.run(
        `INSERT INTO observer_recipe_candidates(
           id, tenant_id, user_id, retailer_id, recipe_version,
           minimum_extension_version, recipe_json, recipe_fingerprint,
           lifecycle_state, rollback_recipe_id, kill_switch,
           provenance_code, signature_key_id, signature, signed_at,
           expires_at, disabled_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quarantined', ?, 0, ?, '', '', '', ?, '', ?, ?)`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        input.retailerId,
        recipeVersion,
        minimumExtensionVersion,
        recipeJson,
        fingerprint,
        rollbackRecipeId,
        provenanceCode,
        new Date(expires).toISOString(),
        timestamp,
        timestamp
      );
      this.lifecycle(id, "", "quarantined", "structurally_validated_proposal", now);
      this.audit.record({
        correlationId: id,
        aggregateType: "observer_recipe",
        eventType: "observer_recipe_proposed",
        reasonCode: "quarantined",
        message: "A structurally valid observer-only recipe was quarantined for maintainer review.",
        data: { retailerId: input.retailerId, recipeVersion, fingerprint }
      }, now);
      return this.requireProjection(id);
    });
  }

  promote(id: string, input: ObserverRecipePromotionInput, now = Date.now()): Record<string, unknown> {
    const recipeId = cleanText(id, 120);
    if (!ID_PATTERN.test(recipeId) || !input || input.confirmation !== "PROMOTE_SIGNED_OBSERVER_RECIPE"
      || !["shadow", "canary", "trusted_read_only"].includes(input.targetState)) {
      throw new Error("An explicit observer recipe promotion is required.");
    }
    const row = this.row(recipeId);
    if (!row || row.killSwitch === 1 || row.lifecycleState === "disabled") throw new Error("The observer recipe is unavailable for promotion.");
    if (new Date(row.expiresAt).getTime() <= now) throw new Error("Expired observer recipes cannot be promoted.");
    const expected = row.lifecycleState === "quarantined" ? "shadow"
      : row.lifecycleState === "shadow" ? "canary"
        : row.lifecycleState === "canary" ? "trusted_read_only" : "";
    if (input.targetState !== expected) throw new Error("Observer recipes must advance through quarantine, shadow, canary, and trusted-read-only in order.");
    const trials = trialSummary(this.db, recipeId);
    if (input.targetState === "canary" && (trials.failed > 0 || trials.passed < 2 || trials.distinctSkus < 2)) {
      throw new Error("Canary promotion requires two passing shadow trials on two exact SKUs and no failures.");
    }
    if (input.targetState === "trusted_read_only"
      && (trials.failed > 0 || trials.passed < 5 || trials.distinctSkus < 3 || trials.distinctLayouts < 2)) {
      throw new Error("Trusted read-only promotion requires five passing trials, three exact SKUs, two layouts, and no failures.");
    }
    const rootedTrust = this.requireRootedTrust(now);
    const signedAt = nowIso(now);
    const payload = this.payload(row, input.targetState, signedAt);
    const envelope = this.trust.envelope(payload, now);
    return this.db.transaction(() => {
      this.db.run(
        `UPDATE observer_recipe_candidates SET lifecycle_state = ?, signature_key_id = ?,
           signature = ?, signed_at = ?, trust_manifest_generation = ?, trust_manifest_hash = ?,
           updated_at = ? WHERE id = ?`,
        input.targetState,
        envelope.keyId,
        envelope.signature,
        signedAt,
        rootedTrust.manifest.payload.generation,
        rootedTrust.manifestHash,
        signedAt,
        recipeId
      );
      this.transparency("recipe_signed", rootedTrust, row.recipeFingerprint, envelope.keyId, now);
      this.lifecycle(recipeId, row.lifecycleState, input.targetState, "explicit_maintainer_promotion", now);
      this.audit.record({
        correlationId: recipeId,
        aggregateType: "observer_recipe",
        eventType: "observer_recipe_promoted",
        reasonCode: input.targetState,
        message: "A signed observer-only recipe advanced one reviewed lifecycle stage.",
        data: { retailerId: row.retailerId, recipeVersion: row.recipeVersion, targetState: input.targetState, trials }
      }, now);
      return this.requireProjection(recipeId);
    });
  }

  resign(id: string, input: ObserverRecipeResignInput, now = Date.now()): Record<string, unknown> {
    const recipeId = cleanText(id, 120);
    if (!ID_PATTERN.test(recipeId) || !input || input.confirmation !== "RESIGN_ROOTED_OBSERVER_RECIPE") {
      throw new Error("Explicit rooted observer recipe re-signing is required.");
    }
    const row = this.row(recipeId);
    if (!row || !ACTIVE_STATES.has(row.lifecycleState) || row.killSwitch === 1
      || new Date(row.expiresAt).getTime() <= now) {
      throw new Error("Only an unexpired reviewed observer recipe may be re-signed.");
    }
    const rootedTrust = this.requireRootedTrust(now);
    const signedAt = nowIso(now);
    const payload = this.payload(row, row.lifecycleState as SignedObserverRecipePayload["state"], signedAt);
    const envelope = this.trust.envelope(payload, now);
    return this.db.transaction(() => {
      this.db.run(
        `UPDATE observer_recipe_candidates SET signature_key_id = ?, signature = ?, signed_at = ?,
           trust_manifest_generation = ?, trust_manifest_hash = ?, updated_at = ? WHERE id = ?`,
        envelope.keyId,
        envelope.signature,
        signedAt,
        rootedTrust.manifest.payload.generation,
        rootedTrust.manifestHash,
        signedAt,
        recipeId
      );
      this.transparency("recipe_signed", rootedTrust, row.recipeFingerprint, envelope.keyId, now);
      this.audit.record({
        correlationId: recipeId,
        aggregateType: "observer_recipe",
        eventType: "observer_recipe_resigned",
        reasonCode: "rooted_trust_rotation",
        message: "A previously reviewed observer-only recipe was explicitly re-signed under the current rooted intermediate.",
        data: {
          retailerId: row.retailerId,
          recipeVersion: row.recipeVersion,
          lifecycleState: row.lifecycleState,
          manifestGeneration: rootedTrust.manifest.payload.generation,
          manifestHash: rootedTrust.manifestHash,
          mutationCapable: false
        }
      }, now);
      return this.requireProjection(recipeId);
    });
  }

  recordTrial(deviceId: string, input: ObserverRecipeTrialInput, now = Date.now()): Record<string, unknown> {
    const cleanDeviceId = cleanText(deviceId, 120);
    if (!input || typeof input !== "object" || input.contractVersion !== OBSERVER_RECIPE_CONTRACT_VERSION
      || !Object.hasOwn(RETAILER_OBSERVER_VERSIONS, input.retailerId)
      || !["passed", "failed"].includes(input.outcome)) {
      throw new Error("A valid observer recipe trial is required.");
    }
    const device = this.db.get<{ capabilitiesJson: string }>(
      `SELECT capabilities_json AS capabilitiesJson FROM extension_devices
       WHERE id = ? AND user_id = ? AND status = 'active'`,
      cleanDeviceId,
      currentRequestScope().userId
    );
    let capabilities: Record<string, unknown> = {};
    try { capabilities = JSON.parse(device?.capabilitiesJson ?? "{}") as Record<string, unknown>; } catch { capabilities = {}; }
    if (!device || capabilities.observerRecipeShadow !== true) throw new Error("Upgrade the paired Chrome companion before running recipe trials.");
    const recipe = this.row(cleanText(input.recipeId, 120));
    if (!recipe || !ACTIVE_STATES.has(recipe.lifecycleState) || recipe.killSwitch === 1
      || recipe.retailerId !== input.retailerId || recipe.recipeVersion !== input.recipeVersion
      || !this.envelope(recipe, now) || new Date(recipe.expiresAt).getTime() <= now) {
      throw new Error("The signed observer recipe is unavailable or does not match this trial.");
    }
    const retailerSku = cleanText(input.retailerSku, 64).toLocaleUpperCase("en-US");
    const observedTime = new Date(input.observedAt).getTime();
    const evaluated = Number(input.evaluatedFieldCount);
    const agreed = Number(input.agreedFieldCount);
    const ambiguous = Number(input.ambiguousFieldCount);
    if (!SKU_PATTERNS[input.retailerId].test(retailerSku)
      || input.observerVersion !== RETAILER_OBSERVER_VERSIONS[input.retailerId]
      || !FINGERPRINT_PATTERN.test(input.layoutFingerprint)
      || !Number.isFinite(observedTime) || observedTime > now + 5 * 60_000 || now - observedTime > MAX_TRIAL_AGE_MS
      || ![evaluated, agreed, ambiguous].every((value) => Number.isInteger(value) && value >= 0 && value <= 5)
      || evaluated < 1 || agreed + ambiguous > evaluated
      || (input.outcome === "passed" && (agreed !== evaluated || ambiguous !== 0))) {
      throw new Error("Observer recipe trial evidence is malformed or inconsistent.");
    }
    const id = newId("observer_recipe_trial");
    const receivedAt = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT OR IGNORE INTO observer_recipe_trials(
           id, tenant_id, user_id, device_id, recipe_id, retailer_id,
           retailer_sku, observer_version, layout_fingerprint, outcome,
           evaluated_field_count, agreed_field_count, ambiguous_field_count,
           observed_at, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        cleanDeviceId,
        recipe.id,
        input.retailerId,
        retailerSku,
        input.observerVersion,
        input.layoutFingerprint,
        input.outcome,
        evaluated,
        agreed,
        ambiguous,
        new Date(observedTime).toISOString(),
        receivedAt
      );
    });
    return { id, recipeId: recipe.id, retailerId: input.retailerId, retailerSku, outcome: input.outcome, receivedAt };
  }

  disable(id: string, reason = "maintainer_kill_switch", now = Date.now()): Record<string, unknown> {
    const recipeId = cleanText(id, 120);
    const reasonCode = cleanText(reason, 80).toLocaleLowerCase("en-US");
    if (!ID_PATTERN.test(recipeId) || !REASON_PATTERN.test(reasonCode)) throw new Error("A valid observer recipe and kill-switch reason are required.");
    const row = this.row(recipeId);
    if (!row) throw new Error("The observer recipe was not found.");
    if (row.lifecycleState === "disabled") return this.requireProjection(recipeId);
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      this.db.run(
        `UPDATE observer_recipe_candidates SET lifecycle_state = 'disabled', kill_switch = 1,
           disabled_reason = ?, signature = '', signed_at = '', updated_at = ? WHERE id = ?`,
        reasonCode,
        timestamp,
        recipeId
      );
      this.lifecycle(recipeId, row.lifecycleState, "disabled", reasonCode, now);
      this.audit.record({
        correlationId: recipeId,
        aggregateType: "observer_recipe",
        eventType: "observer_recipe_disabled",
        reasonCode,
        message: "The observer recipe kill switch was activated; bundled observers remain available.",
        data: { retailerId: row.retailerId, recipeVersion: row.recipeVersion }
      }, now);
      return this.requireProjection(recipeId);
    });
  }

  rollback(id: string, now = Date.now()): { disabled: Record<string, unknown>; active: SignedObserverRecipeEnvelope } {
    const row = this.row(cleanText(id, 120));
    if (!row || !row.rollbackRecipeId) throw new Error("This observer recipe has no reviewed rollback target.");
    const rollback = this.row(row.rollbackRecipeId);
    if (!rollback || rollback.retailerId !== row.retailerId || !ACTIVE_STATES.has(rollback.lifecycleState)
      || rollback.killSwitch === 1 || new Date(rollback.expiresAt).getTime() <= now) {
      throw new Error("The observer recipe rollback target is unavailable.");
    }
    const disabled = this.disable(row.id, "explicit_rollback", now);
    const active = this.envelope(rollback, now);
    if (!active) throw new Error("The rollback observer recipe signature could not be verified.");
    return { disabled, active };
  }

  active(retailerId: SupportedRetailerId, now = Date.now()): SignedObserverRecipeEnvelope | null {
    if (!Object.hasOwn(RETAILER_OBSERVER_VERSIONS, retailerId)) throw new Error("The observer recipe retailer is unsupported.");
    const rows = this.db.all<RecipeRow>(
      `SELECT id, retailer_id AS retailerId, recipe_version AS recipeVersion,
              minimum_extension_version AS minimumExtensionVersion,
              recipe_json AS recipeJson, recipe_fingerprint AS recipeFingerprint,
              lifecycle_state AS lifecycleState, rollback_recipe_id AS rollbackRecipeId,
              kill_switch AS killSwitch, provenance_code AS provenanceCode,
              signature_key_id AS signatureKeyId, signature, signed_at AS signedAt,
              expires_at AS expiresAt, disabled_reason AS disabledReason,
              trust_manifest_generation AS trustManifestGeneration,
              trust_manifest_hash AS trustManifestHash,
              created_at AS createdAt, updated_at AS updatedAt
       FROM observer_recipe_candidates
       WHERE tenant_id = ? AND retailer_id = ? AND lifecycle_state IN ('trusted_read_only', 'canary', 'shadow')
         AND kill_switch = 0 AND expires_at > ?
       ORDER BY CASE lifecycle_state WHEN 'trusted_read_only' THEN 3 WHEN 'canary' THEN 2 ELSE 1 END DESC,
                updated_at DESC, id DESC`,
      currentRequestScope().tenantId,
      retailerId,
      nowIso(now)
    );
    for (const row of rows) {
      const envelope = this.envelope(row, now);
      if (envelope) return envelope;
    }
    return null;
  }

  list(): Array<Record<string, unknown>> {
    return this.rows().map((row) => recipeProjection(row, trialSummary(this.db, row.id)));
  }

  counts(now = Date.now()): Record<string, number> {
    const currentTrust = this.currentTrustManifest();
    const row = this.db.get<{
      candidates: number; active: number; disabled: number; trials: number; failedTrials: number;
      trustManifests: number; transparencyEvents: number;
      witnessReceipts: number; witnessChecks: number; failedWitnessChecks: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM observer_recipe_candidates WHERE tenant_id = ?) AS candidates,
         (SELECT COUNT(*) FROM observer_recipe_candidates WHERE tenant_id = ?
            AND lifecycle_state IN ('shadow', 'canary', 'trusted_read_only') AND kill_switch = 0 AND expires_at > ?
            AND trust_manifest_generation = ? AND trust_manifest_hash = ?) AS active,
         (SELECT COUNT(*) FROM observer_recipe_candidates WHERE tenant_id = ? AND lifecycle_state = 'disabled') AS disabled,
         (SELECT COUNT(*) FROM observer_recipe_trials WHERE tenant_id = ?) AS trials,
         (SELECT COUNT(*) FROM observer_recipe_trials WHERE tenant_id = ? AND outcome = 'failed') AS failedTrials,
         (SELECT COUNT(*) FROM observer_recipe_trust_manifests WHERE tenant_id = ?) AS trustManifests,
         (SELECT COUNT(*) FROM observer_recipe_transparency_events WHERE tenant_id = ?) AS transparencyEvents,
         (SELECT COUNT(*) FROM observer_recipe_witness_receipts WHERE tenant_id = ?) AS witnessReceipts,
         (SELECT COUNT(*) FROM observer_recipe_witness_checks WHERE tenant_id = ?) AS witnessChecks,
         (SELECT COUNT(*) FROM observer_recipe_witness_checks WHERE tenant_id = ? AND outcome <> 'accepted') AS failedWitnessChecks`,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      nowIso(now),
      currentTrust?.generation ?? 0,
      currentTrust?.manifestHash ?? "",
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId
    );
    return {
      observerRecipeCandidates: Number(row?.candidates ?? 0),
      activeObserverRecipes: Number(row?.active ?? 0),
      disabledObserverRecipes: Number(row?.disabled ?? 0),
      observerRecipeTrials: Number(row?.trials ?? 0),
      failedObserverRecipeTrials: Number(row?.failedTrials ?? 0),
      observerRecipeTrustManifests: Number(row?.trustManifests ?? 0),
      observerRecipeTransparencyEvents: Number(row?.transparencyEvents ?? 0),
      observerRecipeWitnessReceipts: Number(row?.witnessReceipts ?? 0),
      observerRecipeWitnessChecks: Number(row?.witnessChecks ?? 0),
      failedObserverRecipeWitnessChecks: Number(row?.failedWitnessChecks ?? 0)
    };
  }

  trustManifests(limit = 50): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
    return this.db.all<TrustManifestRow>(
      `SELECT id, generation, root_key_id AS rootKeyId, manifest_hash AS manifestHash,
              previous_manifest_hash AS previousManifestHash, payload_json AS payloadJson,
              signature, active_intermediate_key_id AS activeIntermediateKeyId,
              revoked_key_ids_json AS revokedKeyIdsJson, issued_at AS issuedAt,
              expires_at AS expiresAt, installed_at AS installedAt
       FROM observer_recipe_trust_manifests WHERE tenant_id = ?
       ORDER BY generation DESC LIMIT ?`,
      currentRequestScope().tenantId,
      safeLimit
    ).map((row) => ({
      id: row.id,
      generation: row.generation,
      rootKeyId: row.rootKeyId,
      manifestHash: row.manifestHash,
      previousManifestHash: row.previousManifestHash,
      activeIntermediateKeyId: row.activeIntermediateKeyId,
      revokedKeyCount: this.parsedRevocations(row).length,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      installedAt: row.installedAt,
      privacyClassification: "public_cryptographic_metadata"
    }));
  }

  transparencyEvents(limit = 100): ObserverRecipeTrustTransparencyReceipt[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return this.db.all<ObserverRecipeTrustTransparencyReceipt>(
      `SELECT sequence, event_type AS eventType, manifest_generation AS manifestGeneration,
              manifest_hash AS manifestHash, signing_key_id AS signingKeyId,
              subject_hash AS subjectHash, previous_event_hash AS previousEventHash,
              event_hash AS eventHash, created_at AS createdAt
       FROM observer_recipe_transparency_events WHERE tenant_id = ?
       ORDER BY sequence DESC LIMIT ?`,
      currentRequestScope().tenantId,
      safeLimit
    );
  }

  private latestTransparencyEvent(): ObserverRecipeTrustTransparencyReceipt | undefined {
    return this.db.get<ObserverRecipeTrustTransparencyReceipt>(
      `SELECT sequence, event_type AS eventType, manifest_generation AS manifestGeneration,
              manifest_hash AS manifestHash, signing_key_id AS signingKeyId,
              subject_hash AS subjectHash, previous_event_hash AS previousEventHash,
              event_hash AS eventHash, created_at AS createdAt
       FROM observer_recipe_transparency_events WHERE tenant_id = ?
       ORDER BY sequence DESC LIMIT 1`,
      currentRequestScope().tenantId
    );
  }

  private witnessLogId(): string {
    return this.witnessVerifier
      ? observerRecipeWitnessScopedLogId(this.witnessVerifier.logId, currentRequestScope().tenantId)
      : "";
  }

  private latestWitnessReceipt(): WitnessReceiptRow | undefined {
    if (!this.witnessVerifier) return undefined;
    return this.db.get<WitnessReceiptRow>(
      `SELECT id, log_id AS logId, witness_key_id AS witnessKeyId,
              witness_sequence AS witnessSequence, checkpoint_hash AS checkpointHash,
              manifest_generation AS manifestGeneration, manifest_hash AS manifestHash,
              transparency_sequence AS transparencySequence,
              transparency_event_hash AS transparencyEventHash,
              previous_receipt_hash AS previousReceiptHash, receipt_hash AS receiptHash,
              payload_json AS payloadJson, signature, witnessed_at AS witnessedAt,
              valid_until AS validUntil, received_at AS receivedAt
       FROM observer_recipe_witness_receipts
       WHERE tenant_id = ? AND log_id = ?
       ORDER BY witness_sequence DESC LIMIT 1`,
      currentRequestScope().tenantId,
      this.witnessLogId()
    );
  }

  private receiptForCheckpoint(transparencyEventHash: string): WitnessReceiptRow | undefined {
    if (!this.witnessVerifier) return undefined;
    return this.db.get<WitnessReceiptRow>(
      `SELECT id, log_id AS logId, witness_key_id AS witnessKeyId,
              witness_sequence AS witnessSequence, checkpoint_hash AS checkpointHash,
              manifest_generation AS manifestGeneration, manifest_hash AS manifestHash,
              transparency_sequence AS transparencySequence,
              transparency_event_hash AS transparencyEventHash,
              previous_receipt_hash AS previousReceiptHash, receipt_hash AS receiptHash,
              payload_json AS payloadJson, signature, witnessed_at AS witnessedAt,
              valid_until AS validUntil, received_at AS receivedAt
       FROM observer_recipe_witness_receipts
       WHERE tenant_id = ? AND log_id = ? AND transparency_event_hash = ?
       ORDER BY witness_sequence DESC LIMIT 1`,
      currentRequestScope().tenantId,
      this.witnessLogId(),
      transparencyEventHash
    );
  }

  private witnessReceiptFromRow(row: WitnessReceiptRow): SignedObserverRecipeWitnessReceipt | null {
    try {
      const payload = JSON.parse(row.payloadJson) as SignedObserverRecipeWitnessReceipt["payload"];
      return { algorithm: "Ed25519", keyId: row.witnessKeyId, payload, signature: row.signature };
    } catch {
      return null;
    }
  }

  private latestWitnessCheck(): WitnessCheckRow | undefined {
    if (!this.witnessVerifier) return undefined;
    return this.db.get<WitnessCheckRow>(
      `SELECT outcome, reason_code AS reasonCode, checkpoint_hash AS checkpointHash,
              transparency_event_hash AS transparencyEventHash,
              receipt_hash AS receiptHash, checked_at AS checkedAt
       FROM observer_recipe_witness_checks
       WHERE tenant_id = ? AND log_id = ?
       ORDER BY checked_at DESC, id DESC LIMIT 1`,
      currentRequestScope().tenantId,
      this.witnessLogId()
    );
  }

  private witnessCounts(): {
    witnessReceiptCount: number;
    witnessCheckCount: number;
    failedWitnessCheckCount: number;
  } {
    if (!this.witnessVerifier) {
      return { witnessReceiptCount: 0, witnessCheckCount: 0, failedWitnessCheckCount: 0 };
    }
    const row = this.db.get<{ receipts: number; checks: number; failures: number }>(
      `SELECT
         (SELECT COUNT(*) FROM observer_recipe_witness_receipts
            WHERE tenant_id = ? AND log_id = ?) AS receipts,
         (SELECT COUNT(*) FROM observer_recipe_witness_checks
            WHERE tenant_id = ? AND log_id = ?) AS checks,
         (SELECT COUNT(*) FROM observer_recipe_witness_checks
            WHERE tenant_id = ? AND log_id = ? AND outcome <> 'accepted') AS failures`,
      currentRequestScope().tenantId,
      this.witnessLogId(),
      currentRequestScope().tenantId,
      this.witnessLogId(),
      currentRequestScope().tenantId,
      this.witnessLogId()
    );
    return {
      witnessReceiptCount: Number(row?.receipts ?? 0),
      witnessCheckCount: Number(row?.checks ?? 0),
      failedWitnessCheckCount: Number(row?.failures ?? 0)
    };
  }

  private recordWitnessCheck(
    outcome: WitnessCheckRow["outcome"],
    reasonCode: string,
    checkpointHash: string,
    transparencyEventHash: string,
    receiptHash: string,
    now: number
  ): void {
    const scope = currentRequestScope();
    this.db.run(
      `INSERT INTO observer_recipe_witness_checks(
         id, tenant_id, log_id, checkpoint_hash, transparency_event_hash,
         outcome, reason_code, receipt_hash, checked_by_actor_id, checked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("observer_recipe_witness_check"),
      scope.tenantId,
      this.witnessLogId() || "unconfigured",
      checkpointHash,
      transparencyEventHash,
      outcome,
      reasonCode,
      receiptHash,
      scope.actorId,
      nowIso(now)
    );
  }

  private currentTrustManifest(): TrustManifestRow | undefined {
    return this.db.get<TrustManifestRow>(
      `SELECT id, generation, root_key_id AS rootKeyId, manifest_hash AS manifestHash,
              previous_manifest_hash AS previousManifestHash, payload_json AS payloadJson,
              signature, active_intermediate_key_id AS activeIntermediateKeyId,
              revoked_key_ids_json AS revokedKeyIdsJson, issued_at AS issuedAt,
              expires_at AS expiresAt, installed_at AS installedAt
       FROM observer_recipe_trust_manifests WHERE tenant_id = ?
       ORDER BY generation DESC LIMIT 1`,
      currentRequestScope().tenantId
    );
  }

  private trustManifestChain(): SignedObserverRecipeTrustManifest[] {
    return this.db.all<TrustManifestRow>(
      `SELECT id, generation, root_key_id AS rootKeyId, manifest_hash AS manifestHash,
              previous_manifest_hash AS previousManifestHash, payload_json AS payloadJson,
              signature, active_intermediate_key_id AS activeIntermediateKeyId,
              revoked_key_ids_json AS revokedKeyIdsJson, issued_at AS issuedAt,
              expires_at AS expiresAt, installed_at AS installedAt
       FROM observer_recipe_trust_manifests WHERE tenant_id = ?
       ORDER BY generation ASC`,
      currentRequestScope().tenantId
    ).map((manifestRow) => this.manifestFromRow(manifestRow));
  }

  private parsedRevocations(row: TrustManifestRow): string[] {
    try {
      const parsed = JSON.parse(row.revokedKeyIdsJson) as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }

  private manifestFromRow(row: TrustManifestRow): SignedObserverRecipeTrustManifest {
    return {
      algorithm: "Ed25519",
      rootKeyId: row.rootKeyId,
      payload: JSON.parse(row.payloadJson) as SignedObserverRecipeTrustManifest["payload"],
      signature: row.signature
    };
  }

  private validatedManifestFromRow(row: TrustManifestRow, now: number): ValidatedObserverRecipeTrustManifest {
    const validated = validateObserverRecipeTrustManifest(this.manifestFromRow(row), this.trust.root, now);
    if (validated.manifestHash !== row.manifestHash
      || validated.manifest.payload.generation !== row.generation
      || validated.activeKey.keyId !== row.activeIntermediateKeyId) {
      throw new Error("The installed observer recipe trust manifest does not match its immutable receipt.");
    }
    return validated;
  }

  private installedTrust(now: number): ValidatedObserverRecipeTrustManifest | null {
    const row = this.currentTrustManifest();
    const authority = this.trust.manifest();
    if (!row || !authority || !this.trust.ready(now)
      || row.manifestHash !== authority.manifestHash
      || row.generation !== authority.manifest.payload.generation) return null;
    const validated = this.validatedManifestFromRow(row, now);
    return validated.activeKey.keyId === authority.activeKey.keyId ? validated : null;
  }

  private requireRootedTrust(now: number): ValidatedObserverRecipeTrustManifest {
    const trust = this.installedTrust(now);
    if (!trust) throw new Error("Install a package-rooted observer recipe trust manifest before promotion or distribution.");
    return trust;
  }

  private transparency(
    eventType: ObserverRecipeTrustTransparencyReceipt["eventType"],
    manifest: ValidatedObserverRecipeTrustManifest,
    subjectHash: string,
    signingKeyId: string,
    now: number
  ): ObserverRecipeTrustTransparencyReceipt {
    const scope = currentRequestScope();
    const prior = this.db.get<{ sequence: number; eventHash: string }>(
      `SELECT sequence, event_hash AS eventHash FROM observer_recipe_transparency_events
       WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1`,
      scope.tenantId
    );
    const sequence = Number(prior?.sequence ?? 0) + 1;
    const previousEventHash = prior?.eventHash ?? "";
    const createdAt = nowIso(now);
    const eventHash = stableHash(
      "observer-recipe-transparency-v1",
      sequence,
      eventType,
      manifest.manifest.payload.generation,
      manifest.manifestHash,
      signingKeyId,
      subjectHash,
      previousEventHash,
      createdAt
    );
    this.db.run(
      `INSERT INTO observer_recipe_transparency_events(
         id, tenant_id, sequence, event_type, manifest_generation, manifest_hash,
         signing_key_id, subject_hash, previous_event_hash, event_hash,
         actor_kind, actor_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("observer_recipe_transparency"),
      scope.tenantId,
      sequence,
      eventType,
      manifest.manifest.payload.generation,
      manifest.manifestHash,
      signingKeyId,
      subjectHash,
      previousEventHash,
      eventHash,
      scope.actorKind,
      scope.actorId,
      createdAt
    );
    return {
      sequence,
      eventType,
      manifestGeneration: manifest.manifest.payload.generation,
      manifestHash: manifest.manifestHash,
      signingKeyId,
      subjectHash,
      previousEventHash,
      eventHash,
      createdAt
    };
  }

  private payload(row: RecipeRow, state: SignedObserverRecipePayload["state"], issuedAt: string): SignedObserverRecipePayload {
    return {
      contractVersion: OBSERVER_RECIPE_CONTRACT_VERSION,
      recipeId: row.id,
      retailerId: row.retailerId,
      recipeVersion: row.recipeVersion,
      state,
      minimumExtensionVersion: row.minimumExtensionVersion,
      issuedAt,
      expiresAt: row.expiresAt,
      rollbackRecipeId: row.rollbackRecipeId,
      fields: parsedFields(row.recipeJson)
    };
  }

  private envelope(row: RecipeRow, now = Date.now()): SignedObserverRecipeEnvelope | null {
    const rootedTrust = this.installedTrust(now);
    if (!ACTIVE_STATES.has(row.lifecycleState) || !row.signedAt || !row.signature
      || !rootedTrust || row.signatureKeyId !== rootedTrust.activeKey.keyId
      || row.trustManifestGeneration !== rootedTrust.manifest.payload.generation
      || row.trustManifestHash !== rootedTrust.manifestHash) return null;
    const payload = this.payload(row, row.lifecycleState as SignedObserverRecipePayload["state"], row.signedAt);
    const envelope: SignedObserverRecipeEnvelope = {
      algorithm: "Ed25519",
      keyId: row.signatureKeyId,
      publicKeySpki: rootedTrust.activeKey.publicKeySpki,
      payload,
      signature: row.signature
    };
    return this.trust.verifyEnvelope(envelope, now) ? envelope : null;
  }

  private rows(): RecipeRow[] {
    return this.db.all<RecipeRow>(
      `SELECT id, retailer_id AS retailerId, recipe_version AS recipeVersion,
              minimum_extension_version AS minimumExtensionVersion,
              recipe_json AS recipeJson, recipe_fingerprint AS recipeFingerprint,
              lifecycle_state AS lifecycleState, rollback_recipe_id AS rollbackRecipeId,
              kill_switch AS killSwitch, provenance_code AS provenanceCode,
              signature_key_id AS signatureKeyId, signature, signed_at AS signedAt,
              expires_at AS expiresAt, disabled_reason AS disabledReason,
              trust_manifest_generation AS trustManifestGeneration,
              trust_manifest_hash AS trustManifestHash,
              created_at AS createdAt, updated_at AS updatedAt
       FROM observer_recipe_candidates WHERE tenant_id = ?
       ORDER BY created_at DESC, id DESC`,
      currentRequestScope().tenantId
    );
  }

  private row(id: string): RecipeRow | undefined {
    return this.rows().find((row) => row.id === id);
  }

  private requireProjection(id: string): Record<string, unknown> {
    const row = this.row(id);
    if (!row) throw new Error("The observer recipe could not be read back.");
    return recipeProjection(row, trialSummary(this.db, row.id));
  }

  private lifecycle(
    recipeId: string,
    fromState: string,
    toState: string,
    reasonCode: string,
    now: number
  ): void {
    const id = newId("observer_recipe_event");
    const createdAt = nowIso(now);
    const eventHash = stableHash("observer-recipe-lifecycle-v1", recipeId, fromState, toState, reasonCode, createdAt);
    this.db.run(
      `INSERT INTO observer_recipe_lifecycle_events(
         id, tenant_id, user_id, recipe_id, from_state, to_state,
         reason_code, event_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      recipeId,
      fromState,
      toState,
      reasonCode,
      eventHash,
      createdAt
    );
  }
}
