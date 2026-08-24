import {
  IDENTITY_CLAIM_CONFIRMATION,
  IDENTITY_CLAIM_CONTRACT_VERSION,
  IDENTITY_CLAIM_REVIEW_CONFIRMATION,
  IDENTITY_IDENTIFIER_KINDS,
  type IdentityClaimInput,
  type IdentityClaimReviewInput,
  type IdentityIdentifierKind,
  type IdentityVariantAttributesInput
} from "../../contracts/src/index.js";
import type { SQLInputValue } from "node:sqlite";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const IDENTIFIER_KINDS = new Set(IDENTITY_IDENTIFIER_KINDS);
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const PROVENANCE_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const ATTRIBUTE_KEYS = new Set(["size", "color", "edition", "language", "packCount", "condition"]);
const CONDITIONS = new Set(["new", "used", "refurbished", "collectible", "unknown"]);

interface ListingRow {
  id: string;
  variantId: string;
  retailerId: string;
  retailerSku: string;
  title: string;
  attributesJson: string;
}

interface ClaimRow {
  id: string;
  userId: string;
  proposerDeviceId: string;
  listingId: string;
  listingRetailerId: string;
  listingRetailerSku: string;
  listingTitle: string;
  referenceListingId: string;
  referenceRetailerId: string;
  referenceRetailerSku: string;
  referenceTitle: string;
  currentVariantId: string;
  claimedVariantId: string;
  identifierKind: IdentityIdentifierKind;
  normalizedIdentifier: string;
  identifierHash: string;
  variantFingerprint: string;
  attributesJson: string;
  provenanceKind: string;
  provenanceNote: string;
  claimState: "pending_review" | "quarantined" | "reviewed" | "rejected";
  conflictReason: string;
  claimHash: string;
  reviewedAt: string;
  updatedAt: string;
  createdAt: string;
  deviceStatus?: string;
  deviceLastSeenAt?: string;
}

function validGtin(value: string): boolean {
  if (!/^\d+$/.test(value) || ![8, 12, 13, 14].includes(value.length)) return false;
  const digits = [...value].map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += (digits[index] as number) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

function validIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  const total = [...value].reduce((sum, character, index) => {
    const digit = character === "X" ? 10 : Number(character);
    return sum + digit * (10 - index);
  }, 0);
  return total % 11 === 0;
}

function normalizedIdentifier(
  kind: IdentityIdentifierKind,
  value: unknown,
  brandValue: unknown,
  mpnValue: unknown
): string {
  if (kind === "brand_mpn") {
    const brand = cleanText(brandValue, 80).toLocaleUpperCase("en-US");
    const mpn = cleanText(mpnValue, 80).toLocaleUpperCase("en-US");
    if (!brand || !mpn || !/^[A-Z0-9][A-Z0-9 .&'/_-]{0,79}$/.test(brand)
      || !/^[A-Z0-9][A-Z0-9 ./_-]{0,79}$/.test(mpn)) {
      throw new Error("Brand plus MPN claims require exact bounded brand and manufacturer-part values.");
    }
    return `BRAND:${brand}|MPN:${mpn}`;
  }
  const compact = cleanText(value, 40).toLocaleUpperCase("en-US").replace(/[\s-]/g, "");
  const valid = kind === "upc" ? compact.length === 12 && validGtin(compact)
    : kind === "ean" ? compact.length === 13 && validGtin(compact)
      : kind === "gtin" ? validGtin(compact)
        : kind === "isbn" ? validIsbn10(compact) || (compact.length === 13 && validGtin(compact))
          : false;
  if (!valid) throw new Error(`The exact ${kind.toUpperCase()} identifier and check digit are invalid.`);
  return compact;
}

function normalizedAttributes(value: IdentityVariantAttributesInput | undefined): Record<string, string | number> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !ATTRIBUTE_KEYS.has(key))) {
    throw new Error("Identity claim variant attributes contain an unsupported field.");
  }
  const result: Record<string, string | number> = {};
  for (const key of ["size", "color", "edition", "language"] as const) {
    const normalized = cleanText(value[key], 80);
    if (normalized) result[key] = normalized.toLocaleLowerCase("en-US");
  }
  if (value.packCount !== undefined) {
    const packCount = Number(value.packCount);
    if (!Number.isInteger(packCount) || packCount < 1 || packCount > 999) {
      throw new Error("Identity claim pack count must be an integer from 1 through 999.");
    }
    result.packCount = packCount;
  }
  if (value.condition !== undefined) {
    if (!CONDITIONS.has(value.condition)) throw new Error("Identity claim condition is unsupported.");
    result.condition = value.condition;
  }
  return result;
}

