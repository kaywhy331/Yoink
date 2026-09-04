import type { CatalogListingInput } from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import { CatalogRepository, type CatalogUpsertResult } from "./catalog-repository.js";
import { LOCAL_USER_ID, type YoinkDatabase } from "./database.js";
import { LOCAL_REQUEST_SCOPE, currentRequestScope, runWithRequestScope } from "./request-scope.js";

export const APPROVE_CATALOG_PROPOSAL_CONFIRMATION = "APPROVE_CATALOG_PROPOSAL";
export const REJECT_CATALOG_PROPOSAL_CONFIRMATION = "REJECT_CATALOG_PROPOSAL";

export type CatalogProposalStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface CatalogProposalDecisionInput {
  outcome: "approve" | "reject";
  note?: string;
  confirmation: typeof APPROVE_CATALOG_PROPOSAL_CONFIRMATION | typeof REJECT_CATALOG_PROPOSAL_CONFIRMATION;
}

export interface CatalogChangeProposal {
  id: string;
  tenantId: string;
  proposerUserId: string;
  proposerDisplayName: string;
  proposerActorKind: string;
  proposerActorId: string;
  proposalKind: "listing_upsert";
  retailerId: string;
  retailerSku: string;
  payload: CatalogListingInput;
  payloadHash: string;
  status: CatalogProposalStatus;
  reviewNote: string;
  reviewedByActorId: string;
  decidedAt: string;
  appliedListingId: string;
  createdAt: string;
  updatedAt: string;
}

interface ProposalRow {
  id: string;
  tenantId: string;
  proposerUserId: string;
  proposerDisplayName: string;
  proposerActorKind: string;
  proposerActorId: string;
  proposalKind: "listing_upsert";
  retailerId: string;
  retailerSku: string;
  payloadJson: string;
  payloadHash: string;
  status: CatalogProposalStatus;
  reviewNote: string;
  reviewedByActorId: string;
  decidedAt: string;
  appliedListingId: string | null;
  createdAt: string;
  updatedAt: string;
}

const SELECT_PROPOSAL = `
  SELECT proposal.id, proposal.tenant_id AS tenantId,
         proposal.proposer_user_id AS proposerUserId,
         COALESCE(proposer.display_name, 'Unknown user') AS proposerDisplayName,
         proposal.proposer_actor_kind AS proposerActorKind,
         proposal.proposer_actor_id AS proposerActorId,
         proposal.proposal_kind AS proposalKind,
         proposal.retailer_id AS retailerId, proposal.retailer_sku AS retailerSku,
         proposal.payload_json AS payloadJson, proposal.payload_hash AS payloadHash,
         proposal.status, proposal.review_note AS reviewNote,
         proposal.reviewed_by_actor_id AS reviewedByActorId,
         proposal.decided_at AS decidedAt, proposal.applied_listing_id AS appliedListingId,
         proposal.created_at AS createdAt, proposal.updated_at AS updatedAt
  FROM catalog_change_proposals proposal
  LEFT JOIN users proposer
    ON proposer.tenant_id = proposal.tenant_id AND proposer.id = proposal.proposer_user_id`;

function proposalFromRow(row: ProposalRow): CatalogChangeProposal {
  return {
    id: row.id,
    tenantId: row.tenantId,
    proposerUserId: row.proposerUserId,
    proposerDisplayName: row.proposerDisplayName,
    proposerActorKind: row.proposerActorKind,
    proposerActorId: row.proposerActorId,
    proposalKind: row.proposalKind,
    retailerId: row.retailerId,
    retailerSku: row.retailerSku,
    payload: JSON.parse(row.payloadJson) as CatalogListingInput,
    payloadHash: row.payloadHash,
    status: row.status,
    reviewNote: row.reviewNote,
    reviewedByActorId: row.reviewedByActorId,
    decidedAt: row.decidedAt,
    appliedListingId: row.appliedListingId ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function boundedPage(limit: number, offset: number): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.min(200, Math.floor(Number(limit) || 100))),
    offset: Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0
  };
}

