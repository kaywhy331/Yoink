import { exactRetailerProductLink } from "../../domain/src/attribution.js";
import { stableHash, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import {
  CatalogGovernanceRepository,
  type CatalogChangeProposal
} from "./catalog-governance-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope, ownedIdForUser } from "./request-scope.js";

export const PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION = "PROPOSE_EXACT_PRODUCT_LINK";

const PACKAGED_ADD_RETAILERS = new Set(["target", "walmart", "amazon", "bestbuy"]);

interface RetailerRow {
  id: string;
  displayName: string;
  executionSupported: number;
}

export interface ExactProductLinkProposalInput {
  url: string;
  title: string;
  confirmation: typeof PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION;
}

export interface ExactProductLinkPreview {
  retailerId: string;
  retailerName: string;
  retailerSku: string;
  canonicalUrl: string;
  postReviewCapability: "guarded_add_candidate" | "monitor_only";
  capabilityLabel: string;
  reviewRequired: true;
  stockEvidenceAccepted: false;
  purchasePlanCreated: false;
}

export class CatalogLinkError extends Error {
  readonly status = 400;

  constructor(
    readonly code:
      | "exact_product_link_invalid"
      | "product_title_required"
      | "product_link_confirmation_required",
    message: string
  ) {
    super(message);
    this.name = "CatalogLinkError";
  }
}

export class CatalogLinkRepository {
  private readonly authorization: AuthorizationRepository;
  private readonly governance: CatalogGovernanceRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.authorization = new AuthorizationRepository(db);
    this.governance = new CatalogGovernanceRepository(db);
  }

  preview(urlValue: unknown): ExactProductLinkPreview {
    this.authorization.require("user.catalog.propose");
    const exact = exactRetailerProductLink(urlValue);
    if (!exact) {
      throw new CatalogLinkError(
        "exact_product_link_invalid",
        "Paste a supported store product page with an exact item ID. Search, category, drawing-hub, and sign-in links are not accepted."
      );
    }
    const retailer = this.db.get<RetailerRow>(
      `SELECT id, display_name AS displayName, execution_supported AS executionSupported
       FROM retailers WHERE id = ?`,
      exact.retailerId
    );
    if (!retailer) {
      throw new CatalogLinkError("exact_product_link_invalid", "That store is not registered in Yoink's catalog.");
    }
    const guardedAddCandidate = PACKAGED_ADD_RETAILERS.has(retailer.id)
      && retailer.executionSupported === 1;
    return {
      retailerId: retailer.id,
      retailerName: retailer.displayName,
      retailerSku: exact.retailerSku,
      canonicalUrl: exact.canonicalUrl,
      postReviewCapability: guardedAddCandidate ? "guarded_add_candidate" : "monitor_only",
      capabilityLabel: guardedAddCandidate
        ? "Eligible for a guarded add-only plan after independent catalog review; a fresh exact offer must still qualify."
        : "Monitoring and notifications only unless this retailer's separate guarded lane is qualified later.",
      reviewRequired: true,
      stockEvidenceAccepted: false,
      purchasePlanCreated: false
    };
  }

  propose(input: ExactProductLinkProposalInput, now = Date.now()): {
    preview: ExactProductLinkPreview;
    proposal: CatalogChangeProposal;
    disposition: "created" | "duplicate_pending";
  } {
    if (!input || typeof input !== "object"
      || input.confirmation !== PROPOSE_EXACT_PRODUCT_LINK_CONFIRMATION) {
      throw new CatalogLinkError(
        "product_link_confirmation_required",
        "Confirm that this is the exact product page you want an administrator to review."
      );
    }
    const title = cleanText(input.title, 300);
    if (title.length < 2) {
      throw new CatalogLinkError("product_title_required", "Enter the product name shown on the store page.");
    }
    const preview = this.preview(input.url);
    const scope = currentRequestScope();
    const sourceConnectionId = ownedIdForUser(
      "source_user_link",
      scope.userId,
      "source_user_link_local"
    );
    const exactIdentityHash = stableHash(
      "yoink_user_product_link_v1",
      preview.retailerId,
      preview.retailerSku
    ).slice(0, 32);
    const timestamp = nowIso(now);
    return this.db.transaction(() => {
      this.db.run(
        `INSERT OR IGNORE INTO source_connections(
           id, tenant_id, user_id, source, name, status, trust_level,
           auto_create_missions, is_private, created_at, updated_at
         ) VALUES (?, ?, ?, 'user_link', 'Product links', 'manual',
                   'informational', 0, 1, ?, ?)`,
        sourceConnectionId,
        scope.tenantId,
        scope.userId,
        timestamp,
        timestamp
      );
      const result = this.governance.proposeListing({
        sourceConnectionId,
        source: "user_link",
        sourceProductId: `link_product_${exactIdentityHash}`,
        sourceListingId: `link_listing_${exactIdentityHash}`,
        sourceProductAliases: {
          retailer_item: `${preview.retailerId}:${preview.retailerSku}`
        },
        sourceProductUrl: preview.canonicalUrl,
        sourceListingUrl: preview.canonicalUrl,
        title,
        retailerId: preview.retailerId,
        retailerSku: preview.retailerSku,
        canonicalUrl: preview.canonicalUrl,
        listingStatus: "unknown",
        executionSupported: PACKAGED_ADD_RETAILERS.has(preview.retailerId),
        msrpCents: null,
        observedPriceCents: null,
        currency: "USD",
        observedAt: timestamp
      }, now);
      return { preview, ...result };
    });
  }
}
