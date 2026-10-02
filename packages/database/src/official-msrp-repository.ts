import { MSRP_GUARDED_RETAILERS, OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS, type OfficialMsrpAuthorization } from "../../contracts/src/official-msrp.js";
import { SELECTED_OFFER_ATTRIBUTE_KEYS, type NormalizedSignal, type PurchaseIntentPolicyTarget } from "../../contracts/src/index.js";
import { canonicalRetailerUrl } from "../../domain/src/attribution.js";
import { DomainConflictError } from "../../domain/src/domain-request-error.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const MAX_REVIEW_AGE_MS = 30 * 24 * 60 * 60_000;
const CONFIRM = "RECORD_OFFICIAL_MSRP_FOR_EXACT_VARIANT";
const RESTRICTED = /\b(?:gift\s*card|prepaid|stored[- ]value|lottery|tobacco|nicotine|vape|ammunition|firearm|alcohol|cannabis)\b/i;
interface ListingIdentity {
  listingId: string; retailerId: string; retailerSku: string; canonicalUrl: string;
  variantId: string; title: string; attributesJson: string;
}
export interface OfficialMsrpEvidence {
  id: string; revision: number; listingId: string; identityHash: string; evidenceHash: string;
  desiredVariant: string; variantAttributes: Record<string, string>; msrpCents: number;
  sourceUrl: string; manufacturerHost: string; reviewedAt: string; expiresAt: string; status: string;
}
export interface OfficialMsrpEvidenceInput {
  confirmation: typeof CONFIRM;
  sourceKind: "manufacturer_msrp";
  sourceUrl: string;
  manufacturerHost: string;
  manufacturerVerified: true;
  exactVariantVerified: true;
  desiredVariant: string;
  variantAttributes: Record<string, string>;
  msrpCents: number;
  currency: "USD";
  sourceCheckedAt: string;
  sourceExcerpt: string;
  classification: "ordinary_goods";
  restricted: false;
  ageGated: false;
  moneyProduct: false;
}

function blocked(code: string, message: string): never { throw new DomainConflictError(code, message); }
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 100_000_000;
}
function attributes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputValidationError("Explicit variant attributes are required; use {} only for a unique child SKU.");
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([key, text]) => !SELECTED_OFFER_ATTRIBUTE_KEYS.includes(key as typeof SELECTED_OFFER_ATTRIBUTE_KEYS[number])
    || typeof text !== "string" || !text.trim() || text.length > 120)) throw new InputValidationError("Variant attributes must use supported exact selection dimensions.");
  return Object.fromEntries(entries.map(([key, text]) => [key, String(text).normalize("NFKC").replace(/\s+/g, " ").trim()]));
}
function evidence(row: Record<string, unknown>): OfficialMsrpEvidence {
  return { id: String(row.id), revision: Number(row.revision), listingId: String(row.listing_id),
    identityHash: String(row.identity_hash), evidenceHash: String(row.evidence_hash), desiredVariant: String(row.desired_variant),
    variantAttributes: JSON.parse(String(row.variant_attributes_json)), msrpCents: Number(row.msrp_cents),
    sourceUrl: String(row.source_url), manufacturerHost: String(row.manufacturer_host),
    reviewedAt: String(row.reviewed_at), expiresAt: String(row.expires_at), status: String(row.status) };
}

export class OfficialMsrpRepository {
  constructor(private readonly db: YoinkDatabase) {}

