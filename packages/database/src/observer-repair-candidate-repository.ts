import {
  RETAILER_OBSERVER_VERSIONS,
  type ObserverRecipeState,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const GENERATED_REPAIR_SELECTOR = /^(?:button|input|\[role='button'\])\[(?:data-testid|data-test-id|data-automation-id|data-button-state|name)='[A-Za-z][A-Za-z0-9_.-]{1,63}'\]$/;
const GENERATED_REPAIR_FORBIDDEN = /(?:checkout|buy[_.:-]?now|place[_.:-]?order|submit[_.:-]?order|payment|credit|debit|address|email|phone|account|password|cookie|csrf|token)/i;
const GENERATED_REPAIR_PROVENANCE = "privacy_bounded_repair_miner";
const GENERATED_CANDIDATE_LIFETIME_MS = 30 * 24 * 60 * 60_000;

export interface GeneratedObserverRepairCandidateInput {
  retailerId: SupportedRetailerId;
  layoutFingerprint: string;
  selectors: string[];
  minimumExtensionVersion: string;
  occurrenceCount: number;
  minimumDistinctDeviceCount: number;
  minimumDistinctSkuCount: number;
}

export interface GeneratedObserverRepairCandidate {
  created: boolean;
  id: string;
  retailerId: SupportedRetailerId;
  recipeVersion: string;
  recipeFingerprint: string;
  lifecycleState: ObserverRecipeState;
  expiresAt: string;
}

export function isGeneratedObserverRepairSelector(value: unknown): value is string {
  const candidate = String(value ?? "").trim();
  return GENERATED_REPAIR_SELECTOR.test(candidate) && !GENERATED_REPAIR_FORBIDDEN.test(candidate);
}

interface CandidateRow {
  id: string;
  retailerId: SupportedRetailerId;
  recipeVersion: string;
  minimumExtensionVersion: string;
  recipeJson: string;
  recipeFingerprint: string;
  lifecycleState: ObserverRecipeState;
  provenanceCode: string;
  expiresAt: string;
}

export class ObserverRepairCandidateRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  ensure(input: GeneratedObserverRepairCandidateInput, now = Date.now()): GeneratedObserverRepairCandidate {
    if (!input || typeof input !== "object" || !Object.hasOwn(RETAILER_OBSERVER_VERSIONS, input.retailerId)) {
      throw new Error("A supported generated observer repair candidate is required.");
    }
    const minimumExtensionVersion = String(input.minimumExtensionVersion ?? "").trim();
    const layoutFingerprint = String(input.layoutFingerprint ?? "").trim();
    const occurrenceCount = Number(input.occurrenceCount);
    const minimumDistinctDeviceCount = Number(input.minimumDistinctDeviceCount);
    const minimumDistinctSkuCount = Number(input.minimumDistinctSkuCount);
    if (!SEMVER_PATTERN.test(minimumExtensionVersion) || !FINGERPRINT_PATTERN.test(layoutFingerprint)
      || !Number.isSafeInteger(occurrenceCount) || occurrenceCount < 1 || occurrenceCount > 10_000
      || !Number.isSafeInteger(minimumDistinctDeviceCount) || minimumDistinctDeviceCount < 3 || minimumDistinctDeviceCount > 10_000
      || !Number.isSafeInteger(minimumDistinctSkuCount) || minimumDistinctSkuCount < 2 || minimumDistinctSkuCount > 10_000
      || occurrenceCount < minimumDistinctDeviceCount || occurrenceCount < minimumDistinctSkuCount) {
      throw new Error("Generated observer repair candidate evidence is invalid.");
    }
    if (!Array.isArray(input.selectors) || input.selectors.length < 1 || input.selectors.length > 5) {
      throw new Error("Generated observer repair candidates require one through five bounded selectors.");
    }
    const selectors = [...new Set(input.selectors.map((value) => String(value ?? "").trim()))]
      .sort((left, right) => left.localeCompare(right));
    if (selectors.length !== input.selectors.length
      || selectors.some((candidate) => !isGeneratedObserverRepairSelector(candidate))) {
      throw new Error("Generated observer repair candidates may contain only unique allowlisted Add-control landmarks.");
    }
    const scope = currentRequestScope();
    const candidateKey = stableHash(
      "yoink_privacy_bounded_repair_candidate_v1",
      scope.tenantId,
      scope.userId,
      input.retailerId,
      layoutFingerprint,
      JSON.stringify(selectors),
      minimumExtensionVersion
    );
    const recipeVersion = `${input.retailerId}-repair-${candidateKey.slice(0, 12)}`;
    const recipeJson = JSON.stringify({
      addControl: {
        mode: "disabled_state",
        selectors
      }
    });
    const recipeFingerprint = stableHash(
      "declarative-observer-recipe-v1",
      input.retailerId,
      recipeVersion,
      minimumExtensionVersion,
      recipeJson
    );
    return this.db.transaction(() => {
      const existing = this.db.get<CandidateRow>(
        `SELECT id, retailer_id AS retailerId, recipe_version AS recipeVersion,
                minimum_extension_version AS minimumExtensionVersion,
                recipe_json AS recipeJson, recipe_fingerprint AS recipeFingerprint,
                lifecycle_state AS lifecycleState, provenance_code AS provenanceCode,
                expires_at AS expiresAt
         FROM observer_recipe_candidates
         WHERE tenant_id = ? AND recipe_fingerprint = ?`,
        scope.tenantId,
        recipeFingerprint
      );
      if (existing) {
        if (existing.retailerId !== input.retailerId
          || existing.recipeVersion !== recipeVersion
          || existing.minimumExtensionVersion !== minimumExtensionVersion
          || existing.recipeJson !== recipeJson
          || existing.provenanceCode !== GENERATED_REPAIR_PROVENANCE) {
          throw new Error("The generated observer repair candidate fingerprint conflicts with durable state.");
        }
        return this.projection(existing, false);
      }
      const id = newId("observer_recipe");
      const lifecycleId = newId("observer_recipe_event");
      const timestamp = nowIso(now);
      const expiresAt = new Date(now + GENERATED_CANDIDATE_LIFETIME_MS).toISOString();
      this.db.run(
        `INSERT INTO observer_recipe_candidates(
           id, tenant_id, user_id, retailer_id, recipe_version,
           minimum_extension_version, recipe_json, recipe_fingerprint,
           lifecycle_state, rollback_recipe_id, kill_switch,
           provenance_code, signature_key_id, signature, signed_at,
           expires_at, disabled_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quarantined', '', 0, ?, '', '', '', ?, '', ?, ?)`,
        id,
        scope.tenantId,
        scope.userId,
        input.retailerId,
        recipeVersion,
        minimumExtensionVersion,
        recipeJson,
        recipeFingerprint,
        GENERATED_REPAIR_PROVENANCE,
        expiresAt,
        timestamp,
        timestamp
      );
      this.db.run(
        `INSERT INTO observer_recipe_lifecycle_events(
           id, tenant_id, user_id, recipe_id, from_state, to_state,
           reason_code, event_hash, created_at
         ) VALUES (?, ?, ?, ?, '', 'quarantined', ?, ?, ?)`,
        lifecycleId,
        scope.tenantId,
        scope.userId,
        id,
        "privacy_bounded_repair_candidate_generated",
        stableHash(
          "observer-recipe-lifecycle-v1",
          id,
          "",
          "quarantined",
          "privacy_bounded_repair_candidate_generated",
          timestamp
        ),
        timestamp
      );
      this.audit.record({
        correlationId: id,
        aggregateType: "observer_recipe",
        eventType: "observer_recipe_repair_candidate_generated",
        reasonCode: "quarantined",
        message: "A privacy-bounded repair landmark became an unsigned observer-only candidate for maintainer review.",
        data: {
          retailerId: input.retailerId,
          layoutFingerprint,
          recipeFingerprint,
          selectorCount: selectors.length,
          occurrenceCount,
          minimumDistinctDeviceCount,
          minimumDistinctSkuCount,
          generated: true,
          executable: false,
          mutationAuthority: false
        }
      }, now);
      return {
        created: true,
        id,
        retailerId: input.retailerId,
        recipeVersion,
        recipeFingerprint,
        lifecycleState: "quarantined",
        expiresAt
      };
    });
  }

  private projection(row: CandidateRow, created: boolean): GeneratedObserverRepairCandidate {
    return {
      created,
      id: row.id,
      retailerId: row.retailerId,
      recipeVersion: row.recipeVersion,
      recipeFingerprint: row.recipeFingerprint,
      lifecycleState: row.lifecycleState,
      expiresAt: row.expiresAt
    };
  }
}
