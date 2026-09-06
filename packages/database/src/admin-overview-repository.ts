import { CHECKOUT_REPORT_REASONS_SQL, checkoutOriginalReportedAtSql, checkoutOutcomeSql, checkoutReportJoinSql } from "./checkout-report-projection.js";
import { nowIso } from "../../domain/src/ids.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export interface AdminOverviewWindowCounts {
  signalsReceived: number;
  jobsCreated: number;
  carted: number;
  gotIt: number;
  missed: number;
  deadLetters: number;
  routesIssued: number;
  clicks: number;
  conversions: number;
}

export interface AdminOverviewSnapshot {
  generatedAt: string;
  windows: {
    hours24: AdminOverviewWindowCounts;
    days7: AdminOverviewWindowCounts;
  };
  waiting: {
    catalogProposals: number;
    changeRequests: number;
    incidents: number;
  };
  devicesOnline: number;
}

function numericRow(row: Record<string, number> | undefined): AdminOverviewWindowCounts {
  return {
    signalsReceived: Number(row?.signalsReceived ?? 0),
    jobsCreated: Number(row?.jobsCreated ?? 0),
    carted: Number(row?.carted ?? 0),
    gotIt: Number(row?.gotIt ?? 0),
    missed: Number(row?.missed ?? 0),
    deadLetters: Number(row?.deadLetters ?? 0),
    routesIssued: Number(row?.routesIssued ?? 0),
    clicks: Number(row?.clicks ?? 0),
    conversions: Number(row?.conversions ?? 0)
  };
}

export class AdminOverviewRepository {
  private readonly authorization: AuthorizationRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.authorization = new AuthorizationRepository(db);
  }

  activeActionJobs(): number {
    this.authorization.require("admin.read");
    return Number(this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM action_jobs
       WHERE tenant_id = ? AND state IN (
         'awaiting_executor', 'leased', 'navigating', 'verifying_listing', 'offer_verified',
         'add_authorized', 'adding', 'checkout_review', 'submit_authorized', 'submitting'
       )`,
      currentRequestScope().tenantId
    )?.count ?? 0);
  }

  /** Active plans per store, counted once per plan for every store it targets. */
  activePlansByStore(): Record<string, number> {
    this.authorization.require("admin.read");
    const rows = this.db.all<{ retailerId: string; count: number }>(
      `SELECT listing.retailer_id AS retailerId, COUNT(DISTINCT mission.id) AS count
       FROM missions mission
       JOIN mission_targets target ON target.mission_id = mission.id AND target.enabled = 1
       JOIN listings listing ON listing.id = target.listing_id
       WHERE mission.tenant_id = ? AND mission.status = 'active'
       GROUP BY listing.retailer_id
       ORDER BY listing.retailer_id`,
      currentRequestScope().tenantId
    );
    return Object.fromEntries(rows.map((row) => [row.retailerId, Number(row.count)]));
  }

  snapshot(now = Date.now()): AdminOverviewSnapshot {
    this.authorization.require("admin.read");
    const scope = currentRequestScope();
    const waiting = this.db.get<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM catalog_change_proposals
           WHERE tenant_id = ? AND status = 'pending') AS catalogProposals,
         (SELECT COUNT(*) FROM admin_change_requests
           WHERE tenant_id = ? AND status = 'pending') AS changeRequests,
         (SELECT COUNT(*) FROM operator_alert_incidents
           WHERE tenant_id = ? AND status IN ('open', 'acknowledged', 'fixed_pending_live')) AS incidents,
         (SELECT COUNT(*) FROM extension_devices
           WHERE tenant_id = ? AND status = 'active' AND last_seen_at >= ?) AS devicesOnline`,
      scope.tenantId,
      scope.tenantId,
      scope.tenantId,
      scope.tenantId,
      nowIso(now - 90_000)
    ) ?? {};
    return {
      generatedAt: nowIso(now),
      windows: {
        hours24: this.window(now - 24 * 60 * 60_000),
        days7: this.window(now - 7 * 24 * 60 * 60_000)
      },
      waiting: {
        catalogProposals: Number(waiting.catalogProposals ?? 0),
        changeRequests: Number(waiting.changeRequests ?? 0),
        incidents: Number(waiting.incidents ?? 0)
      },
      devicesOnline: Number(waiting.devicesOnline ?? 0)
    };
  }

  private window(since: number): AdminOverviewWindowCounts {
    const tenantId = currentRequestScope().tenantId;
    const sinceAt = nowIso(since);
    return numericRow(this.db.get<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM signal_events
           WHERE tenant_id = ? AND received_at >= ?) AS signalsReceived,
         (SELECT COUNT(*) FROM action_jobs
           WHERE tenant_id = ? AND created_at >= ?) AS jobsCreated,
         (SELECT COUNT(DISTINCT event.job_id)
            FROM action_events event JOIN action_jobs job ON job.id = event.job_id
           WHERE job.tenant_id = ? AND event.state = 'confirmed'
             AND event.reason_code NOT IN (${CHECKOUT_REPORT_REASONS_SQL})
             AND event.created_at >= ?) AS carted,
         (SELECT COUNT(DISTINCT event.job_id)
            FROM action_jobs job ${checkoutReportJoinSql("job", "event")}
           WHERE job.tenant_id = ? AND ${checkoutOutcomeSql("event")} = 'got_it'
             AND ${checkoutOriginalReportedAtSql("job")} >= ?) AS gotIt,
         (SELECT COUNT(DISTINCT event.job_id)
            FROM action_jobs job ${checkoutReportJoinSql("job", "event")}
           WHERE job.tenant_id = ? AND ${checkoutOutcomeSql("event")} = 'missed_it'
             AND ${checkoutOriginalReportedAtSql("job")} >= ?) AS missed,
         ((SELECT COUNT(*) FROM hosted_delivery_receipts
             WHERE tenant_id = ? AND disposition = 'dead_letter' AND created_at >= ?)
          + (SELECT COUNT(*) FROM background_task_events
             WHERE tenant_id = ? AND event_type = 'dead_lettered' AND created_at >= ?)
          + (SELECT COUNT(*) FROM operator_alert_connector_delivery_events
             WHERE tenant_id = ? AND event_type = 'dead_lettered' AND created_at >= ?)
          + (SELECT COUNT(*) FROM user_action_connector_deliveries
             WHERE tenant_id = ? AND state = 'dead_letter' AND updated_at >= ?)) AS deadLetters,
         (SELECT COUNT(*) FROM attribution_receipts
           WHERE tenant_id = ? AND created_at >= ?) AS routesIssued,
         (SELECT COUNT(*) FROM audit_events
           WHERE tenant_id = ? AND created_at >= ?
             AND event_type IN ('store_link_clicked', 'walmart_purchase_handoff_clicked')) AS clicks,
         (SELECT COUNT(DISTINCT event.job_id)
            FROM action_jobs job ${checkoutReportJoinSql("job", "event")}
           WHERE job.tenant_id = ? AND ${checkoutOutcomeSql("event")} = 'got_it'
             AND ${checkoutOriginalReportedAtSql("job")} >= ?
             AND EXISTS (
               SELECT 1 FROM audit_events click
               WHERE click.tenant_id = job.tenant_id AND click.correlation_id = job.id
                 AND click.event_type IN ('store_link_clicked', 'walmart_purchase_handoff_clicked')
                 AND json_extract(click.data_json, '$.routeKind') IN ('affiliate', 'howl')
                 AND click.created_at <= ${checkoutOriginalReportedAtSql("job")}
             )) AS conversions`,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt,
      tenantId, sinceAt
    ));
  }
}