  private identity(listingId: string): ListingIdentity {
    const row = this.db.get<ListingIdentity>(`SELECT l.id AS listingId, l.retailer_id AS retailerId,
      l.retailer_sku AS retailerSku, l.canonical_url AS canonicalUrl, l.variant_id AS variantId,
      v.title, v.attributes_json AS attributesJson FROM listings l JOIN variants v ON v.id=l.variant_id WHERE l.id=?`, listingId);
    if (!row || !MSRP_GUARDED_RETAILERS.includes(row.retailerId)
      || canonicalRetailerUrl(row.canonicalUrl, row.retailerId, row.retailerSku) !== row.canonicalUrl) {
      return blocked("official_msrp_identity_unverified", "Review an exact canonical product identity at a supported retailer.");
    }
    return row;
  }
  private identityHash(row: ListingIdentity): string {
    return stableHash("official-msrp-listing-v1", row.listingId, row.retailerId, row.retailerSku,
      row.canonicalUrl, row.variantId, row.title, row.attributesJson);
  }
  current(listingId: string, now = Date.now()): OfficialMsrpEvidence | null {
    const scope = currentRequestScope();
    const row = this.db.get<Record<string, unknown>>(`SELECT * FROM official_msrp_evidence
      WHERE tenant_id=? AND user_id=? AND listing_id=? ORDER BY revision DESC LIMIT 1`, scope.tenantId, scope.userId, listingId);
    if (!row) return null;
    const value = evidence(row);
    if (value.status !== "approved" || Date.parse(value.expiresAt) <= now || Date.parse(value.reviewedAt) > now) return null;
    try { return value.identityHash === this.identityHash(this.identity(listingId)) ? value : null; }
    catch (error) { if (error instanceof DomainConflictError) return null; throw error; }
  }
  require(listingId: string, now = Date.now()): OfficialMsrpEvidence {
    return this.current(listingId, now) ?? blocked("official_msrp_review_required", "Official MSRP and exact variant evidence are missing, changed, revoked or expired. Review this offer before enabling cart actions.");
  }

