import {
  OBSERVER_RECIPE_CONTRACT_VERSION,
  OBSERVER_RECIPE_FIELDS,
  OBSERVER_RECIPE_MODES,
  RETAILER_OBSERVER_VERSIONS,
  type ObserverRecipeField,
  type ObserverRecipeFieldInput,
  type ObserverRecipePromotionInput,
  type ObserverRecipeProposalInput,
  type ObserverRecipeState,
  type ObserverRecipeTrialInput,
  type SignedObserverRecipeEnvelope,
  type SignedObserverRecipePayload,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { ObserverRecipeSigner } from "../../observer-registry/src/signer.js";
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
  createdAt: string;
  updatedAt: string;
}

interface TrialSummary {
  passed: number;
  failed: number;
  distinctSkus: number;
  distinctLayouts: number;
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

  constructor(
    private readonly db: YoinkDatabase,
    private readonly signer: ObserverRecipeSigner
  ) {
    this.audit = new AuditRepository(db);
  }

  keyInfo(): { algorithm: "Ed25519"; keyId: string; publicKeySpki: string } {
    return { algorithm: "Ed25519", keyId: this.signer.keyId, publicKeySpki: this.signer.publicKeySpki };
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
    const signedAt = nowIso(now);
    const payload = this.payload(row, input.targetState, signedAt);
    const envelope = this.signer.envelope(payload);
    return this.db.transaction(() => {
      this.db.run(
        `UPDATE observer_recipe_candidates SET lifecycle_state = ?, signature_key_id = ?,
           signature = ?, signed_at = ?, updated_at = ? WHERE id = ?`,
        input.targetState,
        envelope.keyId,
        envelope.signature,
        signedAt,
        signedAt,
        recipeId
      );
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
      || recipe.signatureKeyId !== this.signer.keyId || new Date(recipe.expiresAt).getTime() <= now) {
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
    const active = this.envelope(rollback);
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
      const envelope = this.envelope(row);
      if (envelope) return envelope;
    }
    return null;
  }

  list(): Array<Record<string, unknown>> {
    return this.rows().map((row) => recipeProjection(row, trialSummary(this.db, row.id)));
  }

  counts(now = Date.now()): Record<string, number> {
    const row = this.db.get<{ candidates: number; active: number; disabled: number; trials: number; failedTrials: number }>(
      `SELECT
         (SELECT COUNT(*) FROM observer_recipe_candidates WHERE tenant_id = ?) AS candidates,
         (SELECT COUNT(*) FROM observer_recipe_candidates WHERE tenant_id = ? AND lifecycle_state IN ('shadow', 'canary', 'trusted_read_only') AND kill_switch = 0 AND expires_at > ?) AS active,
         (SELECT COUNT(*) FROM observer_recipe_candidates WHERE tenant_id = ? AND lifecycle_state = 'disabled') AS disabled,
         (SELECT COUNT(*) FROM observer_recipe_trials WHERE tenant_id = ?) AS trials,
         (SELECT COUNT(*) FROM observer_recipe_trials WHERE tenant_id = ? AND outcome = 'failed') AS failedTrials`,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      nowIso(now),
      currentRequestScope().tenantId,
      currentRequestScope().tenantId,
      currentRequestScope().tenantId
    );
    return {
      observerRecipeCandidates: Number(row?.candidates ?? 0),
      activeObserverRecipes: Number(row?.active ?? 0),
      disabledObserverRecipes: Number(row?.disabled ?? 0),
      observerRecipeTrials: Number(row?.trials ?? 0),
      failedObserverRecipeTrials: Number(row?.failedTrials ?? 0)
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

  private envelope(row: RecipeRow): SignedObserverRecipeEnvelope | null {
    if (!ACTIVE_STATES.has(row.lifecycleState) || !row.signedAt || !row.signature
      || row.signatureKeyId !== this.signer.keyId) return null;
    const payload = this.payload(row, row.lifecycleState as SignedObserverRecipePayload["state"], row.signedAt);
    const envelope: SignedObserverRecipeEnvelope = {
      algorithm: "Ed25519",
      keyId: row.signatureKeyId,
      publicKeySpki: this.signer.publicKeySpki,
      payload,
      signature: row.signature
    };
    return this.signer.verify(envelope) ? envelope : null;
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
