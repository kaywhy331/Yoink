import {
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION,
  OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE,
  type ObserverRecipeContributorEligibilityInput
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export const OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION =
  "observer_recipe_contributor_eligibility_v1";
export const OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_MAXIMUM_TTL_MS = 24 * 60 * 60_000;
export const OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_MAXIMUM_AGE_MS = 5 * 60_000;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const REGION_PATTERN = /^(?:country:[A-Z]{2}|subdivision:[A-Z]{2}-[A-Z0-9]{1,3})$/;
const SUBDIVISION_PATTERN = /^subdivision:[A-Z]{2}-[A-Z0-9]{1,3}$/;

interface EligibilityRow {
  tenantId: string;
  userId: string;
  deviceId: string;
  policyVersion: string;
  contributorRefHash: string;
  regionScope: string;
  accountEligible: number;
  deviceEligible: number;
  regionEligible: number;
  proofHash: string;
  source: string;
  attestedByActorId: string;
  attestedAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface EligibilitySummaryRow {
  stateCount: number;
  activeStateCount: number;
  externallyAttestedDeviceCount: number;
  distinctExternallyAttestedAccounts: number;
  distinctExternallyAttestedRegions: number;
  expiredStateCount: number;
}

export interface ObserverRecipeContributorEligibilitySnapshot {
  policyVersion: string;
  state: "unverified" | "externally_attested";
  contributorRefHash: string;
  regionScope: string;
  proofHash: string;
  expiresAt: string;
}

function timestamp(value: unknown, label: string): number {
  const parsed = new Date(String(value ?? "")).getTime();
  if (!Number.isFinite(parsed)) throw new InputValidationError(`The contributor eligibility ${label} is invalid.`);
  return parsed;
}

function rowProjection(row: EligibilityRow, owner = false, now = Date.now()): Record<string, unknown> {
  const active = new Date(row.expiresAt).getTime() > now;
  const eligible = active && row.accountEligible === 1 && row.deviceEligible === 1 && row.regionEligible === 1;
  return {
    deviceRef: stableHash("observer-recipe-eligibility-device-v1", row.deviceId).slice(0, 12),
    contributorRef: stableHash("observer-recipe-eligibility-contributor-v1", row.contributorRefHash).slice(0, 12),
    regionRef: stableHash("observer-recipe-eligibility-region-v1", row.regionScope).slice(0, 12),
    regionKind: row.regionScope.startsWith("subdivision:") ? "subdivision" : "country",
    ...(owner ? { regionScope: row.regionScope } : {}),
    state: eligible ? "externally_attested" : active ? "attested_ineligible" : "expired",
    accountEligible: row.accountEligible === 1,
    deviceEligible: row.deviceEligible === 1,
    regionEligible: row.regionEligible === 1,
    source: row.source,
    attestedAt: row.attestedAt,
    expiresAt: row.expiresAt,
    privacyClassification: "restricted_eligibility_metadata",
    rawAccountIdentifierStored: false,
    rawRiskPayloadStored: false,
    applicationAffected: false,
    mutationCapable: false
  };
}

export class ObserverRecipeContributorEligibilityRepository {
  private readonly audit: AuditRepository;
  private readonly authorization: AuthorizationRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
    this.authorization = new AuthorizationRepository(db);
  }

  attest(input: ObserverRecipeContributorEligibilityInput, now = Date.now()): Record<string, unknown> {
    const scope = currentRequestScope();
    if (scope.actorKind !== "service") {
      throw new InputValidationError("A trusted identity-risk service scope is required for contributor eligibility.");
    }
    this.authorization.require("internal.eligibility");
    if (!input || typeof input !== "object" || Array.isArray(input)
      || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify([
        "accountEligible", "attestedAt", "contractVersion", "contributorRefHash",
        "deviceEligible", "deviceId", "expiresAt", "proofHash", "regionEligible",
        "regionScope", "source"
      ].sort())
      || input.contractVersion !== OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_CONTRACT_VERSION
      || input.source !== OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE
      || typeof input.accountEligible !== "boolean"
      || typeof input.deviceEligible !== "boolean"
      || typeof input.regionEligible !== "boolean") {
      throw new InputValidationError("A valid contributor eligibility attestation is required.");
    }
    const rawDeviceId = String(input.deviceId ?? "");
    const deviceId = cleanText(rawDeviceId, 120);
    const contributorRefHash = String(input.contributorRefHash ?? "");
    const proofHash = String(input.proofHash ?? "");
    const regionScope = String(input.regionScope ?? "");
    if (rawDeviceId !== deviceId || !ID_PATTERN.test(deviceId) || !HASH_PATTERN.test(contributorRefHash)
      || !HASH_PATTERN.test(proofHash) || !REGION_PATTERN.test(regionScope)
      || (input.regionEligible && !SUBDIVISION_PATTERN.test(regionScope))) {
      throw new InputValidationError("Contributor eligibility contains an invalid pseudonym, proof, device, or coarse region.");
    }
    const attestedTime = timestamp(input.attestedAt, "attestation time");
    const expiresTime = timestamp(input.expiresAt, "expiry");
    if (attestedTime > now + 60_000 || now - attestedTime > OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_MAXIMUM_AGE_MS
      || expiresTime <= now + 60_000
      || expiresTime - attestedTime > OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_MAXIMUM_TTL_MS) {
      throw new InputValidationError("Contributor eligibility must be fresh and expire within 24 hours.");
    }
    const device = this.db.get<{ id: string }>(
      `SELECT id FROM extension_devices
       WHERE tenant_id = ? AND user_id = ? AND id = ? AND status = 'active'`,
      scope.tenantId,
      scope.userId,
      deviceId
    );
    if (!device) throw new InputValidationError("The contributor eligibility device is not an active device for this principal.");
    const existing = this.row(deviceId);
    if (existing) {
      const existingTime = new Date(existing.attestedAt).getTime();
      if (attestedTime < existingTime) {
        throw new InputValidationError("Contributor eligibility cannot be replaced by an older attestation.");
      }
      if (attestedTime === existingTime) {
        const exactReplay = existing.proofHash === proofHash
          && existing.contributorRefHash === contributorRefHash
          && existing.regionScope === regionScope
          && existing.accountEligible === (input.accountEligible ? 1 : 0)
          && existing.deviceEligible === (input.deviceEligible ? 1 : 0)
          && existing.regionEligible === (input.regionEligible ? 1 : 0)
          && existing.expiresAt === new Date(expiresTime).toISOString();
        if (!exactReplay) throw new InputValidationError("Contributor eligibility conflicts with an attestation at the same time.");
        return rowProjection(existing, true, now);
      }
    }
    const createdAt = existing?.createdAt ?? nowIso(now);
    const updatedAt = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO observer_recipe_contributor_eligibility_states(
           tenant_id, user_id, device_id, policy_version,
           contributor_ref_hash, region_scope, account_eligible,
           device_eligible, region_eligible, proof_hash, source,
           attested_by_actor_id, privacy_classification,
           attested_at, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           'restricted_eligibility_metadata', ?, ?, ?, ?)
         ON CONFLICT(tenant_id, user_id, device_id) DO UPDATE SET
           policy_version = excluded.policy_version,
           contributor_ref_hash = excluded.contributor_ref_hash,
           region_scope = excluded.region_scope,
           account_eligible = excluded.account_eligible,
           device_eligible = excluded.device_eligible,
           region_eligible = excluded.region_eligible,
           proof_hash = excluded.proof_hash,
           source = excluded.source,
           attested_by_actor_id = excluded.attested_by_actor_id,
           privacy_classification = excluded.privacy_classification,
           attested_at = excluded.attested_at,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
        scope.tenantId,
        scope.userId,
        deviceId,
        OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION,
        contributorRefHash,
        regionScope,
        input.accountEligible ? 1 : 0,
        input.deviceEligible ? 1 : 0,
        input.regionEligible ? 1 : 0,
        proofHash,
        OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_SOURCE,
        scope.actorId,
        new Date(attestedTime).toISOString(),
        new Date(expiresTime).toISOString(),
        createdAt,
        updatedAt
      );
      this.audit.record({
        correlationId: newId("observer_recipe_eligibility"),
        aggregateType: "observer_recipe_contributor_eligibility",
        eventType: "observer_recipe_contributor_eligibility_attested",
        reasonCode: input.accountEligible && input.deviceEligible && input.regionEligible
          ? "externally_attested"
          : "attested_ineligible",
        message: "A trusted service replaced the bounded current contributor eligibility state.",
        data: {
          policyVersion: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION,
          deviceRef: stableHash("observer-recipe-eligibility-device-v1", deviceId).slice(0, 12),
          regionRef: stableHash("observer-recipe-eligibility-region-v1", regionScope).slice(0, 12),
          accountEligible: input.accountEligible,
          deviceEligible: input.deviceEligible,
          regionEligible: input.regionEligible,
          expiresAt: new Date(expiresTime).toISOString(),
          rawAccountIdentifierStored: false,
          rawRiskPayloadStored: false,
          applicationAffected: false,
          mutationCapable: false
        }
      }, now);
    });
    const stored = this.row(deviceId);
    if (!stored) throw new Error("The contributor eligibility state could not be read back.");
    return rowProjection(stored, true, now);
  }

  snapshotForDevice(deviceId: string, now = Date.now()): ObserverRecipeContributorEligibilitySnapshot {
    const row = this.row(cleanText(deviceId, 120));
    const eligible = Boolean(row
      && new Date(row.expiresAt).getTime() > now
      && row.accountEligible === 1
      && row.deviceEligible === 1
      && row.regionEligible === 1
      && SUBDIVISION_PATTERN.test(row.regionScope));
    if (!row || !eligible) {
      return {
        policyVersion: "",
        state: "unverified",
        contributorRefHash: "",
        regionScope: "",
        proofHash: "",
        expiresAt: ""
      };
    }
    return {
      policyVersion: row.policyVersion,
      state: "externally_attested",
      contributorRefHash: row.contributorRefHash,
      regionScope: row.regionScope,
      proofHash: row.proofHash,
      expiresAt: row.expiresAt
    };
  }

  status(limit = 100, ownerOnly = false, now = Date.now()): Record<string, unknown> {
    const scope = currentRequestScope();
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const ownerClause = ownerOnly ? " AND user_id = ?" : "";
    const parameters = ownerOnly ? [scope.tenantId, scope.userId] : [scope.tenantId];
    const currentAt = nowIso(now);
    const summary = this.db.get<EligibilitySummaryRow>(
      `SELECT
         COUNT(*) AS stateCount,
         COALESCE(SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END), 0) AS activeStateCount,
         COALESCE(SUM(CASE WHEN expires_at > ? AND account_eligible = 1
                            AND device_eligible = 1 AND region_eligible = 1
                           THEN 1 ELSE 0 END), 0) AS externallyAttestedDeviceCount,
         COUNT(DISTINCT CASE WHEN expires_at > ? AND account_eligible = 1
                               AND device_eligible = 1 AND region_eligible = 1
                             THEN contributor_ref_hash END) AS distinctExternallyAttestedAccounts,
         COUNT(DISTINCT CASE WHEN expires_at > ? AND account_eligible = 1
                               AND device_eligible = 1 AND region_eligible = 1
                             THEN region_scope END) AS distinctExternallyAttestedRegions,
         COALESCE(SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END), 0) AS expiredStateCount
       FROM observer_recipe_contributor_eligibility_states
       WHERE tenant_id = ?${ownerClause}`,
      currentAt,
      currentAt,
      currentAt,
      currentAt,
      currentAt,
      ...parameters
    );
    const rows = this.db.all<EligibilityRow>(
      `SELECT tenant_id AS tenantId, user_id AS userId, device_id AS deviceId,
              policy_version AS policyVersion, contributor_ref_hash AS contributorRefHash,
              region_scope AS regionScope, account_eligible AS accountEligible,
              device_eligible AS deviceEligible, region_eligible AS regionEligible,
              proof_hash AS proofHash, source, attested_by_actor_id AS attestedByActorId,
              attested_at AS attestedAt, expires_at AS expiresAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM observer_recipe_contributor_eligibility_states
       WHERE tenant_id = ?${ownerClause}
       ORDER BY updated_at DESC, device_id DESC LIMIT ?`,
      ...parameters,
      safeLimit
    );
    return {
      policyVersion: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_POLICY_VERSION,
      maximumTtlHours: OBSERVER_RECIPE_CONTRIBUTOR_ELIGIBILITY_MAXIMUM_TTL_MS / 3_600_000,
      stateCount: Number(summary?.stateCount ?? 0),
      activeStateCount: Number(summary?.activeStateCount ?? 0),
      externallyAttestedDeviceCount: Number(summary?.externallyAttestedDeviceCount ?? 0),
      distinctExternallyAttestedAccounts: Number(summary?.distinctExternallyAttestedAccounts ?? 0),
      distinctExternallyAttestedRegions: Number(summary?.distinctExternallyAttestedRegions ?? 0),
      expiredStateCount: Number(summary?.expiredStateCount ?? 0),
      items: rows.map((row) => rowProjection(row, ownerOnly, now)),
      localAccountsCountAsPublicIndependentAccounts: false,
      rawAccountIdentifierStored: false,
      rawRiskPayloadStored: false,
      applicationAffected: false,
      mutationCapable: false
    };
  }

  private row(deviceId: string): EligibilityRow | undefined {
    const scope = currentRequestScope();
    return this.db.get<EligibilityRow>(
      `SELECT tenant_id AS tenantId, user_id AS userId, device_id AS deviceId,
              policy_version AS policyVersion, contributor_ref_hash AS contributorRefHash,
              region_scope AS regionScope, account_eligible AS accountEligible,
              device_eligible AS deviceEligible, region_eligible AS regionEligible,
              proof_hash AS proofHash, source, attested_by_actor_id AS attestedByActorId,
              attested_at AS attestedAt, expires_at AS expiresAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM observer_recipe_contributor_eligibility_states
       WHERE tenant_id = ? AND user_id = ? AND device_id = ?`,
      scope.tenantId,
      scope.userId,
      deviceId
    );
  }
}
