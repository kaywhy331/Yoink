import type {
  AttributionPlan,
  AttributionPolicyDefinition,
  AttributionPolicyUpdateInput,
  ListingContext
} from "../../contracts/src/index.js";
import {
  attributionPolicyValidity,
  buildAttributionPlan,
  howlAffiliateStoreForRetailer,
  isAttributionProvider,
  normalizedArticleBaseUrl
} from "../../domain/src/attribution.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import {
  HOWL_AFFILIATE_ENDPOINT,
  HOWL_AFFILIATE_PROTOCOL_VERSION,
  HOWL_AFFILIATE_STORES,
  HOWL_DEFAULT_PUBLISHER_SLUG
} from "../../domain/src/howl-affiliate-stores.js";
import { type YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { AuditRepository } from "./audit-repository.js";

const RETAILERS = new Set([
  "target", "walmart", "amazon", "bestbuy", "disney", "ravensburger", "riot",
  "booksamillion", "fanatics", "kohls", "macys", "pbandai", "pokemoncenter"
]);

interface PolicyRow {
  id: string;
  retailer_id: string;
  retailer_name: string;
  enabled: number;
  provider: string;
  publisher_slug: string;
  article_base_url: string;
  associate_tag: string;
}

function policyDefinition(row: PolicyRow): AttributionPolicyDefinition {
  const howlStore = howlAffiliateStoreForRetailer(row.retailer_id);
  const policy: AttributionPolicyDefinition = {
    id: row.id,
    retailerId: row.retailer_id,
    retailerName: row.retailer_name,
    enabled: row.enabled === 1,
    provider: isAttributionProvider(row.provider) ? row.provider : "canonical",
    publisherSlug: row.publisher_slug,
    articleBaseUrl: row.article_base_url,
    associateTag: row.associate_tag,
    howlEligible: howlStore !== null,
    howlStoreName: howlStore?.storeName ?? "",
    valid: false,
    validationReason: ""
  };
  const validity = attributionPolicyValidity(policy);
  return { ...policy, valid: validity.valid, validationReason: validity.reason };
}

export class AttributionRepository {
  private readonly auditEvents: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.auditEvents = new AuditRepository(db);
  }

  routingDirectory(): {
    protocolVersion: number;
    endpoint: string;
    publisherSlug: string;
    stores: typeof HOWL_AFFILIATE_STORES;
    registeredRetailerDomains: string[];
  } {
    const domains = this.db.all<{ domains_json: string }>(
      "SELECT domains_json FROM retailers ORDER BY id"
    ).flatMap((row) => {
      try {
        const parsed = JSON.parse(row.domains_json) as unknown;
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
      } catch {
        return [];
      }
    }).map((domain) => domain.trim().toLocaleLowerCase("en-US")).filter(Boolean);
    return {
      protocolVersion: HOWL_AFFILIATE_PROTOCOL_VERSION,
      endpoint: HOWL_AFFILIATE_ENDPOINT,
      publisherSlug: HOWL_DEFAULT_PUBLISHER_SLUG,
      stores: HOWL_AFFILIATE_STORES,
      registeredRetailerDomains: [...new Set(domains)].sort()
    };
  }

  listPolicies(): AttributionPolicyDefinition[] {
    return this.db.all<PolicyRow>(
      `SELECT ap.id, ap.retailer_id, r.display_name AS retailer_name,
              ap.enabled, ap.provider, ap.publisher_slug,
              ap.article_base_url, ap.associate_tag
       FROM attribution_policies ap JOIN retailers r ON r.id = ap.retailer_id
       WHERE ap.user_id = ? ORDER BY r.display_name`,
      currentRequestScope().userId
    ).map(policyDefinition);
  }

  replacePolicies(input: AttributionPolicyUpdateInput[], now = Date.now()): AttributionPolicyDefinition[] {
    if (!Array.isArray(input) || input.length !== RETAILERS.size) {
      throw new Error("Submit one attribution policy for every supported retailer.");
    }
    const normalized = input.map((policy) => {
      const retailerId = cleanText(policy?.retailerId, 60).toLocaleLowerCase("en-US");
      if (!RETAILERS.has(retailerId) || typeof policy?.enabled !== "boolean" || !isAttributionProvider(policy?.provider)) {
        throw new Error("Every attribution policy needs a supported retailer, enabled state, and provider.");
      }
      const value: AttributionPolicyUpdateInput = {
        retailerId,
        enabled: policy.enabled,
        provider: policy.provider,
        publisherSlug: cleanText(policy.publisherSlug, 80).toLocaleLowerCase("en-US"),
        articleBaseUrl: policy.articleBaseUrl ? normalizedArticleBaseUrl(policy.articleBaseUrl) : "",
        associateTag: cleanText(policy.associateTag, 80)
      };
      const validity = attributionPolicyValidity({
        ...value
      });
      if (value.enabled && !validity.valid) throw new Error(`${retailerId}: ${validity.reason}`);
      return value;
    });
    if (new Set(normalized.map((policy) => policy.retailerId)).size !== RETAILERS.size) {
      throw new Error("Every supported retailer must appear exactly once.");
    }
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      for (const policy of normalized) {
        this.db.run(
          `UPDATE attribution_policies SET enabled = ?, provider = ?,
             publisher_slug = ?, article_base_url = ?, associate_tag = ?, updated_at = ?
           WHERE user_id = ? AND retailer_id = ?`,
          policy.enabled ? 1 : 0,
          policy.provider,
          policy.publisherSlug,
          policy.articleBaseUrl,
          policy.associateTag,
          timestamp,
          currentRequestScope().userId,
          policy.retailerId
        );
      }
      this.auditEvents.record({
        correlationId: currentRequestScope().userId,
        aggregateType: "attribution_policy_set",
        eventType: "attribution_policies_replaced",
        reasonCode: "saved",
        message: "Affiliate-routing policies were validated and saved for every supported retailer.",
        data: { policies: normalized.map((policy) => ({ retailerId: policy.retailerId, enabled: policy.enabled, provider: policy.provider })) }
      }, now);
    });
    return this.listPolicies();
  }

  plan(
    listing: ListingContext,
    title: string,
    mode: "prefer_fallback" | "require" | "disabled"
  ): AttributionPlan {
    const row = this.db.get<PolicyRow>(
      `SELECT ap.id, ap.retailer_id, r.display_name AS retailer_name,
              ap.enabled, ap.provider, ap.publisher_slug,
              ap.article_base_url, ap.associate_tag
       FROM attribution_policies ap JOIN retailers r ON r.id = ap.retailer_id
       WHERE ap.user_id = ? AND ap.retailer_id = ?`,
      currentRequestScope().userId,
      listing.retailerId
    );
    return buildAttributionPlan(listing, title, mode, row ? policyDefinition(row) : null);
  }

  recordReceipt(jobId: string, plan: AttributionPlan, canonicalUrl: string, now = Date.now()): void {
    const inserted = this.db.run(
      `INSERT OR IGNORE INTO attribution_receipts(
         id, tenant_id, user_id, job_id, policy_id, retailer_id,
         provider, outcome, reason_code, route_url, canonical_url_hash, created_at
       ) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)`,
      newId("attribution_receipt"),
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      jobId,
      plan.policyId,
      plan.retailerId,
      plan.provider,
      plan.outcome,
      plan.reasonCode,
      plan.routeUrl,
      stableHash("canonical-attribution-url-v1", canonicalUrl),
      nowIso(now)
    );
    if (Number(inserted.changes) === 1) {
      this.auditEvents.record({
        correlationId: jobId,
        aggregateType: "attribution_receipt",
        eventType: "attribution_route_recorded",
        reasonCode: plan.reasonCode,
        message: "An immutable attribution-routing receipt was recorded for an action job.",
        data: { retailerId: plan.retailerId, provider: plan.provider, outcome: plan.outcome, policyId: plan.policyId }
      }, now);
    }
  }

  listReceipts(limit = 100): Array<Record<string, unknown>> {
    return this.db.all(
      `SELECT ar.id, ar.job_id AS jobId, ar.retailer_id AS retailerId,
              ar.provider, ar.outcome, ar.reason_code AS reasonCode,
              ar.route_url AS routeUrl, ar.created_at AS createdAt,
              v.title, l.retailer_sku AS retailerSku
       FROM attribution_receipts ar
       JOIN action_jobs aj ON aj.id = ar.job_id
       JOIN listings l ON l.id = aj.listing_id
       JOIN variants v ON v.id = l.variant_id
       WHERE ar.user_id = ? ORDER BY ar.created_at DESC LIMIT ?`,
      currentRequestScope().userId,
      Math.max(1, Math.min(1_000, Math.floor(limit)))
    );
  }
}
