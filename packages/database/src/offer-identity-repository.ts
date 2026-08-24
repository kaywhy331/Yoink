import type {
  ListingContext,
  NormalizedSignal,
  PurchaseIntentPolicy
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText, normalizedKey } from "../../domain/src/normalize.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const EXACT_ATTRIBUTE_KEYS = new Set([
  "size",
  "color",
  "edition",
  "language",
  "pack",
  "condition",
  "finish",
  "style"
]);

export interface ExactOfferKey {
  id: string;
  listingId: string;
  retailerId: string;
  retailerSku: string;
  childOfferKey: string;
  attributes: Record<string, string>;
  conditionCode: string;
  sellerName: string;
  sellerType: string;
  fulfillment: string;
  regionScope: string;
  storeScope: string;
  identityHash: string;
  createdAt: string;
}

export interface OfferSnapshot {
  id: string;
  missionId: string;
  intentRevisionId: string;
  exactOfferKeyId: string;
  listingId: string;
  availability: string;
  unitPriceCents: number | null;
  quantity: number;
  itemSubtotalCents: number | null;
  maximumAllInCents: number | null;
  currency: string;
  sellerName: string;
  sellerType: string;
  fulfillment: string;
  evidenceHash: string;
  observedAt: string;
  expiresAt: string;
  createdAt: string;
}

