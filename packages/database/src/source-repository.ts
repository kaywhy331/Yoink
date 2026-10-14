import type { SourceSyncPhase, SourceSyncProgressInput, TrackalackerPushStatusInput } from "../../contracts/src/index.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { sanitizeDiagnosticData } from "../../domain/src/redaction.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope, scopedSourceConnectionId } from "./request-scope.js";
import { AuditRepository } from "./audit-repository.js";

const PUSH_STATES = new Set<TrackalackerPushStatusInput["state"]>([
  "disabled",
  "awaiting_page",
  "subscribing",
  "registering",
  "ready",
  "error"
]);
const ERROR_CODES = new Set([
  "",
  "push_api_unavailable",
  "push_subscription_read_failed",
  "subscription_key_mismatch",
  "push_subscribe_failed",
  "push_silent_migration_failed",
  "silent_push_unavailable",
  "missing_subscription",
  "incomplete_subscription",
  "subscription_fingerprint_failed",
  "page_bridge_failed",
  "network_error",
  "http_error",
  "signal_delivery_rejected",
  "signal_delivery_http",
  "local_app_unreachable"
]);
const SYNC_PHASES = new Set<SourceSyncPhase>(["starting", "discovering", "importing", "complete", "error"]);
const ACTIVE_SYNC_PHASES = new Set<SourceSyncPhase>(["starting", "discovering", "importing"]);
const SYNC_TRANSITIONS: Record<SourceSyncPhase, Set<SourceSyncPhase>> = {
  starting: new Set(["starting", "discovering", "importing", "complete", "error"]),
  discovering: new Set(["discovering", "importing", "complete", "error"]),
  importing: new Set(["importing", "complete", "error"]),
  complete: new Set(["complete"]),
  error: new Set(["error"])
};