export class CatalogGovernanceRepository {
  private readonly audit: AuditRepository;
  private readonly authorization: AuthorizationRepository;
  private readonly catalog: CatalogRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
    this.authorization = new AuthorizationRepository(db);
    this.catalog = new CatalogRepository(db);
  }

  proposeListing(input: CatalogListingInput, now = Date.now()): {
    proposal: CatalogChangeProposal;
    disposition: "created" | "duplicate_pending";
  } {
    this.authorization.require("user.catalog.propose");
    const scope = currentRequestScope();
    const payload = this.catalog.normalizedListingInput(input, now);
    const payloadJson = JSON.stringify(payload);
    // Review identity is the exact store item, not volatile observation time
    // or user-entered display copy. Repeated submissions reuse the pending row.
    const payloadHash = stableHash(
      "yoink_catalog_proposal_v2",
      scope.userId,
      payload.source,
      payload.retailerId,
      payload.retailerSku
    );
    const existing = this.db.get<ProposalRow>(
      `${SELECT_PROPOSAL} WHERE proposal.tenant_id = ? AND proposal.payload_hash = ? AND proposal.status = 'pending'`,
      scope.tenantId,
      payloadHash
    );
    if (existing) return { proposal: proposalFromRow(existing), disposition: "duplicate_pending" };

    const id = newId("catalog_proposal");
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO catalog_change_proposals(
           id, tenant_id, proposer_user_id, proposer_actor_kind, proposer_actor_id,
           proposal_kind, retailer_id, retailer_sku, payload_json, payload_hash,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'listing_upsert', ?, ?, ?, ?, 'pending', ?, ?)`,
        id,
        scope.tenantId,
        scope.userId,
        scope.actorKind,
        scope.actorId,
        payload.retailerId,
        payload.retailerSku,
        payloadJson,
        payloadHash,
        timestamp,
        timestamp
      );
      this.audit.record({
        correlationId: id,
        aggregateType: "catalog_change_proposal",
        eventType: "catalog_change_proposed",
        reasonCode: "governed_listing_upsert",
        message: "A normalized catalog listing change was submitted for review.",
        data: {
          proposalId: id,
          retailerId: payload.retailerId,
          retailerSku: payload.retailerSku,
          payloadHash
        }
      }, now);
    });
    return { proposal: this.requireProposal(id), disposition: "created" };
  }

  listMine(limit = 100, offset = 0): CatalogChangeProposal[] {
    this.authorization.require("user.read");
    const scope = currentRequestScope();
    const page = boundedPage(limit, offset);
    return this.db.all<ProposalRow>(
      `${SELECT_PROPOSAL}
       WHERE proposal.tenant_id = ? AND proposal.proposer_user_id = ?
       ORDER BY proposal.created_at DESC, proposal.id DESC LIMIT ? OFFSET ?`,
      scope.tenantId,
      scope.userId,
      page.limit,
      page.offset
    ).map(proposalFromRow);
  }

  /**
   * Display names for actor ids recorded on governance rows, resolved through the tenant's users
   * table (the local control-center actor maps to the local user). Unknown ids are omitted.
   */
  actorDisplayNames(actorIds: Iterable<string>): Record<string, string> {
    const ids = [...new Set([...actorIds].map((id) => cleanText(id, 120)).filter(Boolean))];
    if (!ids.length) return {};
    const userIdFor = (actorId: string) => (actorId === LOCAL_REQUEST_SCOPE.actorId ? LOCAL_USER_ID : actorId);
    const userIds = [...new Set(ids.map(userIdFor))];
    const rows = this.db.all<{ id: string; displayName: string }>(
      `SELECT id, display_name AS displayName FROM users
       WHERE tenant_id = ? AND id IN (${userIds.map(() => "?").join(", ")})`,
      currentRequestScope().tenantId,
      ...userIds
    );
    const byUserId = new Map(rows.map((row) => [row.id, row.displayName]));
    return Object.fromEntries(
      ids.map((id) => [id, byUserId.get(userIdFor(id)) ?? ""]).filter(([, name]) => name)
    );
  }

  listForReview(status: CatalogProposalStatus | "all" = "pending", limit = 100, offset = 0): CatalogChangeProposal[] {
    this.authorization.require("catalog.review");
    const scope = currentRequestScope();
    const page = boundedPage(limit, offset);
    const normalizedStatus = ["pending", "approved", "rejected", "withdrawn"].includes(status) ? status : "all";
    return this.db.all<ProposalRow>(
      `${SELECT_PROPOSAL}
       WHERE proposal.tenant_id = ? AND (? = 'all' OR proposal.status = ?)
       ORDER BY CASE proposal.status WHEN 'pending' THEN 0 ELSE 1 END,
                proposal.created_at, proposal.id
       LIMIT ? OFFSET ?`,
      scope.tenantId,
      normalizedStatus,
      normalizedStatus,
      page.limit,
      page.offset
    ).map(proposalFromRow);
  }

  decide(id: string, input: CatalogProposalDecisionInput, now = Date.now()): {
    proposal: CatalogChangeProposal;
    application: CatalogUpsertResult | null;
    replayed: boolean;
  } {
    this.authorization.require("catalog.review");
    const scope = currentRequestScope();
    const proposalId = cleanText(id, 120);
    const outcome = input?.outcome;
    const expectedConfirmation = outcome === "approve"
      ? APPROVE_CATALOG_PROPOSAL_CONFIRMATION
      : outcome === "reject" ? REJECT_CATALOG_PROPOSAL_CONFIRMATION : "";
    if (!expectedConfirmation || input?.confirmation !== expectedConfirmation) {
      throw new Error("The catalog review outcome and explicit confirmation are required.");
    }
    const note = cleanText(input.note, 500);
    if (outcome === "reject" && !note) throw new Error("A rejection note is required.");
    const proposal = this.db.get<ProposalRow>(
      `${SELECT_PROPOSAL} WHERE proposal.id = ? AND proposal.tenant_id = ?`,
      proposalId,
      scope.tenantId
    );
    if (!proposal) throw new Error("The catalog proposal does not exist in the authenticated tenant.");
    const desiredStatus = outcome === "approve" ? "approved" : "rejected";
    if (proposal.status === desiredStatus) {
      return { proposal: proposalFromRow(proposal), application: null, replayed: true };
    }
    if (proposal.status !== "pending") throw new Error("Only a pending catalog proposal can be reviewed.");

    let application: CatalogUpsertResult | null = null;
    this.db.transaction(() => {
      if (outcome === "approve") {
        application = runWithRequestScope({
          tenantId: proposal.tenantId,
          userId: proposal.proposerUserId,
          actorKind: scope.actorKind,
          actorId: scope.actorId
        }, () => this.catalog.upsertListing(JSON.parse(proposal.payloadJson) as CatalogListingInput, now));
      }
      const timestamp = nowIso(now);
      this.db.run(
        `UPDATE catalog_change_proposals
         SET status = ?, review_note = ?, reviewed_by_actor_id = ?, decided_at = ?,
             applied_listing_id = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
        desiredStatus,
        note,
        scope.actorId,
        timestamp,
        application?.listing.id ?? null,
        timestamp,
        proposalId,
        scope.tenantId
      );
      this.audit.record({
        correlationId: proposalId,
        aggregateType: "catalog_change_proposal",
        eventType: outcome === "approve" ? "catalog_change_approved" : "catalog_change_rejected",
        reasonCode: outcome === "approve" ? "review_approved" : "review_rejected",
        message: outcome === "approve"
          ? "A reviewed catalog listing change was applied."
          : "A reviewed catalog listing change was rejected.",
        data: {
          proposalId,
          retailerId: proposal.retailerId,
          retailerSku: proposal.retailerSku,
          appliedListingId: application?.listing.id ?? "",
          reviewerActorId: scope.actorId
        }
      }, now);
    });
    return { proposal: this.requireProposal(proposalId), application, replayed: false };
  }

  counts(): { catalogProposals: number; pendingCatalogProposals: number } {
    const scope = currentRequestScope();
    const row = this.db.get<{ total: number; pending: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM catalog_change_proposals WHERE tenant_id = ?`,
      scope.tenantId
    );
    return {
      catalogProposals: Number(row?.total ?? 0),
      pendingCatalogProposals: Number(row?.pending ?? 0)
    };
  }

  mineCounts(): { catalogProposals: number; pendingCatalogProposals: number } {
    const scope = currentRequestScope();
    const row = this.db.get<{ total: number; pending: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM catalog_change_proposals WHERE tenant_id = ? AND proposer_user_id = ?`,
      scope.tenantId,
      scope.userId
    );
    return {
      catalogProposals: Number(row?.total ?? 0),
      pendingCatalogProposals: Number(row?.pending ?? 0)
    };
  }

  private requireProposal(id: string): CatalogChangeProposal {
    const scope = currentRequestScope();
    const row = this.db.get<ProposalRow>(
      `${SELECT_PROPOSAL} WHERE proposal.id = ? AND proposal.tenant_id = ?`,
      id,
      scope.tenantId
    );
    if (!row) throw new Error("The catalog proposal no longer exists.");
    return proposalFromRow(row);
  }
}
