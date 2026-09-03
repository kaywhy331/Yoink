import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const ROUTE_KINDS = new Set(["affiliate", "direct"] as const);
const DESTINATION_KINDS = new Set(["store", "cart"] as const);
const SURFACES = new Set(["home", "products", "plans", "calls", "activity", "settings", "drawings"] as const);
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;

export interface StoreLinkClickInput {
  jobId?: unknown;
  canonicalUrl?: unknown;
  routeKind?: unknown;
  destinationKind?: unknown;
  surface?: unknown;
  confirmation?: unknown;
}

export interface StoreLinkClickReceipt {
  auditId: string;
  retailerId: string;
  listingId: string;
  jobId: string;
  routeKind: "affiliate" | "direct";
  destinationKind: "store" | "cart";
  surface: "home" | "products" | "plans" | "calls" | "activity" | "settings" | "drawings";
  recordedAt: string;
}

export class StoreLinkInteractionRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  record(input: StoreLinkClickInput, now = Date.now()): StoreLinkClickReceipt {
    if (input?.confirmation !== "RECORD_STORE_LINK_CLICK") {
      throw new Error("The store-link click confirmation is required.");
    }
    const routeKind = cleanText(input.routeKind, 20) as StoreLinkClickReceipt["routeKind"];
    const destinationKind = cleanText(input.destinationKind, 20) as StoreLinkClickReceipt["destinationKind"];
    const surface = cleanText(input.surface, 20) as StoreLinkClickReceipt["surface"];
    if (!ROUTE_KINDS.has(routeKind) || !DESTINATION_KINDS.has(destinationKind) || !SURFACES.has(surface)) {
      throw new Error("The store-link click context is invalid.");
    }
    const scope = currentRequestScope();
    const requestedJobId = cleanText(input.jobId, 120);
    const canonicalUrl = cleanText(input.canonicalUrl, 2_048);
    let target: { jobId: string; listingId: string; retailerId: string } | undefined;
    if (requestedJobId) {
      if (!JOB_ID_PATTERN.test(requestedJobId)) throw new Error("The store-link action job is invalid.");
      target = this.db.get<{ jobId: string; listingId: string; retailerId: string }>(
        `SELECT job.id AS jobId, listing.id AS listingId, listing.retailer_id AS retailerId
         FROM action_jobs job JOIN listings listing ON listing.id = job.listing_id
         WHERE job.id = ? AND job.tenant_id = ? AND job.user_id = ?`,
        requestedJobId,
        scope.tenantId,
        scope.userId
      );
    } else if (canonicalUrl) {
      target = this.db.get<{ jobId: string; listingId: string; retailerId: string }>(
        `SELECT '' AS jobId, listing.id AS listingId, listing.retailer_id AS retailerId
         FROM listings listing WHERE listing.canonical_url = ?
         ORDER BY listing.id LIMIT 1`,
        canonicalUrl
      );
    }
    if (!target) throw new Error("The store link no longer identifies a current Yoink listing or action.");
    const correlationId = target.jobId || target.listingId;
    const recorded = this.audit.record({
      correlationId,
      aggregateType: target.jobId ? "action_job" : "catalog_listing",
      eventType: "store_link_clicked",
      reasonCode: routeKind === "affiliate" ? "affiliate_route_opened" : "direct_route_opened",
      message: `A user opened a ${destinationKind === "cart" ? "retailer cart" : "store page"} from ${surface}.`,
      data: {
        retailerId: target.retailerId,
        listingId: target.listingId,
        jobId: target.jobId,
        routeKind,
        destinationKind,
        surface
      }
    }, now);
    return {
      auditId: String(recorded.id),
      retailerId: target.retailerId,
      listingId: target.listingId,
      jobId: target.jobId,
      routeKind,
      destinationKind,
      surface,
      recordedAt: String(recorded.createdAt)
    };
  }
}