function timestamp(value: unknown): string {
  const text = cleanText(value, 40);
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function normalizeStatus(input: TrackalackerPushStatusInput): TrackalackerPushStatusInput {
  const state = PUSH_STATES.has(input?.state) ? input.state : "error";
  const errorCode = cleanText(input?.errorCode, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_");
  const updatedAt = timestamp(input?.updatedAt);
  if (!updatedAt) throw new InputValidationError("TrackaLacker push status requires a valid update timestamp.");
  return {
    state,
    ready: input?.ready === true && state === "ready",
    subscriptionPresent: input?.subscriptionPresent === true,
    pendingSignals: Math.max(0, Math.min(50, Math.floor(Number(input?.pendingSignals) || 0))),
    lastHttpStatus: Math.max(0, Math.min(599, Math.floor(Number(input?.lastHttpStatus) || 0))),
    errorCode: ERROR_CODES.has(errorCode) ? errorCode : "",
    lastRegistrationAt: timestamp(input?.lastRegistrationAt),
    lastNotificationAt: timestamp(input?.lastNotificationAt),
    lastDeliveryAt: timestamp(input?.lastDeliveryAt),
    updatedAt
  };
}

function syncId(value: unknown): string {
  const id = cleanText(value, 120);
  if (!/^tlsync_[A-Za-z0-9_-]{8,112}$/.test(id)) throw new InputValidationError("The source sync ID is invalid.");
  return id;
}

function counter(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new InputValidationError(`${label} must be a non-negative whole number.`);
  return number;
}

function normalizeSyncProgress(input: SourceSyncProgressInput): SourceSyncProgressInput {
  const phase = SYNC_PHASES.has(input?.phase) ? input.phase : null;
  if (!phase) throw new InputValidationError("The source sync phase is invalid.");
  const normalized = {
    syncId: syncId(input.syncId),
    phase,
    page: counter(input.page, "Source sync page"),
    pages: counter(input.pages, "Source sync page count"),
    discovered: counter(input.discovered, "Source sync discovered count"),
    processed: counter(input.processed, "Source sync processed count"),
    imported: counter(input.imported, "Source sync imported count"),
    failed: counter(input.failed, "Source sync failed count"),
    message: cleanText(sanitizeDiagnosticData(input.message || ""), 300),
    ...(/^tlsync_[A-Za-z0-9_-]{8,112}$/.test(String(input.resumeOf || "")) ? { resumeOf: String(input.resumeOf) } : {})
  };
  if (normalized.pages && normalized.page > normalized.pages) throw new Error("Source sync page progress exceeds the declared page count.");
  if (normalized.processed > normalized.discovered || normalized.imported + normalized.failed > normalized.processed) {
    throw new Error("Source sync item counters are inconsistent.");
  }
  return normalized;
}

export class SourceRepository {
  private readonly auditEvents: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.auditEvents = new AuditRepository(db);
  }

  startSyncRun(deviceId: string, input: SourceSyncProgressInput, now = Date.now()): Record<string, unknown> {
    const normalized = normalizeSyncProgress(input);
    if (normalized.phase !== "starting" || [normalized.page, normalized.pages, normalized.discovered, normalized.processed, normalized.imported, normalized.failed].some(Boolean)) {
      throw new Error("A source sync run must start with zero counters.");
    }
    const device = this.db.get<{ id: string }>(
      "SELECT id FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
      cleanText(deviceId, 120),
      currentRequestScope().userId
    );
    if (!device) throw new Error("The paired Chrome device is unavailable.");
    return this.db.transaction(() => {
      const existing = this.syncRun(normalized.syncId);
      if (existing) {
        if (existing.deviceId !== device.id) throw new Error("The source sync run belongs to another Chrome device.");
        return existing;
      }
      const active = this.db.get<{ id: string; updated_at: string }>(
        `SELECT id, updated_at FROM source_sync_runs
         WHERE user_id = ? AND device_id = ? AND phase IN ('starting', 'discovering', 'importing')
         ORDER BY updated_at DESC LIMIT 1`,
        currentRequestScope().userId,
        device.id
      );
      // A run picking up one this device's companion lost (an update reloaded it)
      // closes that run now instead of waiting 30 minutes for it to look stale.
      const resuming = Boolean(active && normalized.resumeOf && active.id === normalized.resumeOf);
      if (active && !resuming && new Date(active.updated_at).getTime() >= now - 30 * 60_000) {
        throw new Error("A TrackaLacker library sync is already active for this Chrome device.");
      }
      if (active) {
        this.db.run(
          "UPDATE source_sync_runs SET phase = 'error', message = ?, completed_at = ?, updated_at = ? WHERE id = ?",
          resuming ? "Interrupted; a new run picked up where it stopped." : "The previous sync was interrupted before completion.",
          nowIso(now),
          nowIso(now),
          active.id
        );
      }
      const timestamp = nowIso(now);
      this.db.run(
        `INSERT INTO source_sync_runs(
           id, tenant_id, user_id, source_connection_id, device_id, phase,
           page, pages, discovered, processed, imported, failed, message,
           started_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, 'starting', 0, 0, 0, 0, 0, 0, ?, ?, ?, '')`,
        normalized.syncId,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        scopedSourceConnectionId("trackalacker"),
        device.id,
        normalized.message ?? "",
        timestamp,
        timestamp
      );
      this.audit(normalized.syncId, "source_sync_started", "starting", "TrackaLacker followed-library sync started.", { deviceId: device.id }, now);
      return this.syncRun(normalized.syncId) as Record<string, unknown>;
    });
  }

  updateSyncRun(deviceId: string, input: SourceSyncProgressInput, now = Date.now()): Record<string, unknown> {
    const normalized = normalizeSyncProgress(input);
    return this.db.transaction(() => {
      const current = this.syncRun(normalized.syncId);
      if (!current || current.deviceId !== cleanText(deviceId, 120)) throw new Error("The source sync run is unavailable for this Chrome device.");
      const currentPhase = current.phase as SourceSyncPhase;
      if (!SYNC_TRANSITIONS[currentPhase]?.has(normalized.phase)) throw new Error("The source sync phase transition is invalid.");
      for (const key of ["page", "pages", "discovered", "processed", "imported", "failed"] as const) {
        if (normalized[key] < Number(current[key] || 0)) throw new Error("Source sync counters cannot move backwards.");
      }
      const timestamp = nowIso(now);
      const terminal = !ACTIVE_SYNC_PHASES.has(normalized.phase);
      this.db.run(
        `UPDATE source_sync_runs SET phase = ?, page = ?, pages = ?, discovered = ?,
           processed = ?, imported = ?, failed = ?, message = ?, updated_at = ?,
           completed_at = CASE WHEN ? = 1 AND completed_at = '' THEN ? ELSE completed_at END
         WHERE id = ? AND user_id = ?`,
        normalized.phase,
        normalized.page,
        normalized.pages,
        normalized.discovered,
        normalized.processed,
        normalized.imported,
        normalized.failed,
        normalized.message ?? "",
        timestamp,
        terminal ? 1 : 0,
        timestamp,
        normalized.syncId,
        currentRequestScope().userId
      );
      if (terminal && currentPhase !== normalized.phase) {
        this.audit(
          normalized.syncId,
          "source_sync_finished",
          normalized.phase,
          normalized.phase === "complete" ? "TrackaLacker followed-library sync completed." : "TrackaLacker followed-library sync stopped with an error.",
          { discovered: normalized.discovered, processed: normalized.processed, imported: normalized.imported, failed: normalized.failed },
          now
        );
      }
      return this.syncRun(normalized.syncId) as Record<string, unknown>;
    });
  }

  recordSyncItem(
    deviceId: string,
    runId: string,
    externalProductId: string,
    result: { candidatesAccepted: number; listingsMapped: number; listingsCreated: number },
    now = Date.now()
  ): Record<string, unknown> {
    const id = syncId(runId);
    const productId = cleanText(externalProductId, 120);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(productId)) throw new Error("The source sync product identity is invalid.");
    const current = this.syncRun(id);
    if (!current || current.deviceId !== cleanText(deviceId, 120) || !ACTIVE_SYNC_PHASES.has(current.phase as SourceSyncPhase)) {
      throw new Error("The source sync run is not active for this Chrome device.");
    }
    const candidatesAccepted = counter(result.candidatesAccepted, "Accepted candidate count");
    const listingsMapped = counter(result.listingsMapped, "Mapped listing count");
    const listingsCreated = counter(result.listingsCreated, "Created listing count");
    const timestamp = nowIso(now);
    this.db.run(
      `INSERT INTO source_sync_run_items(
         id, run_id, external_product_id, outcome, candidates_accepted,
         listings_mapped, listings_created, error_code, created_at, updated_at
       ) VALUES (?, ?, ?, 'imported', ?, ?, ?, '', ?, ?)
       ON CONFLICT(run_id, external_product_id) DO UPDATE SET
         outcome = 'imported', candidates_accepted = excluded.candidates_accepted,
         listings_mapped = excluded.listings_mapped, listings_created = excluded.listings_created,
         error_code = '', updated_at = excluded.updated_at`,
      newId("sync_item"),
      id,
      productId,
      candidatesAccepted,
      listingsMapped,
      listingsCreated,
      timestamp,
      timestamp
    );
    return {
      runId: id,
      externalProductId: productId,
      outcome: "imported",
      candidatesAccepted,
      listingsMapped,
      listingsCreated,
      updatedAt: timestamp
    };
  }

  /** Products a run on this device saved, for the run that resumes it. */
  syncRunImportedProducts(deviceId: string, runId: string): string[] {
    if (!/^tlsync_[A-Za-z0-9_-]{8,112}$/.test(runId)) return [];
    const run = this.syncRun(runId);
    if (!run || run.deviceId !== cleanText(deviceId, 120)) return [];
    return this.db.all<{ id: string }>(
      "SELECT external_product_id AS id FROM source_sync_run_items WHERE run_id = ? AND outcome = 'imported'",
      runId
    ).map((row) => row.id);
  }

  listSyncRuns(limit = 20): Array<Record<string, unknown>> {
    return this.db.all(
      `SELECT ssr.id, ssr.phase, ssr.page, ssr.pages, ssr.discovered,
              ssr.processed, ssr.imported, ssr.failed, ssr.message,
              ssr.started_at AS startedAt, ssr.updated_at AS updatedAt,
              ssr.completed_at AS completedAt, ed.name AS deviceName,
              (SELECT COUNT(*) FROM source_sync_run_items ssri WHERE ssri.run_id = ssr.id) AS itemReceiptCount
       FROM source_sync_runs ssr
       LEFT JOIN extension_devices ed ON ed.id = ssr.device_id
       WHERE ssr.user_id = ? ORDER BY ssr.updated_at DESC LIMIT ?`,
      currentRequestScope().userId,
      Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)))
    );
  }

  private syncRun(id: string): Record<string, unknown> | null {
    return this.db.get<Record<string, unknown>>(
      `SELECT id, device_id AS deviceId, phase, page, pages, discovered,
              processed, imported, failed, message, started_at AS startedAt,
              updated_at AS updatedAt, completed_at AS completedAt
       FROM source_sync_runs WHERE id = ? AND user_id = ?`,
      id,
      currentRequestScope().userId
    ) ?? null;
  }

  recordTrackalackerPushStatus(deviceId: string, input: TrackalackerPushStatusInput, now = Date.now()): Record<string, unknown> {
    const normalized = normalizeStatus(input);
    const device = this.db.get<{ id: string }>(
      "SELECT id FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
      deviceId,
      currentRequestScope().userId
    );
    if (!device) throw new Error("The paired Chrome device is unavailable.");
    const previous = this.db.get<{
      state: string;
      ready: number;
      subscriptionPresent: number;
      pendingSignals: number;
      lastHttpStatus: number;
      errorCode: string;
      lastRegistrationAt: string;
      lastNotificationAt: string;
      lastDeliveryAt: string;
    }>(
      `SELECT state, ready, subscription_present AS subscriptionPresent,
              pending_signals AS pendingSignals, last_http_status AS lastHttpStatus,
              error_code AS errorCode, last_registration_at AS lastRegistrationAt,
              last_notification_at AS lastNotificationAt, last_delivery_at AS lastDeliveryAt
       FROM source_device_states WHERE device_id = ? AND source_connection_id = ?`,
      deviceId,
      scopedSourceConnectionId("trackalacker")
    );
    const materialChange = !previous
      || previous.state !== normalized.state
      || Boolean(previous.ready) !== normalized.ready
      || Boolean(previous.subscriptionPresent) !== normalized.subscriptionPresent
      || previous.pendingSignals !== normalized.pendingSignals
      || previous.lastHttpStatus !== normalized.lastHttpStatus
      || previous.errorCode !== normalized.errorCode
      || previous.lastRegistrationAt !== (normalized.lastRegistrationAt ?? "")
      || previous.lastNotificationAt !== (normalized.lastNotificationAt ?? "")
      || previous.lastDeliveryAt !== (normalized.lastDeliveryAt ?? "");
    const timestampNow = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO source_device_states(
           device_id, source_connection_id, state, ready, subscription_present,
           pending_signals, last_http_status, error_code, last_registration_at,
           last_notification_at, last_delivery_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id, source_connection_id) DO UPDATE SET
           state = excluded.state,
           ready = excluded.ready,
           subscription_present = excluded.subscription_present,
           pending_signals = excluded.pending_signals,
           last_http_status = excluded.last_http_status,
           error_code = excluded.error_code,
           last_registration_at = excluded.last_registration_at,
           last_notification_at = excluded.last_notification_at,
           last_delivery_at = excluded.last_delivery_at,
           updated_at = excluded.updated_at`,
        deviceId,
        scopedSourceConnectionId("trackalacker"),
        normalized.state,
        normalized.ready ? 1 : 0,
        normalized.subscriptionPresent ? 1 : 0,
        normalized.pendingSignals,
        normalized.lastHttpStatus,
        normalized.errorCode,
        normalized.lastRegistrationAt ?? "",
        normalized.lastNotificationAt ?? "",
        normalized.lastDeliveryAt ?? "",
        normalized.updatedAt
      );
      this.db.run(
        `UPDATE source_connections SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        normalized.ready ? "connected" : normalized.state === "error" ? "error" : "connecting",
        timestampNow,
        scopedSourceConnectionId("trackalacker"),
        currentRequestScope().userId
      );
      if (materialChange) {
        this.auditEvents.record({
          correlationId: deviceId,
          aggregateType: "source_connection",
          eventType: "source_connection_status",
          reasonCode: normalized.ready ? "ready" : normalized.state,
          message: normalized.ready ? "TrackaLacker push bridge is ready." : "TrackaLacker push bridge status changed.",
          data: {
            state: normalized.state,
            pendingSignals: normalized.pendingSignals,
            lastHttpStatus: normalized.lastHttpStatus,
            errorCode: normalized.errorCode
          }
        }, now);
      }
    });
    return normalized as unknown as Record<string, unknown>;
  }

  /**
   * The active companions' TrackaLacker push states, newest first. Source
   * freshness needs only these rows, not the catalog counts and sync runs
   * that trackalackerStatus() adds for the admin views.
   */
  trackalackerDeviceStates(): Array<Record<string, unknown> & { ready: boolean; subscriptionPresent: boolean }> {
    return this.db.all<Record<string, unknown>>(
      `SELECT sds.device_id AS deviceId, ed.name AS deviceName, sds.state,
              sds.ready, sds.subscription_present AS subscriptionPresent,
              sds.pending_signals AS pendingSignals,
              sds.last_http_status AS lastHttpStatus, sds.error_code AS errorCode,
              sds.last_registration_at AS lastRegistrationAt,
              sds.last_notification_at AS lastNotificationAt,
              sds.last_delivery_at AS lastDeliveryAt, sds.updated_at AS updatedAt
       FROM source_device_states sds
       JOIN extension_devices ed ON ed.id = sds.device_id
       WHERE sds.source_connection_id = ? AND ed.user_id = ? AND ed.status = 'active'
       ORDER BY sds.updated_at DESC`,
      scopedSourceConnectionId("trackalacker"),
      currentRequestScope().userId
    ).map((row) => ({
      ...row,
      ready: Number(row.ready) === 1,
      subscriptionPresent: Number(row.subscriptionPresent) === 1
    }));
  }

  trackalackerStatus(): Record<string, unknown> {
    const rows = this.trackalackerDeviceStates();
    const ready = rows.some((row) => row.ready === true);
    return {
      ready,
      state: ready ? "ready" : cleanText((rows[0] as Record<string, unknown> | undefined)?.state, 40) || "not_connected",
      devices: rows,
      candidateListings: Number(this.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM source_listing_candidates WHERE source_connection_id = ?",
        scopedSourceConnectionId("trackalacker")
      )?.count ?? 0),
      mappedProducts: Number(this.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM source_product_refs WHERE source_connection_id = ?",
        scopedSourceConnectionId("trackalacker")
      )?.count ?? 0),
      syncRuns: this.listSyncRuns(10),
      // Pictures: how many products have one, and the latest sanitized sample of
      // TrackaLacker's fields (its photo_items entry first), carried in diagnostics.
      productsWithImages: Number(this.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM source_product_refs spr JOIN variants v ON v.id = spr.variant_id
         WHERE spr.source_connection_id = ? AND v.image_url <> ''`,
        scopedSourceConnectionId("trackalacker")
      )?.count ?? 0),
      latestFieldSample: this.latestFieldSample(),
      // Store items a sync left as they were (the listing loop notes each once).
      listingConflicts: this.listingConflicts()
    };
  }

  private listingConflicts(): Array<Record<string, unknown>> {
    return this.db.all<{ data: string; at: string; reason: string; message: string }>(
      `SELECT data_json AS data, created_at AS at, reason_code AS reason, message FROM audit_events
       WHERE user_id = ? AND event_type = 'trackalacker_listing_conflict' ORDER BY created_at DESC LIMIT 50`,
      currentRequestScope().userId
    ).map((row) => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(row.data) as Record<string, unknown>; } catch { /* message alone */ }
      return { notedAt: row.at, reason: row.reason, message: row.message, ...data };
    });
  }

  private latestFieldSample(): Record<string, unknown> | null {
    const row = this.db.get<{ data: string; at: string }>(
      `SELECT data_json AS data, created_at AS at FROM audit_events
       WHERE user_id = ? AND event_type = 'trackalacker_sync_sample' ORDER BY created_at DESC LIMIT 1`,
      currentRequestScope().userId
    );
    if (!row) return null;
    try { return { capturedAt: row.at, ...(JSON.parse(row.data) as Record<string, unknown>) }; } catch { return null; }
  }

  private audit(
    correlationId: string,
    eventType: string,
    reasonCode: string,
    message: string,
    data: Record<string, unknown>,
    now: number
  ): void {
    this.auditEvents.record({ correlationId, aggregateType: "source_sync", eventType, reasonCode, message, data }, now);
  }
}