function parsedAttributes(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function attributeConflict(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return [...ATTRIBUTE_KEYS].some((key) => left[key] !== undefined && right[key] !== undefined
    && String(left[key]).toLocaleLowerCase("en-US") !== String(right[key]).toLocaleLowerCase("en-US"));
}

function claimProjection(row: ClaimRow): Record<string, unknown> {
  return {
    id: row.id,
    listingId: row.listingId,
    listingRetailerId: row.listingRetailerId,
    listingRetailerSku: row.listingRetailerSku,
    listingTitle: row.listingTitle,
    referenceListingId: row.referenceListingId,
    referenceRetailerId: row.referenceRetailerId,
    referenceRetailerSku: row.referenceRetailerSku,
    referenceTitle: row.referenceTitle,
    currentVariantId: row.currentVariantId,
    claimedVariantId: row.claimedVariantId,
    identifierKind: row.identifierKind,
    normalizedIdentifier: row.normalizedIdentifier,
    identifierHash: row.identifierHash,
    variantFingerprint: row.variantFingerprint,
    attributes: parsedAttributes(row.attributesJson),
    provenanceKind: row.provenanceKind,
    provenanceNote: row.provenanceNote,
    claimState: row.claimState,
    conflictReason: row.conflictReason,
    claimHash: row.claimHash,
    reviewedAt: row.reviewedAt,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt
  };
}

export class IdentityClaimRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  create(input: IdentityClaimInput, now = Date.now()): Record<string, unknown> {
    if (!input || typeof input !== "object" || input.contractVersion !== IDENTITY_CLAIM_CONTRACT_VERSION
      || input.confirmation !== IDENTITY_CLAIM_CONFIRMATION) {
      throw new Error("An explicitly confirmed identity-claim contract is required.");
    }
    const listingId = cleanText(input.listingId, 120);
    const referenceListingId = cleanText(input.referenceListingId, 120);
    if (!ID_PATTERN.test(listingId) || !ID_PATTERN.test(referenceListingId) || listingId === referenceListingId) {
      throw new Error("Two different exact catalog listings are required for an equivalence claim.");
    }
    if (!IDENTIFIER_KINDS.has(input.identifierKind)) throw new Error("An exact supported identifier kind is required.");
    const listing = this.listing(listingId);
    const reference = this.listing(referenceListingId);
    if (!listing || !reference) throw new Error("Both exact catalog listings must exist before proposing equivalence.");
    if (listing.retailerId === reference.retailerId) {
      throw new Error("Cross-retailer equivalence claims require listings from two different retailers.");
    }
    if (listing.variantId === reference.variantId) throw new Error("These listings already resolve to the same catalog variant.");
    const identifier = normalizedIdentifier(input.identifierKind, input.identifierValue, input.brand, input.mpn);
    const attributes = normalizedAttributes(input.attributes);
    const attributesJson = JSON.stringify(attributes);
    const identifierHash = stableHash("identity-exact-identifier-v1", input.identifierKind, identifier);
    const variantFingerprint = stableHash("identity-selected-variant-v1", identifierHash, attributesJson);
    const provenanceNote = cleanText(input.provenanceNote || "manual_catalog_review", 80).toLocaleLowerCase("en-US");
    if (!PROVENANCE_PATTERN.test(provenanceNote)) throw new Error("Identity claim provenance must be a short non-sensitive reason code.");

    let conflictReason = "";
    const identifierRows = this.db.all<{ variantId: string; kind: string; value: string }>(
      "SELECT variant_id AS variantId, kind, value FROM identifiers WHERE lower(kind) = ?",
      input.identifierKind
    );
    for (const row of identifierRows) {
      let existing = "";
      try { existing = normalizedIdentifier(input.identifierKind, row.value, "", ""); } catch { continue; }
      if (existing === identifier && row.variantId !== reference.variantId) {
        conflictReason = "identifier_maps_to_other_variant";
        break;
      }
    }
    if (!conflictReason && attributeConflict(parsedAttributes(listing.attributesJson), parsedAttributes(reference.attributesJson))) {
      conflictReason = "catalog_variant_attributes_conflict";
    }
    const priorConflict = this.db.get<{ id: string }>(
      `SELECT id FROM identity_equivalence_claims
       WHERE tenant_id = ? AND listing_id = ? AND identifier_hash = ?
         AND claimed_variant_id <> ? AND claim_state IN ('pending_review', 'reviewed', 'quarantined')
       LIMIT 1`,
      currentRequestScope().tenantId,
      listing.id,
      identifierHash,
      reference.variantId
    );
    if (!conflictReason && priorConflict) conflictReason = "competing_equivalence_claim";
    const claimState = conflictReason ? "quarantined" : "pending_review";
    const createdAt = nowIso(now);
    const id = newId("identity_claim");
    const claimHash = stableHash(
      "identity-equivalence-claim-v1",
      listing.id,
      reference.id,
      listing.variantId,
      reference.variantId,
      identifierHash,
      variantFingerprint,
      claimState,
      conflictReason
    );
    return this.db.transaction(() => {
      const existing = this.db.get<{ id: string }>(
        `SELECT id FROM identity_equivalence_claims
         WHERE user_id = ? AND listing_id = ? AND reference_listing_id = ?
           AND identifier_hash = ? AND variant_fingerprint = ?`,
        currentRequestScope().userId,
        listing.id,
        reference.id,
        identifierHash,
        variantFingerprint
      );
      if (existing) {
        const stored = this.claim(existing.id);
        if (!stored) throw new Error("The existing identity claim could not be read back.");
        return claimProjection(stored);
      }
      this.db.run(
        `INSERT INTO identity_equivalence_claims(
           id, tenant_id, user_id, proposer_device_id, listing_id,
           reference_listing_id, current_variant_id, claimed_variant_id,
           identifier_kind, normalized_identifier, identifier_hash,
           variant_fingerprint, attributes_json, provenance_kind,
           provenance_note, claim_state, conflict_reason, claim_hash,
           reviewed_at, updated_at, created_at
         ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'manual_exact_identifier', ?, ?, ?, ?, '', ?, ?)`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        listing.id,
        reference.id,
        listing.variantId,
        reference.variantId,
        input.identifierKind,
        identifier,
        identifierHash,
        variantFingerprint,
        attributesJson,
        provenanceNote,
        claimState,
        conflictReason,
        claimHash,
        createdAt,
        createdAt
      );
      this.audit.record({
        correlationId: id,
        aggregateType: "identity_equivalence_claim",
        eventType: "identity_equivalence_claim_created",
        reasonCode: claimState,
        message: conflictReason
          ? "An exact-identifier equivalence claim was quarantined without changing catalog identity."
          : "An exact-identifier equivalence claim was recorded for review without changing catalog identity.",
        data: { listingId, referenceListingId, identifierKind: input.identifierKind, claimState, conflictReason }
      }, now);
      const stored = this.claim(id);
      if (!stored) throw new Error("The identity claim could not be read back.");
      return claimProjection(stored);
    });
  }

  review(id: string, input: IdentityClaimReviewInput, now = Date.now()): Record<string, unknown> {
    const claimId = cleanText(id, 120);
    if (!ID_PATTERN.test(claimId) || !input || typeof input !== "object"
      || input.confirmation !== IDENTITY_CLAIM_REVIEW_CONFIRMATION
      || !["reviewed", "rejected"].includes(input.outcome)) {
      throw new Error("An explicit non-remapping identity review is required.");
    }
    const claim = this.claim(claimId);
    if (!claim || claim.userId !== currentRequestScope().userId) throw new Error("The identity claim was not found.");
    if (["reviewed", "rejected"].includes(claim.claimState)) throw new Error("The identity claim already has a terminal local review.");
    if (input.outcome === "reviewed" && claim.claimState === "quarantined") {
      throw new Error("A conflicting identity claim cannot be approved; reject it or correct the catalog evidence first.");
    }
    const note = cleanText(input.note || (input.outcome === "reviewed" ? "exact_identifier_checked" : "claim_rejected"), 80)
      .toLocaleLowerCase("en-US");
    if (!PROVENANCE_PATTERN.test(note)) throw new Error("Identity review notes must be short non-sensitive reason codes.");
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      const reviewId = newId("identity_review");
      const reviewHash = stableHash("identity-claim-review-v1", reviewId, claim.id, input.outcome, note, timestamp);
      this.db.run(
        `INSERT INTO identity_claim_reviews(
           id, tenant_id, user_id, claim_id, outcome, note, review_hash, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        reviewId,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        claim.id,
        input.outcome,
        note,
        reviewHash,
        timestamp
      );
      this.db.run(
        "UPDATE identity_equivalence_claims SET claim_state = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
        input.outcome,
        timestamp,
        timestamp,
        claim.id
      );
      this.audit.record({
        correlationId: claim.id,
        aggregateType: "identity_equivalence_claim",
        eventType: "identity_equivalence_claim_reviewed",
        reasonCode: input.outcome,
        message: "The local claim review was recorded; catalog mappings and missions were not changed.",
        data: { claimId: claim.id, outcome: input.outcome, note }
      }, now);
      const stored = this.claim(claim.id);
      if (!stored) throw new Error("The reviewed identity claim could not be read back.");
      return claimProjection(stored);
    });
  }

  list(limit = 100): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
    return this.claimRows(
      `WHERE c.user_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
      currentRequestScope().userId,
      safeLimit
    ).map(claimProjection);
  }

  projections(now = Date.now()): Array<Record<string, unknown>> {
    const rows = this.claimRows(
      `WHERE c.tenant_id = ? AND c.claim_state <> 'rejected'
       ORDER BY c.created_at DESC, c.id DESC`,
      currentRequestScope().tenantId
    );
    const groups = new Map<string, ClaimRow[]>();
    for (const row of rows) {
      const key = `${row.listingId}:${row.claimedVariantId}:${row.identifierHash}:${row.variantFingerprint}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.values()].slice(0, 200).map((group) => {
      const latest = group[0] as ClaimRow;
      const users = new Set(group.map((row) => row.userId));
      const healthyDevices = new Set(group.filter((row) => row.proposerDeviceId
        && row.deviceStatus === "active"
        && now - new Date(row.deviceLastSeenAt ?? "").getTime() <= 24 * 60 * 60_000)
        .map((row) => row.proposerDeviceId));
      const conflict = group.some((row) => row.claimState === "quarantined");
      const allReviewed = group.length > 0 && group.every((row) => row.claimState === "reviewed");
      const siblingAvailabilityEligible = !conflict && allReviewed && users.size >= 3 && healthyDevices.size >= 3;
      return {
        listingId: latest.listingId,
        listingRetailerId: latest.listingRetailerId,
        listingRetailerSku: latest.listingRetailerSku,
        referenceListingId: latest.referenceListingId,
        referenceRetailerId: latest.referenceRetailerId,
        referenceRetailerSku: latest.referenceRetailerSku,
        claimedVariantId: latest.claimedVariantId,
        identifierKind: latest.identifierKind,
        identifierHash: latest.identifierHash,
        variantFingerprint: latest.variantFingerprint,
        claimCount: group.length,
        independentUserCount: users.size,
        healthyPairedDeviceCount: healthyDevices.size,
        conflict,
        publicationState: conflict ? "quarantined"
          : siblingAvailabilityEligible ? "validated_equivalence"
            : allReviewed ? "reviewed_insufficient_quorum" : "insufficient_quorum",
        siblingAvailabilityEligible,
        catalogRemapped: false
      };
    });
  }

  deleteClaims(now = Date.now()): { deletedClaims: number; deletedReviews: number } {
    return this.db.transaction(() => {
      const deletedReviews = Number(this.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM identity_claim_reviews r
         JOIN identity_equivalence_claims c ON c.id = r.claim_id WHERE c.user_id = ?`,
        currentRequestScope().userId
      )?.count ?? 0);
      const result = this.db.run("DELETE FROM identity_equivalence_claims WHERE user_id = ?", currentRequestScope().userId);
      const deletedClaims = Number(result.changes);
      this.audit.record({
        correlationId: "identity_claims_delete_all",
        aggregateType: "identity_equivalence_claim",
        eventType: "identity_equivalence_claims_deleted",
        reasonCode: "user_deletion",
        message: "Identity equivalence claims and their reviews were physically deleted at the user's request.",
        data: { deletedClaims, deletedReviews }
      }, now);
      return { deletedClaims, deletedReviews };
    });
  }

  counts(): Record<string, number> {
    const row = this.db.get<{ claims: number; quarantined: number; reviewed: number }>(
      `SELECT COUNT(*) AS claims,
              SUM(CASE WHEN claim_state = 'quarantined' THEN 1 ELSE 0 END) AS quarantined,
              SUM(CASE WHEN claim_state = 'reviewed' THEN 1 ELSE 0 END) AS reviewed
       FROM identity_equivalence_claims WHERE user_id = ?`,
      currentRequestScope().userId
    );
    return {
      identityClaims: Number(row?.claims ?? 0),
      quarantinedIdentityClaims: Number(row?.quarantined ?? 0),
      reviewedIdentityClaims: Number(row?.reviewed ?? 0)
    };
  }

  private listing(id: string): ListingRow | undefined {
    return this.db.get<ListingRow>(
      `SELECT l.id, l.variant_id AS variantId, l.retailer_id AS retailerId,
              l.retailer_sku AS retailerSku, v.title, v.attributes_json AS attributesJson
       FROM listings l JOIN variants v ON v.id = l.variant_id WHERE l.id = ?`,
      id
    );
  }

  private claim(id: string): ClaimRow | undefined {
    return this.claimRows("WHERE c.id = ?", id)[0];
  }

  private claimRows(suffix: string, ...parameters: SQLInputValue[]): ClaimRow[] {
    return this.db.all<ClaimRow>(
      `SELECT c.id, c.user_id AS userId, c.proposer_device_id AS proposerDeviceId,
              c.listing_id AS listingId, l.retailer_id AS listingRetailerId,
              l.retailer_sku AS listingRetailerSku, lv.title AS listingTitle,
              c.reference_listing_id AS referenceListingId,
              rl.retailer_id AS referenceRetailerId,
              rl.retailer_sku AS referenceRetailerSku, rv.title AS referenceTitle,
              c.current_variant_id AS currentVariantId,
              c.claimed_variant_id AS claimedVariantId,
              c.identifier_kind AS identifierKind,
              c.normalized_identifier AS normalizedIdentifier,
              c.identifier_hash AS identifierHash,
              c.variant_fingerprint AS variantFingerprint,
              c.attributes_json AS attributesJson,
              c.provenance_kind AS provenanceKind,
              c.provenance_note AS provenanceNote,
              c.claim_state AS claimState, c.conflict_reason AS conflictReason,
              c.claim_hash AS claimHash, c.reviewed_at AS reviewedAt,
              c.updated_at AS updatedAt, c.created_at AS createdAt,
              d.status AS deviceStatus, d.last_seen_at AS deviceLastSeenAt
       FROM identity_equivalence_claims c
       JOIN listings l ON l.id = c.listing_id
       JOIN variants lv ON lv.id = c.current_variant_id
       JOIN listings rl ON rl.id = c.reference_listing_id
       JOIN variants rv ON rv.id = c.claimed_variant_id
       LEFT JOIN extension_devices d ON d.id = c.proposer_device_id
       ${suffix}`,
      ...parameters
    );
  }
}