function exactAttributes(value: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { parsed = {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const output: Record<string, string> = {};
  for (const key of Object.keys(parsed as Record<string, unknown>).sort()) {
    const normalized = normalizedKey(key, 40).replace(/[^a-z0-9_-]/g, "");
    if (!EXACT_ATTRIBUTE_KEYS.has(normalized)) continue;
    const candidate = cleanText((parsed as Record<string, unknown>)[key], 120);
    if (candidate) output[normalized] = candidate;
  }
  return output;
}

function parsedAttributes(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, string>;
  } catch {
    // Invalid persisted JSON is surfaced as an empty, non-executable identity projection.
  }
  return {};
}

export class OfferIdentityRepository {
  constructor(private readonly db: YoinkDatabase) {}

  capture(
    signal: NormalizedSignal,
    listing: ListingContext,
    missionId: string,
    policy: PurchaseIntentPolicy,
    incidentId: string,
    quantity: number,
    maximumAllInCents: number | null,
    expiresAt: string,
    now = Date.now()
  ): { exactOffer: ExactOfferKey; snapshot: OfferSnapshot } {
    const scope = currentRequestScope();
    const variant = this.db.get<{ attributesJson: string }>(
      `SELECT v.attributes_json AS attributesJson
       FROM variants v JOIN listings l ON l.variant_id = v.id WHERE l.id = ?`,
      listing.id
    );
    if (!variant) throw new Error("The exact listing variant does not exist.");
    const attributes = exactAttributes(variant.attributesJson);
    const attributesJson = JSON.stringify(attributes);
    const conditionCode = normalizedKey(attributes.condition || "new", 40).replace(/[^a-z0-9_-]/g, "") || "new";
    const sellerName = cleanText(signal.offer.sellerName, 160);
    const sellerKey = normalizedKey(sellerName, 160);
    const childOfferKey = "";
    const regionScope = "";
    const storeScope = "";
    const identityHash = stableHash(
      "exact-offer-key-v1",
      listing.retailerId,
      listing.retailerSku,
      childOfferKey,
      attributesJson,
      conditionCode,
      sellerKey,
      signal.offer.sellerType,
      signal.offer.fulfillment,
      regionScope,
      storeScope
    );
    return this.db.transaction(() => {
      const timestamp = nowIso(now);
      const candidateId = newId("exact_offer_key");
      this.db.run(
        `INSERT OR IGNORE INTO exact_offer_keys(
           id, tenant_id, listing_id, retailer_id, retailer_sku,
           child_offer_key, attributes_json, condition_code, seller_name,
           seller_key, seller_type, fulfillment, region_scope, store_scope,
           identity_hash, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        candidateId,
        scope.tenantId,
        listing.id,
        listing.retailerId,
        listing.retailerSku,
        childOfferKey,
        attributesJson,
        conditionCode,
        sellerName,
        sellerKey,
        signal.offer.sellerType,
        signal.offer.fulfillment,
        regionScope,
        storeScope,
        identityHash,
        timestamp
      );
      const exactOffer = this.db.get<{
        id: string;
        listingId: string;
        retailerId: string;
        retailerSku: string;
        childOfferKey: string;
        attributesJson: string;
        conditionCode: string;
        sellerName: string;
        sellerType: string;
        fulfillment: string;
        regionScope: string;
        storeScope: string;
        identityHash: string;
        createdAt: string;
      }>(
        `SELECT id, listing_id AS listingId, retailer_id AS retailerId,
                retailer_sku AS retailerSku, child_offer_key AS childOfferKey,
                attributes_json AS attributesJson, condition_code AS conditionCode,
                seller_name AS sellerName, seller_type AS sellerType, fulfillment,
                region_scope AS regionScope, store_scope AS storeScope,
                identity_hash AS identityHash, created_at AS createdAt
         FROM exact_offer_keys WHERE tenant_id = ? AND identity_hash = ?`,
        scope.tenantId,
        identityHash
      );
      if (!exactOffer) throw new Error("The exact offer identity could not be saved.");
      const sourceObservation = this.db.get<{ id: string }>(
        `SELECT id FROM offer_observations
         WHERE listing_id = ? AND observed_at = ? AND offer_fingerprint = ?
         ORDER BY created_at DESC LIMIT 1`,
        listing.id,
        signal.observedAt,
        signal.offer.offerFingerprint
      );
      const itemSubtotalCents = signal.offer.unitPriceCents === null
        ? null
        : signal.offer.unitPriceCents * quantity;
      const evidenceHash = stableHash(
        "offer-snapshot-v1",
        scope.userId,
        missionId,
        policy.id,
        exactOffer.id,
        signal.offer.availability,
        signal.offer.unitPriceCents,
        quantity,
        maximumAllInCents,
        signal.offer.currency,
        signal.offer.offerFingerprint,
        signal.observedAt,
        expiresAt
      );
      const snapshotCandidateId = newId("offer_snapshot");
      this.db.run(
        `INSERT OR IGNORE INTO offer_snapshots(
           id, tenant_id, user_id, mission_id, intent_revision_id,
           exact_offer_key_id, listing_id, source_observation_id, incident_id,
           availability, unit_price_cents, quantity, item_subtotal_cents,
           maximum_all_in_cents, currency, seller_name, seller_type,
           fulfillment, offer_fingerprint, evidence_hash, observed_at,
           expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        snapshotCandidateId,
        scope.tenantId,
        scope.userId,
        missionId,
        policy.id,
        exactOffer.id,
        listing.id,
        sourceObservation?.id ?? null,
        incidentId || null,
        signal.offer.availability,
        signal.offer.unitPriceCents,
        quantity,
        itemSubtotalCents,
        maximumAllInCents,
        signal.offer.currency,
        sellerName,
        signal.offer.sellerType,
        signal.offer.fulfillment,
        signal.offer.offerFingerprint,
        evidenceHash,
        signal.observedAt,
        expiresAt,
        timestamp
      );
      const snapshot = this.db.get<OfferSnapshot>(
        `SELECT id, mission_id AS missionId, intent_revision_id AS intentRevisionId,
                exact_offer_key_id AS exactOfferKeyId, listing_id AS listingId,
                availability, unit_price_cents AS unitPriceCents, quantity,
                item_subtotal_cents AS itemSubtotalCents,
                maximum_all_in_cents AS maximumAllInCents, currency,
                seller_name AS sellerName, seller_type AS sellerType, fulfillment,
                evidence_hash AS evidenceHash, observed_at AS observedAt,
                expires_at AS expiresAt, created_at AS createdAt
         FROM offer_snapshots WHERE user_id = ? AND evidence_hash = ?`,
        scope.userId,
        evidenceHash
      );
      if (!snapshot) throw new Error("The immutable offer snapshot could not be saved.");
      return {
        exactOffer: {
          id: exactOffer.id,
          listingId: exactOffer.listingId,
          retailerId: exactOffer.retailerId,
          retailerSku: exactOffer.retailerSku,
          childOfferKey: exactOffer.childOfferKey,
          attributes: parsedAttributes(exactOffer.attributesJson),
          conditionCode: exactOffer.conditionCode,
          sellerName: exactOffer.sellerName,
          sellerType: exactOffer.sellerType,
          fulfillment: exactOffer.fulfillment,
          regionScope: exactOffer.regionScope,
          storeScope: exactOffer.storeScope,
          identityHash: exactOffer.identityHash,
          createdAt: exactOffer.createdAt
        },
        snapshot: {
          ...snapshot,
          unitPriceCents: snapshot.unitPriceCents === null ? null : Number(snapshot.unitPriceCents),
          quantity: Number(snapshot.quantity),
          itemSubtotalCents: snapshot.itemSubtotalCents === null ? null : Number(snapshot.itemSubtotalCents),
          maximumAllInCents: snapshot.maximumAllInCents === null ? null : Number(snapshot.maximumAllInCents)
        }
      };
    });
  }

  listSnapshots(missionId: string, limit = 25): OfferSnapshot[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
    return this.db.all<OfferSnapshot>(
      `SELECT os.id, os.mission_id AS missionId,
              os.intent_revision_id AS intentRevisionId,
              os.exact_offer_key_id AS exactOfferKeyId,
              os.listing_id AS listingId, os.availability,
              os.unit_price_cents AS unitPriceCents, os.quantity,
              os.item_subtotal_cents AS itemSubtotalCents,
              os.maximum_all_in_cents AS maximumAllInCents, os.currency,
              os.seller_name AS sellerName, os.seller_type AS sellerType,
              os.fulfillment, os.evidence_hash AS evidenceHash,
              os.observed_at AS observedAt, os.expires_at AS expiresAt,
              os.created_at AS createdAt
       FROM offer_snapshots os JOIN missions m ON m.id = os.mission_id
       WHERE os.mission_id = ? AND os.tenant_id = ? AND os.user_id = ?
         AND m.user_id = os.user_id
       ORDER BY os.observed_at DESC, os.id DESC LIMIT ?`,
      cleanText(missionId, 120),
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      safeLimit
    ).map((snapshot) => ({
      ...snapshot,
      unitPriceCents: snapshot.unitPriceCents === null ? null : Number(snapshot.unitPriceCents),
      quantity: Number(snapshot.quantity),
      itemSubtotalCents: snapshot.itemSubtotalCents === null ? null : Number(snapshot.itemSubtotalCents),
      maximumAllInCents: snapshot.maximumAllInCents === null ? null : Number(snapshot.maximumAllInCents)
    }));
  }
}