  /** Only an existing catalog reviewer may attest a manufacturer source. This does not enable a store or plan. */
  record(listingId: string, input: OfficialMsrpEvidenceInput, now = Date.now()): OfficialMsrpEvidence {
    new AuthorizationRepository(this.db).require("catalog.review");
    return this.db.transaction(() => {
      const identity = this.identity(listingId);
      let source: URL;
      try { source = new URL(input?.sourceUrl); } catch { throw new InputValidationError("An official manufacturer evidence URL is required."); }
      const checkedAt = Date.parse(input?.sourceCheckedAt);
      const host = source.hostname.replace(/^www\./, "");
      if (input?.confirmation !== CONFIRM || input.sourceKind !== "manufacturer_msrp"
        || input.manufacturerVerified !== true || input.exactVariantVerified !== true
        || source.protocol !== "https:" || source.username || source.password || source.port || source.search || source.hash
        || source.hostname !== input.manufacturerHost || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(source.hostname)
        || ["trackalacker.com", "amazon.com", "target.com", "walmart.com", "bestbuy.com"]
          .some(domain => host === domain || host.endsWith(`.${domain}`))
        || !positive(input.msrpCents) || input.currency !== "USD"
        || !Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > 24 * 60 * 60_000
        || typeof input.sourceExcerpt !== "string" || !input.sourceExcerpt.trim() || input.sourceExcerpt.length > 400
        || typeof input.desiredVariant !== "string" || !input.desiredVariant.trim() || input.desiredVariant.length > 160) {
        throw new InputValidationError("Review the manufacturer source, exact variant, positive USD MSRP and a short supporting excerpt. Source labels and crossed-out prices are not approval.");
      }
      if (input.classification !== "ordinary_goods" || input.restricted !== false || input.ageGated !== false
        || input.moneyProduct !== false || RESTRICTED.test(identity.title)) {
        throw new InputValidationError("Only independently reviewed ordinary goods are eligible.");
      }
      const variantAttributes = attributes(input.variantAttributes);
      const scope = currentRequestScope();
      const id = newId("official_msrp");
      const revision = Number(this.db.get<{ revision: number }>(`SELECT MAX(revision) AS revision FROM official_msrp_evidence
        WHERE tenant_id=? AND user_id=? AND listing_id=?`, scope.tenantId, scope.userId, listingId)?.revision ?? 0) + 1;
      const identityHash = this.identityHash(identity);
      const reviewedAt = nowIso(now);
      const expiresAt = nowIso(checkedAt + MAX_REVIEW_AGE_MS);
      const evidenceHash = stableHash("official-msrp-v1", id, revision, identityHash, input.desiredVariant,
        JSON.stringify(variantAttributes), input.msrpCents, source.href, input.sourceExcerpt, scope.actorId, reviewedAt, expiresAt);
      this.db.run(`INSERT INTO official_msrp_evidence(id,tenant_id,user_id,listing_id,revision,identity_hash,evidence_hash,
        desired_variant,variant_attributes_json,msrp_cents,source_url,manufacturer_host,source_excerpt,source_checked_at,
        reviewed_by_actor_id,reviewed_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'approved')`,
      id, scope.tenantId, scope.userId, listingId, revision, identityHash, evidenceHash, input.desiredVariant.trim(),
      JSON.stringify(variantAttributes), input.msrpCents, source.href, source.hostname, input.sourceExcerpt.trim(),
      nowIso(checkedAt), scope.actorId, reviewedAt, expiresAt);
      new AuditRepository(this.db).record({ correlationId: id, aggregateType: "official_msrp",
        eventType: "official_msrp_reviewed", reasonCode: "catalog_reviewer_attestation",
        message: "An authorized reviewer recorded exact manufacturer MSRP and ordinary-product eligibility; no execution was enabled.",
        data: { listingId, evidenceId: id, revision, evidenceHash, msrpCents: input.msrpCents, sourceUrl: source.href } }, now);
      return this.require(listingId, now);
    });
  }
  revoke(listingId: string, evidenceId: string, now = Date.now()): void {
    new AuthorizationRepository(this.db).require("catalog.review");
    const scope = currentRequestScope();
    this.db.transaction(() => {
      const updated = this.db.run(`UPDATE official_msrp_evidence SET status='revoked' WHERE id=? AND listing_id=?
        AND tenant_id=? AND user_id=? AND status='approved'`, evidenceId, listingId, scope.tenantId, scope.userId);
      if (!updated.changes) blocked("official_msrp_evidence_changed", "The evidence is missing or already revoked.");
      new AuditRepository(this.db).record({ correlationId: evidenceId, aggregateType: "official_msrp",
        eventType: "official_msrp_revoked", reasonCode: "reviewer_revocation", message: "Official MSRP authorization was revoked.",
        data: { listingId, evidenceId } }, now);
    });
  }
  bindTarget(target: PurchaseIntentPolicyTarget, now: number): PurchaseIntentPolicyTarget {
    const value = this.require(target.listingId, now);
    if (!positive(target.maxUnitPriceCents) || target.maxUnitPriceCents > value.msrpCents) {
      blocked("official_msrp_cap_exceeded", "The reviewed item cap must be at or below verified manufacturer MSRP.");
    }
    return { ...target, officialMsrpEvidenceId: value.id, officialMsrpEvidenceHash: value.evidenceHash, desiredVariant: value.desiredVariant };
  }
  authorizeSignal(listingId: string, target: PurchaseIntentPolicyTarget, signal: NormalizedSignal, now: number): OfficialMsrpAuthorization {
    const value = this.require(listingId, now);
    if (target.officialMsrpEvidenceId !== value.id || target.officialMsrpEvidenceHash !== value.evidenceHash
      || target.desiredVariant !== value.desiredVariant) blocked("official_msrp_plan_review_required", "The plan must explicitly bind the current official MSRP and desired variant review.");
    const observedAt = Date.parse(signal.observedAt);
    if (signal.source !== "trackalacker" || signal.test || !Number.isFinite(observedAt)
      || observedAt > now || now - observedAt > OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS) {
      blocked("official_msrp_fresh_signal_required", "A fresh real Trackalacker signal is required; old alerts cannot authorize a cart action.");
    }
    const source = this.db.get<{ trust: string; status: string }>(`SELECT trust_level AS trust,status FROM source_connections
      WHERE id=? AND tenant_id=? AND user_id=?`, signal.sourceConnectionId, currentRequestScope().tenantId, currentRequestScope().userId);
    if (source?.trust !== "trusted_exact" || source.status !== "connected") blocked("official_msrp_source_untrusted", "The exact source connection must be connected and trusted.");
    if (signal.offer.currency !== "USD" || !positive(signal.offer.unitPriceCents)
      || signal.offer.unitPriceCents > value.msrpCents || !positive(target.maxUnitPriceCents)
      || signal.offer.unitPriceCents > target.maxUnitPriceCents) blocked("official_msrp_signal_price_unverified", "A readable signal price at or below both the reviewed cap and official MSRP is required.");
    const identity = this.identity(listingId);
    return { version: 1, evidenceId: value.id, evidenceHash: value.evidenceHash, listingIdentityHash: value.identityHash,
      retailerId: identity.retailerId, retailerSku: identity.retailerSku, desiredVariant: value.desiredVariant,
      variantAttributes: value.variantAttributes, msrpCents: value.msrpCents, unitPriceCents: signal.offer.unitPriceCents,
      currency: "USD", signalObservedAt: signal.observedAt,
      expiresAt: nowIso(Math.min(Date.parse(value.expiresAt), observedAt + OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS)) };
  }
  validateJob(jobId: string, now: number): OfficialMsrpAuthorization | null {
    const scope = currentRequestScope();
    const job = this.db.get<{ listingId: string; retailerId: string; proof: string; action: string; quantity: number;
      fulfillment: string; seller: string; revisionId: string; currentRevisionId: string; canonicalUrl: string; cap: number }>(`SELECT
      aj.listing_id AS listingId,l.retailer_id AS retailerId,aj.official_msrp_json AS proof,aj.action,aj.quantity,aj.fulfillment,
      aj.seller_policy AS seller,aj.intent_revision_id AS revisionId,aj.canonical_url AS canonicalUrl,aj.max_unit_price_cents AS cap,
      (SELECT id FROM mission_intent_revisions WHERE mission_id=aj.mission_id ORDER BY revision DESC LIMIT 1) AS currentRevisionId
      FROM action_jobs aj JOIN listings l ON l.id=aj.listing_id WHERE aj.id=? AND aj.tenant_id=? AND aj.user_id=?`,
    jobId, scope.tenantId, scope.userId);
    if (!job) return blocked("official_msrp_job_missing", "The exact job is unavailable.");
    if (!MSRP_GUARDED_RETAILERS.includes(job.retailerId) || job.action === "notify") return null;
    const value = this.require(job.listingId, now);
    let proof: OfficialMsrpAuthorization;
    try { proof = JSON.parse(job.proof); } catch { return blocked("official_msrp_job_invalid", "Job evidence is unreadable."); }
    const identity = this.identity(job.listingId);
    if (!proof || proof.version !== 1 || proof.evidenceId !== value.id || proof.evidenceHash !== value.evidenceHash
      || proof.listingIdentityHash !== value.identityHash || proof.retailerId !== identity.retailerId
      || proof.retailerSku !== identity.retailerSku || proof.desiredVariant !== value.desiredVariant
      || JSON.stringify(proof.variantAttributes) !== JSON.stringify(value.variantAttributes)
      || proof.msrpCents !== value.msrpCents || proof.currency !== "USD" || !positive(proof.unitPriceCents)
      || proof.unitPriceCents > value.msrpCents || proof.unitPriceCents !== job.cap
      || job.canonicalUrl !== identity.canonicalUrl || job.revisionId !== job.currentRevisionId
      || job.action !== "add_to_cart" || job.quantity !== 1 || job.seller !== "first_party_only" || job.fulfillment !== "shipping"
      || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= now
      || !Number.isFinite(Date.parse(proof.signalObservedAt)) || Date.parse(proof.signalObservedAt) > now
      || now - Date.parse(proof.signalObservedAt) > OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS) {
      return blocked("official_msrp_job_review_required", "The job's exact variant, price or official evidence changed or expired. No cart authorization remains.");
    }
    return proof;
  }
}
