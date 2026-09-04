import { randomBytes } from "node:crypto";
import {
  COMMUNITY_CONTRIBUTION_CONFIRMATION,
  COMMUNITY_EVIDENCE_CONTRACT_VERSION,
  COMMUNITY_PRIVACY_VERSION,
  RETAILER_OBSERVER_VERSIONS,
  type CommunityConsentUpdateInput,
  type CommunityContributionInput,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const NONCE_TTL_MS = 2 * 60_000;
const MAX_OBSERVATION_AGE_MS = 10 * 60_000;
const IDENTICAL_DEDUPE_MS = 60_000;
const DEVICE_HOURLY_LIMIT = 60;
const IN_STOCK_TTL_MS = 10 * 60_000;
const OUT_OF_STOCK_TTL_MS = 5 * 60_000;
const RETENTION_LIMIT = 10_000;
const HEALTHY_DEVICE_WINDOW_MS = 24 * 60 * 60_000;
const LOCATION_SCOPE_PATTERN = /^(?:country:[A-Z]{2}|region:[A-Z]{2}-[A-Z0-9]{2,3}|store:[a-f0-9]{64})$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const DYNAMIC_CONFLICT_REASONS = new Set(["availability_conflict", "price_conflict"]);

interface ConsentRow {
  retailerId: SupportedRetailerId;
  retailerName: string;
  domainsJson: string;
  enabled: number;
  locationScope: string;
  privacyVersion: string;
  consentedAt: string;
  revokedAt: string;
  updatedAt: string;
}

interface ObservationRow {
  id: string;
  deviceId: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  adapterVersion: string;
  availability: "in_stock" | "preorder" | "out_of_stock" | "unknown";
  unitPriceCents: number | null;
  currency: "USD";
  sellerName: string;
  sellerType: "first_party" | "third_party" | "unknown";
  fulfillment: "shipping" | "pickup" | "unknown";
  securityChallenge: number;
  interactiveBlock: string;
  observationState: string;
  selectedOfferSchemaVersion: number;
  selectedOfferState: "exact" | "listing_only" | "unresolved";
  childOfferKey: string;
  variantAttributesJson: string;
  selectedOfferFingerprint: string;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

interface DiagnosticRow {
  id: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  adapterVersion: string;
  layoutFingerprint: string;
  observedAt: string;
}

interface AssertionRow {
  id: string;
  userId: string;
  deviceId: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  variantFingerprint: string;
  selectedOfferState: "exact" | "listing_only" | "unresolved";
  childOfferKey: string;
  variantAttributesJson: string;
  selectedOfferFingerprint: string;
  observationKey: string;
  availability: "in_stock" | "preorder" | "out_of_stock";
  unitPriceCents: number | null;
  currency: "USD";
  sellerName: string;
  sellerType: "first_party" | "third_party" | "unknown";
  fulfillment: "shipping" | "pickup" | "unknown";
  locationScope: string;
  observerVersion: string;
  layoutFingerprint: string;
  assertionState: "accepted" | "quarantined";
  quarantineReason: string;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
  expiresAt: string;
  deviceStatus?: string;
  deviceLastSeenAt?: string;
}

export interface CommunityConsentStatus {
  retailerId: SupportedRetailerId;
  retailerName: string;
  domains: string[];
  enabled: boolean;
  locationScope: string;
  privacyVersion: string;
  consentedAt: string;
  revokedAt: string;
  updatedAt: string;
}

export interface CommunityContributionReceipt {
  id: string;
  assertionId: string;
  disposition: "accepted" | "deduped" | "quarantined";
  receiptHash: string;
  createdAt: string;
}

function parsedDomains(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}

function consentFromRow(row: ConsentRow): CommunityConsentStatus {
  return {
    retailerId: row.retailerId,
    retailerName: row.retailerName,
    domains: parsedDomains(row.domainsJson),
    enabled: row.enabled === 1,
    locationScope: row.locationScope,
    privacyVersion: row.privacyVersion,
    consentedAt: row.consentedAt,
    revokedAt: row.revokedAt,
    updatedAt: row.updatedAt
  };
}

function normalizedLocationScope(value: unknown): string {
  const scope = cleanText(value, 96);
  if (!LOCATION_SCOPE_PATTERN.test(scope)) {
    throw new InputValidationError("Community evidence location scope must be a country, region, or one-way store fingerprint.");
  }
  return scope;
}

function nonceHash(value: string): string {
  return stableHash("community-contribution-nonce-v1", value);
}

function medianPrice(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] ?? null
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function hasHardQuarantine(row: AssertionRow): boolean {
  if (row.selectedOfferState !== "exact") return true;
  if (!row.quarantineReason) return row.assertionState === "quarantined";
  return !DYNAMIC_CONFLICT_REASONS.has(row.quarantineReason);
}

function assertionProjection(row: AssertionRow): Record<string, unknown> {
  let attributes: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.variantAttributesJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attributes = parsed as Record<string, string>;
  } catch {
    attributes = {};
  }
  return {
    id: row.id,
    retailerId: row.retailerId,
    retailerSku: row.retailerSku,
    variantFingerprint: row.variantFingerprint,
    selectedOffer: {
      selectionState: row.selectedOfferState,
      childOfferKey: row.childOfferKey,
      attributes,
      fingerprint: row.selectedOfferFingerprint
    },
    observationKey: row.observationKey,
    availability: row.availability,
    unitPriceCents: row.unitPriceCents,
    currency: row.currency,
    sellerName: row.sellerName,
    sellerType: row.sellerType,
    fulfillment: row.fulfillment,
    locationScope: row.locationScope,
    observerVersion: row.observerVersion,
    layoutFingerprint: row.layoutFingerprint,
    assertionState: row.assertionState,
    quarantineReason: row.quarantineReason,
    evidenceHash: row.evidenceHash,
    observedAt: row.observedAt,
    receivedAt: row.receivedAt,
    expiresAt: row.expiresAt
  };
}

export class CommunityEvidenceRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  consents(): CommunityConsentStatus[] {
    const rows = this.db.all<ConsentRow>(
      `SELECT r.id AS retailerId, r.display_name AS retailerName,
              r.domains_json AS domainsJson, COALESCE(c.enabled, 0) AS enabled,
              COALESCE(c.location_scope, '') AS locationScope,
              COALESCE(c.privacy_version, '') AS privacyVersion,
              COALESCE(c.consented_at, '') AS consentedAt,
              COALESCE(c.revoked_at, '') AS revokedAt,
              COALESCE(c.updated_at, '') AS updatedAt
       FROM retailers r
       LEFT JOIN community_contribution_consents c
         ON c.retailer_id = r.id AND c.user_id = ?
       WHERE r.id IN (${Object.keys(RETAILER_OBSERVER_VERSIONS).map(() => "?").join(", ")})
       ORDER BY r.display_name`,
      currentRequestScope().userId,
      ...Object.keys(RETAILER_OBSERVER_VERSIONS)
    );
    return rows.map(consentFromRow);
  }

  updateConsent(input: CommunityConsentUpdateInput, now = Date.now()): CommunityConsentStatus {
    if (!input || typeof input !== "object" || !Object.hasOwn(RETAILER_OBSERVER_VERSIONS, input.retailerId)) {
      throw new InputValidationError("A supported retailer is required for community evidence consent.");
    }
    if (typeof input.enabled !== "boolean") throw new InputValidationError("Community evidence consent must be enabled or disabled explicitly.");
    const locationScope = input.enabled ? normalizedLocationScope(input.locationScope) : "";
    if (input.enabled && (input.privacyVersion !== COMMUNITY_PRIVACY_VERSION
      || input.confirmation !== COMMUNITY_CONTRIBUTION_CONFIRMATION)) {
      throw new InputValidationError("The current read-only community evidence disclosure must be explicitly accepted.");
    }
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO community_contribution_consents(
           tenant_id, user_id, retailer_id, enabled, location_scope,
           privacy_version, consented_at, revoked_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, retailer_id) DO UPDATE SET
           enabled = excluded.enabled,
           location_scope = excluded.location_scope,
           privacy_version = excluded.privacy_version,
           consented_at = CASE WHEN excluded.enabled = 1 THEN excluded.consented_at ELSE community_contribution_consents.consented_at END,
           revoked_at = CASE WHEN excluded.enabled = 0 THEN excluded.revoked_at ELSE '' END,
           updated_at = excluded.updated_at`,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        input.retailerId,
        input.enabled ? 1 : 0,
        locationScope,
        input.enabled ? COMMUNITY_PRIVACY_VERSION : "",
        input.enabled ? timestamp : "",
        input.enabled ? "" : timestamp,
        timestamp
      );
      this.audit.record({
        correlationId: `community_consent_${input.retailerId}`,
        aggregateType: "community_consent",
        eventType: input.enabled ? "community_contribution_enabled" : "community_contribution_disabled",
        reasonCode: input.enabled ? "explicit_opt_in" : "explicit_opt_out",
        message: input.enabled
          ? "Read-only community evidence sharing was enabled for one retailer."
          : "Read-only community evidence sharing was disabled for one retailer.",
        data: { retailerId: input.retailerId, locationScope }
      }, now);
    });
    const result = this.consents().find((item) => item.retailerId === input.retailerId);
    if (!result) throw new Error("The community consent state could not be read back.");
    return result;
  }

  issueNonce(deviceId: string, retailerId: SupportedRetailerId, now = Date.now()): { nonce: string; expiresAt: string } {
    const cleanDeviceId = cleanText(deviceId, 120);
    if (!Object.hasOwn(RETAILER_OBSERVER_VERSIONS, retailerId)) throw new InputValidationError("A supported retailer is required for a contribution nonce.");
    const device = this.db.get<{ id: string }>(
      "SELECT id FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
      cleanDeviceId,
      currentRequestScope().userId
    );
    if (!device) throw new InputValidationError("The paired Chrome device is unavailable.");
    const consent = this.consents().find((item) => item.retailerId === retailerId);
    if (!consent?.enabled) throw new InputValidationError("Enable read-only evidence sharing for this retailer in Yoink first.");
    const nonce = randomBytes(32).toString("base64url");
    const timestamp = nowIso(now);
    const expiresAt = nowIso(now + NONCE_TTL_MS);
    this.db.transaction(() => {
      this.db.run(
        `DELETE FROM community_contribution_nonces
         WHERE user_id = ? AND (expires_at < ? OR (used_at <> '' AND used_at < ?))`,
        currentRequestScope().userId,
        nowIso(now - 24 * 60 * 60_000),
        nowIso(now - 24 * 60 * 60_000)
      );
      this.db.run(
        `INSERT INTO community_contribution_nonces(
           id, tenant_id, user_id, device_id, retailer_id, nonce_hash,
           expires_at, used_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`,
        newId("community_nonce"),
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        cleanDeviceId,
        retailerId,
        nonceHash(nonce),
        expiresAt,
        timestamp
      );
    });
    return { nonce, expiresAt };
  }

  contribute(
    deviceId: string,
    retailerId: SupportedRetailerId,
    input: CommunityContributionInput,
    now = Date.now()
  ): { receipt: CommunityContributionReceipt; assertion: Record<string, unknown> } {
    const cleanDeviceId = cleanText(deviceId, 120);
    if (!Object.hasOwn(RETAILER_OBSERVER_VERSIONS, retailerId)) throw new InputValidationError("A supported retailer is required for a community contribution.");
    if (!input || typeof input !== "object" || input.contractVersion !== COMMUNITY_EVIDENCE_CONTRACT_VERSION) {
      throw new InputValidationError("The community evidence contract version is unsupported.");
    }
    const nonce = cleanText(input.nonce, 120);
    const shadowObservationId = cleanText(input.shadowObservationId, 120);
    const adapterDiagnosticId = cleanText(input.adapterDiagnosticId, 120);
    if (!NONCE_PATTERN.test(nonce) || !ID_PATTERN.test(shadowObservationId)
      || (adapterDiagnosticId && !ID_PATTERN.test(adapterDiagnosticId))) {
      throw new InputValidationError("The community contribution envelope is malformed.");
    }
    const timestamp = nowIso(now);
    const nonceRow = this.db.get<{ id: string }>(
      `SELECT id FROM community_contribution_nonces
       WHERE user_id = ? AND device_id = ? AND retailer_id = ?
         AND nonce_hash = ? AND used_at = '' AND expires_at >= ?`,
      currentRequestScope().userId,
      cleanDeviceId,
      retailerId,
      nonceHash(nonce),
      timestamp
    );
    if (!nonceRow) throw new InputValidationError("The community contribution nonce is invalid, expired, or already used.");
    const consent = this.consents().find((item) => item.retailerId === retailerId);
    if (!consent?.enabled || consent.privacyVersion !== COMMUNITY_PRIVACY_VERSION) {
      throw new InputValidationError("Read-only community evidence sharing is not enabled for this retailer.");
    }
    const observation = this.db.get<ObservationRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              retailer_sku AS retailerSku, adapter_version AS adapterVersion,
              availability, unit_price_cents AS unitPriceCents, currency,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              security_challenge AS securityChallenge,
              interactive_block AS interactiveBlock,
              observation_state AS observationState,
              selected_offer_schema_version AS selectedOfferSchemaVersion,
              selected_offer_state AS selectedOfferState,
              child_offer_key AS childOfferKey,
              variant_attributes_json AS variantAttributesJson,
              selected_offer_fingerprint AS selectedOfferFingerprint,
              evidence_hash AS evidenceHash, observed_at AS observedAt,
              received_at AS receivedAt
       FROM retailer_shadow_observations
       WHERE id = ? AND user_id = ? AND device_id = ? AND retailer_id = ?`,
      shadowObservationId,
      currentRequestScope().userId,
      cleanDeviceId,
      retailerId
    );
    const observedTime = new Date(observation?.observedAt ?? "").getTime();
    if (!observation || observation.adapterVersion !== RETAILER_OBSERVER_VERSIONS[retailerId]
      || !Number.isFinite(observedTime) || now - observedTime > MAX_OBSERVATION_AGE_MS || observedTime > now + 5 * 60_000) {
      throw new InputValidationError("A current server-accepted observation from this exact device and adapter is required.");
    }
    if (observation.securityChallenge === 1 || observation.interactiveBlock || observation.observationState === "manual_block") {
      throw new InputValidationError("Security challenges and interactive account steps cannot be contributed.");
    }
    if (!(["in_stock", "preorder", "out_of_stock"] as const).includes(observation.availability as "in_stock")) {
      throw new InputValidationError("Unknown availability cannot be contributed as community stock evidence.");
    }
    if (observation.fulfillment === "pickup" && !consent.locationScope.startsWith("store:")) {
      throw new InputValidationError("Pickup evidence requires a one-way store fingerprint in the consent location scope.");
    }
    let diagnostic: DiagnosticRow | undefined;
    if (retailerId !== "target") {
      if (!adapterDiagnosticId) throw new InputValidationError("A sanitized adapter diagnostic must accompany this contribution.");
      diagnostic = this.db.get<DiagnosticRow>(
        `SELECT id, retailer_id AS retailerId, retailer_sku AS retailerSku,
                adapter_version AS adapterVersion,
                layout_fingerprint AS layoutFingerprint, observed_at AS observedAt
         FROM retailer_adapter_diagnostics
         WHERE id = ? AND user_id = ? AND device_id = ? AND retailer_id = ?
           AND retailer_sku = ? AND operation = 'observe'`,
        adapterDiagnosticId,
        currentRequestScope().userId,
        cleanDeviceId,
        retailerId,
        observation.retailerSku
      );
      if (!diagnostic || diagnostic.adapterVersion !== observation.adapterVersion
        || Math.abs(new Date(diagnostic.observedAt).getTime() - observedTime) > 5_000) {
        throw new InputValidationError("The sanitized adapter diagnostic does not match the contributed observation.");
      }
    }
    const layoutFingerprint = diagnostic?.layoutFingerprint
      ?? stableHash("community-bundled-target-layout-v1", observation.adapterVersion);
    const selectedFingerprintValid = observation.selectedOfferSchemaVersion === 1
      && /^[a-f0-9]{64}$/.test(observation.selectedOfferFingerprint);
    const selectedOfferState = selectedFingerprintValid ? observation.selectedOfferState : "unresolved";
    const variantFingerprint = selectedFingerprintValid
      ? observation.selectedOfferFingerprint
      : stableHash("community-unresolved-selected-offer-v1", retailerId, observation.retailerSku, observation.id);
    const normalizedSeller = cleanText(observation.sellerName, 160).toLocaleLowerCase("en-US");
    const observationKey = stableHash(
      "community-observation-key-v2",
      retailerId,
      observation.retailerSku,
      variantFingerprint,
      observation.sellerType,
      normalizedSeller,
      observation.fulfillment,
      consent.locationScope
    );
    const evidenceHash = stableHash(
      "community-inventory-assertion-v1",
      observationKey,
      observation.availability,
      observation.unitPriceCents,
      observation.currency,
      observation.evidenceHash,
      layoutFingerprint
    );
    const hourCount = Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM community_inventory_assertions
       WHERE device_id = ? AND received_at >= ?`,
      cleanDeviceId,
      nowIso(now - 60 * 60_000)
    )?.count ?? 0);
    if (hourCount >= DEVICE_HOURLY_LIMIT) throw new InputValidationError("The device community contribution rate limit has been reached.");
    return this.db.transaction(() => {
      const consumed = this.db.run(
        "UPDATE community_contribution_nonces SET used_at = ? WHERE id = ? AND used_at = ''",
        timestamp,
        nonceRow.id
      );
      if (Number(consumed.changes) !== 1) throw new InputValidationError("The community contribution nonce is invalid, expired, or already used.");
      const duplicate = this.db.get<AssertionRow>(
        `SELECT id, user_id AS userId, device_id AS deviceId,
                retailer_id AS retailerId, retailer_sku AS retailerSku,
                variant_fingerprint AS variantFingerprint,
                selected_offer_state AS selectedOfferState,
                child_offer_key AS childOfferKey,
                variant_attributes_json AS variantAttributesJson,
                selected_offer_fingerprint AS selectedOfferFingerprint,
                observation_key AS observationKey, availability,
                unit_price_cents AS unitPriceCents, currency,
                seller_name AS sellerName, seller_type AS sellerType, fulfillment,
                location_scope AS locationScope, observer_version AS observerVersion,
                layout_fingerprint AS layoutFingerprint,
                assertion_state AS assertionState,
                quarantine_reason AS quarantineReason, evidence_hash AS evidenceHash,
                observed_at AS observedAt, received_at AS receivedAt,
                expires_at AS expiresAt
         FROM community_inventory_assertions
         WHERE user_id = ? AND device_id = ? AND observation_key = ?
           AND availability = ? AND unit_price_cents IS ? AND deleted_at = ''
           AND received_at >= ?
         ORDER BY received_at DESC, id DESC LIMIT 1`,
        currentRequestScope().userId,
        cleanDeviceId,
        observationKey,
        observation.availability,
        observation.unitPriceCents,
        nowIso(now - IDENTICAL_DEDUPE_MS)
      );
      if (duplicate) {
        const receipt = this.insertReceipt(cleanDeviceId, duplicate.id, "deduped", now);
        return { receipt, assertion: assertionProjection(duplicate) };
      }
      const activeRows = selectedOfferState === "exact" ? this.db.all<Pick<AssertionRow, "userId" | "availability" | "unitPriceCents">>(
        `SELECT a.user_id AS userId, a.availability,
                a.unit_price_cents AS unitPriceCents
         FROM community_inventory_assertions a
         JOIN extension_devices d ON d.id = a.device_id
         WHERE a.tenant_id = ? AND a.observation_key = ?
           AND a.user_id <> ? AND a.deleted_at = '' AND a.expires_at >= ?
           AND d.status = 'active' AND d.last_seen_at >= ?
         ORDER BY a.received_at DESC, a.id DESC`,
        currentRequestScope().tenantId,
        observationKey,
        currentRequestScope().userId,
        timestamp,
        nowIso(now - HEALTHY_DEVICE_WINDOW_MS)
      ) : [];
      const currentByUser = new Map<string, Pick<AssertionRow, "userId" | "availability" | "unitPriceCents">>();
      for (const row of activeRows) {
        if (!currentByUser.has(row.userId)) currentByUser.set(row.userId, row);
      }
      const active = [...currentByUser.values()];
      const availabilityConflict = active.some((row) => row.availability !== observation.availability);
      const priceConflict = active.some((row) => {
        if (row.unitPriceCents === null || observation.unitPriceCents === null) return false;
        const threshold = Math.max(500, Math.round(Math.min(row.unitPriceCents, observation.unitPriceCents) * 0.2));
        return Math.abs(row.unitPriceCents - observation.unitPriceCents) > threshold;
      });
      const identityQuarantine = selectedOfferState !== "exact";
      const assertionState = identityQuarantine || availabilityConflict || priceConflict ? "quarantined" : "accepted";
      const quarantineReason = identityQuarantine
        ? selectedOfferState === "listing_only" ? "selected_offer_listing_only" : "selected_offer_unresolved"
        : availabilityConflict ? "availability_conflict" : priceConflict ? "price_conflict" : "";
      const assertionId = newId("community_assertion");
      const expiresAt = nowIso(now + (observation.availability === "out_of_stock" ? OUT_OF_STOCK_TTL_MS : IN_STOCK_TTL_MS));
      this.db.run(
        `INSERT INTO community_inventory_assertions(
           id, tenant_id, user_id, device_id, shadow_observation_id,
           adapter_diagnostic_id, retailer_id, retailer_sku, variant_fingerprint,
           selected_offer_state, child_offer_key, variant_attributes_json,
           selected_offer_fingerprint,
           observation_key, availability, unit_price_cents, currency,
           seller_name, seller_type, fulfillment, location_scope,
           observer_version, layout_fingerprint, assertion_state,
           quarantine_reason, evidence_hash, observed_at, received_at,
           expires_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
        assertionId,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        cleanDeviceId,
        observation.id,
        diagnostic?.id ?? "",
        retailerId,
        observation.retailerSku,
        variantFingerprint,
        selectedOfferState,
        selectedFingerprintValid ? observation.childOfferKey : "",
        selectedFingerprintValid ? observation.variantAttributesJson : "{}",
        selectedFingerprintValid ? observation.selectedOfferFingerprint : "",
        observationKey,
        observation.availability,
        observation.unitPriceCents,
        observation.currency,
        cleanText(observation.sellerName, 160),
        observation.sellerType,
        observation.fulfillment,
        consent.locationScope,
        observation.adapterVersion,
        layoutFingerprint,
        assertionState,
        quarantineReason,
        evidenceHash,
        observation.observedAt,
        timestamp,
        expiresAt
      );
      this.db.run(
        `DELETE FROM community_inventory_assertions
         WHERE user_id = ? AND id NOT IN (
           SELECT id FROM community_inventory_assertions
           WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?
         )`,
        currentRequestScope().userId,
        currentRequestScope().userId,
        RETENTION_LIMIT
      );
      const stored = this.assertion(assertionId);
      if (!stored) throw new Error("The community assertion could not be read back.");
      const receipt = this.insertReceipt(
        cleanDeviceId,
        assertionId,
        assertionState === "quarantined" ? "quarantined" : "accepted",
        now
      );
      this.audit.record({
        correlationId: assertionId,
        aggregateType: "community_inventory_assertion",
        eventType: "community_inventory_assertion_recorded",
        reasonCode: assertionState,
        message: assertionState === "quarantined"
          ? "A read-only inventory assertion was quarantined after a material conflict."
          : "A read-only inventory assertion was accepted into the private community pilot ledger.",
        data: {
          retailerId,
          retailerSku: observation.retailerSku,
          observationKey,
          assertionState,
          quarantineReason,
          expiresAt
        }
      }, now);
      return { receipt, assertion: assertionProjection(stored) };
    });
  }

  listRecent(limit = 100): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
    return this.db.all<AssertionRow>(
      `SELECT id, user_id AS userId, device_id AS deviceId,
              retailer_id AS retailerId, retailer_sku AS retailerSku,
              variant_fingerprint AS variantFingerprint,
              selected_offer_state AS selectedOfferState,
              child_offer_key AS childOfferKey,
              variant_attributes_json AS variantAttributesJson,
              selected_offer_fingerprint AS selectedOfferFingerprint,
              observation_key AS observationKey, availability,
              unit_price_cents AS unitPriceCents, currency,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              location_scope AS locationScope, observer_version AS observerVersion,
              layout_fingerprint AS layoutFingerprint,
              assertion_state AS assertionState,
              quarantine_reason AS quarantineReason, evidence_hash AS evidenceHash,
              observed_at AS observedAt, received_at AS receivedAt,
              expires_at AS expiresAt
       FROM community_inventory_assertions
       WHERE user_id = ? AND deleted_at = ''
       ORDER BY received_at DESC, id DESC LIMIT ?`,
      currentRequestScope().userId,
      safeLimit
    ).map(assertionProjection);
  }

  aggregates(now = Date.now()): Array<Record<string, unknown>> {
    const rows = this.db.all<AssertionRow>(
      `SELECT a.id, a.user_id AS userId, a.device_id AS deviceId,
              a.retailer_id AS retailerId, a.retailer_sku AS retailerSku,
              a.variant_fingerprint AS variantFingerprint,
              a.selected_offer_state AS selectedOfferState,
              a.child_offer_key AS childOfferKey,
              a.variant_attributes_json AS variantAttributesJson,
              a.selected_offer_fingerprint AS selectedOfferFingerprint,
              a.observation_key AS observationKey, a.availability,
              a.unit_price_cents AS unitPriceCents, a.currency,
              a.seller_name AS sellerName, a.seller_type AS sellerType,
              a.fulfillment, a.location_scope AS locationScope,
              a.observer_version AS observerVersion,
              a.layout_fingerprint AS layoutFingerprint,
              a.assertion_state AS assertionState,
              a.quarantine_reason AS quarantineReason,
              a.evidence_hash AS evidenceHash, a.observed_at AS observedAt,
              a.received_at AS receivedAt, a.expires_at AS expiresAt,
              d.status AS deviceStatus, d.last_seen_at AS deviceLastSeenAt
       FROM community_inventory_assertions a
       JOIN extension_devices d ON d.id = a.device_id
       WHERE a.tenant_id = ? AND a.deleted_at = '' AND a.expires_at >= ?
       ORDER BY a.received_at DESC, a.id DESC`,
      currentRequestScope().tenantId,
      nowIso(now)
    );
    const groups = new Map<string, AssertionRow[]>();
    for (const row of rows) groups.set(row.observationKey, [...(groups.get(row.observationKey) ?? []), row]);
    return [...groups.values()].slice(0, 200).map((group) => {
      const eligible = group.filter((row) => {
        const lastSeenAt = new Date(row.deviceLastSeenAt ?? "").getTime();
        return row.deviceStatus === "active" && Number.isFinite(lastSeenAt)
          && now - lastSeenAt <= HEALTHY_DEVICE_WINDOW_MS;
      });
      const currentByUser = new Map<string, AssertionRow>();
      for (const row of eligible) {
        if (!currentByUser.has(row.userId)) currentByUser.set(row.userId, row);
      }
      const currentVotes = [...currentByUser.values()];
      const latest = currentVotes[0] ?? group[0] as AssertionRow;
      const devices = new Set(currentVotes.map((row) => row.deviceId));
      const users = new Set(currentVotes.map((row) => row.userId));
      const availabilities = new Set(currentVotes.map((row) => row.availability));
      const prices = currentVotes
        .map((row) => row.unitPriceCents)
        .filter((value): value is number => Number.isSafeInteger(value));
      const priceMinimum = prices.length ? Math.min(...prices) : null;
      const priceMaximum = prices.length ? Math.max(...prices) : null;
      const priceSpread = priceMinimum === null || priceMaximum === null ? 0 : priceMaximum - priceMinimum;
      const priceConflict = prices.length > 1 && priceMinimum !== null
        && priceSpread > Math.max(500, Math.round(priceMinimum * 0.2));
      const conflict = currentVotes.some(hasHardQuarantine) || availabilities.size > 1 || priceConflict;
      const hasEligibleVotes = currentVotes.length > 0;
      const quorumMet = hasEligibleVotes && !conflict && users.size >= 3 && devices.size >= 3;
      const priceQuorumMet = !conflict && prices.length >= 3;
      const confidence = conflict || !hasEligibleVotes ? 0 : Math.min(1, currentVotes.length / 3);
      const priceConfidence = conflict || !prices.length ? 0 : Math.min(1, prices.length / 3);
      return {
        observationKey: latest.observationKey,
        retailerId: latest.retailerId,
        retailerSku: latest.retailerSku,
        variantFingerprint: latest.variantFingerprint,
        selectedOffer: (assertionProjection(latest).selectedOffer as Record<string, unknown>),
        sellerName: latest.sellerName,
        sellerType: latest.sellerType,
        fulfillment: latest.fulfillment,
        locationScope: latest.locationScope,
        availability: conflict || !hasEligibleVotes ? "unknown" : latest.availability,
        unitPriceCents: priceQuorumMet ? medianPrice(prices) : null,
        currency: latest.currency,
        assertionCount: group.length,
        eligibleAssertionCount: eligible.length,
        currentContributorVoteCount: currentVotes.length,
        supersededAssertionCount: Math.max(0, eligible.length - currentVotes.length),
        ineligibleAssertionCount: Math.max(0, group.length - eligible.length),
        independentDeviceCount: devices.size,
        independentUserCount: users.size,
        distinctLayoutCount: new Set(currentVotes.map((row) => row.layoutFingerprint)).size,
        distinctObserverVersionCount: new Set(currentVotes.map((row) => row.observerVersion)).size,
        contributorVotePolicy: "latest_eligible_per_user",
        priceProjectionMethod: "median",
        priceVoteCount: prices.length,
        priceQuorumMet,
        priceMinimumCents: priceMinimum,
        priceMaximumCents: priceMaximum,
        priceSpreadCents: priceSpread,
        advisoryOnly: true,
        mutationAuthority: false,
        conflict,
        publicationState: conflict
          ? "quarantined"
          : quorumMet ? "advisory" : hasEligibleVotes ? "insufficient_quorum" : "insufficient_eligible_evidence",
        confidence: {
          identity: latest.selectedOfferState === "exact" ? 1 : 0,
          availability: confidence,
          price: priceConfidence,
          seller: latest.sellerType === "unknown" ? 0 : confidence,
          fulfillment: latest.fulfillment === "unknown" ? 0 : confidence
        },
        expiresAt: currentVotes.length
          ? currentVotes.reduce((value, row) => value < row.expiresAt ? value : row.expiresAt, latest.expiresAt)
          : latest.expiresAt
      };
    });
  }

  deleteContributions(retailerId = "", now = Date.now()): { deletedAssertions: number; deletedReceipts: number } {
    const cleanRetailer = cleanText(retailerId, 40).toLocaleLowerCase("en-US");
    if (cleanRetailer && !Object.hasOwn(RETAILER_OBSERVER_VERSIONS, cleanRetailer)) {
      throw new InputValidationError("A supported retailer is required for community evidence deletion.");
    }
    return this.db.transaction(() => {
      const filter = cleanRetailer ? " AND retailer_id = ?" : "";
      const params = cleanRetailer ? [currentRequestScope().userId, cleanRetailer] : [currentRequestScope().userId];
      const assertionIds = this.db.all<{ id: string }>(
        `SELECT id FROM community_inventory_assertions WHERE user_id = ?${filter}`,
        ...params
      ).map((row) => row.id);
      const deletedReceipts = assertionIds.length
        ? Number(this.db.get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM community_contribution_receipts
           WHERE assertion_id IN (${assertionIds.map(() => "?").join(", ")})`,
          ...assertionIds
        )?.count ?? 0)
        : 0;
      const deleted = this.db.run(
        `DELETE FROM community_inventory_assertions WHERE user_id = ?${filter}`,
        ...params
      );
      this.db.run(
        `DELETE FROM community_contribution_nonces WHERE user_id = ?${filter}`,
        ...params
      );
      const deletedAssertions = Number(deleted.changes);
      this.audit.record({
        correlationId: cleanRetailer ? `community_delete_${cleanRetailer}` : "community_delete_all",
        aggregateType: "community_inventory_assertion",
        eventType: "community_contributions_deleted",
        reasonCode: "user_deletion",
        message: "Read-only community evidence contributions were deleted at the user's request.",
        data: { retailerId: cleanRetailer, deletedAssertions, deletedReceipts }
      }, now);
      return { deletedAssertions, deletedReceipts };
    });
  }

  counts(now = Date.now()): Record<string, number> {
    const row = this.db.get<{
      enabledDomains: number;
      assertions: number;
      activeAssertions: number;
      quarantinedAssertions: number;
      receipts: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM community_contribution_consents WHERE user_id = ? AND enabled = 1) AS enabledDomains,
        (SELECT COUNT(*) FROM community_inventory_assertions WHERE user_id = ? AND deleted_at = '') AS assertions,
        (SELECT COUNT(*) FROM community_inventory_assertions WHERE user_id = ? AND deleted_at = '' AND expires_at >= ?) AS activeAssertions,
        (SELECT COUNT(*) FROM community_inventory_assertions WHERE user_id = ? AND deleted_at = '' AND assertion_state = 'quarantined') AS quarantinedAssertions,
        (SELECT COUNT(*) FROM community_contribution_receipts WHERE user_id = ?) AS receipts`,
      currentRequestScope().userId,
      currentRequestScope().userId,
      currentRequestScope().userId,
      nowIso(now),
      currentRequestScope().userId,
      currentRequestScope().userId
    );
    return {
      communityEnabledDomains: Number(row?.enabledDomains ?? 0),
      communityAssertions: Number(row?.assertions ?? 0),
      communityActiveAssertions: Number(row?.activeAssertions ?? 0),
      communityQuarantinedAssertions: Number(row?.quarantinedAssertions ?? 0),
      communityContributionReceipts: Number(row?.receipts ?? 0)
    };
  }

  private assertion(id: string): AssertionRow | undefined {
    return this.db.get<AssertionRow>(
      `SELECT id, user_id AS userId, device_id AS deviceId,
              retailer_id AS retailerId, retailer_sku AS retailerSku,
              variant_fingerprint AS variantFingerprint,
              selected_offer_state AS selectedOfferState,
              child_offer_key AS childOfferKey,
              variant_attributes_json AS variantAttributesJson,
              selected_offer_fingerprint AS selectedOfferFingerprint,
              observation_key AS observationKey, availability,
              unit_price_cents AS unitPriceCents, currency,
              seller_name AS sellerName, seller_type AS sellerType, fulfillment,
              location_scope AS locationScope, observer_version AS observerVersion,
              layout_fingerprint AS layoutFingerprint,
              assertion_state AS assertionState,
              quarantine_reason AS quarantineReason, evidence_hash AS evidenceHash,
              observed_at AS observedAt, received_at AS receivedAt,
              expires_at AS expiresAt
       FROM community_inventory_assertions WHERE id = ? AND user_id = ?`,
      id,
      currentRequestScope().userId
    );
  }

  private insertReceipt(
    deviceId: string,
    assertionId: string,
    disposition: CommunityContributionReceipt["disposition"],
    now: number
  ): CommunityContributionReceipt {
    const id = newId("community_receipt");
    const createdAt = nowIso(now);
    const receiptHash = stableHash("community-contribution-receipt-v1", id, assertionId, deviceId, disposition, createdAt);
    this.db.run(
      `INSERT INTO community_contribution_receipts(
         id, tenant_id, user_id, device_id, assertion_id,
         disposition, receipt_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      deviceId,
      assertionId,
      disposition,
      receiptHash,
      createdAt
    );
    return { id, assertionId, disposition, receiptHash, createdAt };
  }
}
