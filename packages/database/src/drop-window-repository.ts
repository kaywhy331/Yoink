import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { DomainConflictError, DomainNotFoundError } from "../../domain/src/domain-request-error.js";
import { randomBytes } from "node:crypto";
import type {
  DropWindowCancelReason,
  DropWindowInput,
  DropWindowKind,
  DropWindowStatus,
  DropWindowUpdateInput,
  WatchQueueMode,
  WatchQueueObservationInput,
  WatchQueueState
} from "../../contracts/src/action-platform.js";
import {
  DROP_WINDOW_CANCEL_REASONS,
  DROP_WINDOW_CONTRACT_VERSION,
  WATCH_QUEUE_CONTRACT_VERSION
} from "../../contracts/src/action-platform.js";
import type { SignalEventInput, SupportedRetailerId } from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText, normalizeRetailerSku, positiveCents } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { SignalProviderRepository, type SignalProviderChannel } from "./signal-provider-repository.js";

const WINDOW_ID = /^drop_window_[a-f0-9]{32}$/;
const WINDOW_ITEM_ID = /^drop_window_item_[a-f0-9]{32}$/;
const WATCH_ITEM_ID = /^watch_item_[a-f0-9]{32}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{3,120}$/;
const CAPABILITY = /^[A-Za-z0-9_-]{40,100}$/;
const ACTIVE_WATCH_STATES = ["queued", "observing"] as const;
const OBSERVATION_LEASE_MS = 45_000;
const OBSERVATION_LEAD_MS = 15 * 60_000;
const MAX_PRODUCTS = 50;
type DropWindowAccessScope = "user" | "tenant";

interface ListingRow {
  listingId: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  canonicalUrl: string;
  title: string;
}

interface WindowRow {
  id: string;
  sourceChannelId: string;
  sourceConnectionId: string;
  retailerId: SupportedRetailerId;
  kind: DropWindowKind;
  title: string;
  startsAt: string;
  closesAt: string;
  spreadSeconds: number;
  confidenceBps: number;
  timezone: string;
  status: DropWindowStatus;
  supersedesId: string | null;
  supersededById: string | null;
  authorNote: string;
  createdAt: string;
  updatedAt: string;
}

interface WindowItemRow extends ListingRow {
  id: string;
  dropWindowId: string;
  ordinal: number;
  expectedAt: string;
  earlyAccessJson: string;
}

interface WatchRow extends WindowItemRow {
  watchItemId: string;
  missionId: string | null;
  assignedDeviceId: string | null;
  enrollment: "manual" | "auto_armed";
  state: WatchQueueState;
  observationStartsAt: string;
  observationClosesAt: string;
  nextObservationAt: string;
  jitterSeconds: number;
  observationCount: number;
  lastObservedAt: string;
  lastAvailability: "in_stock" | "preorder" | "out_of_stock" | "unknown";
  readinessJson: string;
  extensionVersion: string;
  leaseExpiresAt: string;
  closedReason: string;
  windowKind: DropWindowKind;
  sourceChannelId: string;
  sourceConnectionId: string;
  windowTitle: string;
  startsAt: string;
  closesAt: string;
  confidenceBps: number;
  timezone: string;
}

export interface DropWindowRecord extends Omit<WindowRow, "supersedesId" | "supersededById"> {
  supersedesId: string;
  supersededById: string;
  /** Watches still active for this window (queued or observing); cancelled and closed watches do not count. */
  optInCount: number;
  items: Array<WindowItemRow & { earlyAccess: Record<string, unknown>; watch: WatchQueueRecord | null }>;
}

export interface DropWindowOptedInUser {
  userId: string;
  displayName: string;
}

export interface DropWindowDetailRecord extends Omit<DropWindowRecord, "items"> {
  optInCount: number;
  optedInUsers: DropWindowOptedInUser[];
  items: Array<DropWindowRecord["items"][number] & {
    optInCount: number;
    watchStateCounts: Record<WatchQueueState, number>;
  }>;
}


export interface WatchQueueRecord {
  id: string;
  dropWindowId: string;
  dropWindowItemId: string;
  missionId: string;
  listingId: string;
  enrollment: "manual" | "auto_armed";
  state: WatchQueueState;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  canonicalUrl: string;
  title: string;
  windowKind: DropWindowKind;
  windowTitle: string;
  startsAt: string;
  closesAt: string;
  expectedAt: string;
  observationStartsAt: string;
  observationClosesAt: string;
  nextObservationAt: string;
  observationCount: number;
  lastObservedAt: string;
  lastAvailability: "in_stock" | "preorder" | "out_of_stock" | "unknown";
  readiness: Record<string, unknown>;
  earlyAccess: Record<string, unknown>;
  confidenceBps: number;
  timezone: string;
  closedReason: string;
}

export interface WatchQueueLease extends WatchQueueRecord {
  contractVersion: typeof WATCH_QUEUE_CONTRACT_VERSION;
  capabilityToken: string;
  leaseExpiresAt: string;
  readOnly: true;
  quantity: 1;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InputValidationError(`${label} must be a whole number from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function exactTimestamp(value: unknown, label: string): { iso: string; time: number } {
  const parsed = new Date(cleanText(value, 40));
  const time = parsed.getTime();
  if (!Number.isFinite(time)) throw new InputValidationError(`${label} must be a valid timestamp.`);
  return { iso: parsed.toISOString(), time };
}

function timezone(value: unknown): string {
  const normalized = cleanText(value || "UTC", 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(0);
  } catch {
    throw new InputValidationError("The drop-window timezone is invalid.");
  }
  return normalized;
}

function parsedObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function earlyAccess(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const membership = cleanText(input.membership, 80);
  const note = cleanText(input.note, 240);
  if (membership) output.membership = membership;
  if (input.queueExpected === true) output.queueExpected = true;
  if (note) output.note = note;
  return output;
}

function capabilityHash(token: string): string {
  return stableHash("yoink_watch_observation_capability_v1", token);
}

function safeId(value: unknown, pattern: RegExp, label: string): string {
  const normalized = cleanText(value, 120);
  if (!pattern.test(normalized)) throw new InputValidationError(`${label} is invalid.`);
  return normalized;
}

function watchRecord(row: WatchRow): WatchQueueRecord {
  return {
    id: row.watchItemId,
    dropWindowId: row.dropWindowId,
    dropWindowItemId: row.id,
    missionId: row.missionId ?? "",
    listingId: row.listingId,
    enrollment: row.enrollment,
    state: row.state,
    retailerId: row.retailerId,
    retailerSku: row.retailerSku,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    windowKind: row.windowKind,
    windowTitle: row.windowTitle,
    startsAt: row.startsAt,
    closesAt: row.closesAt,
    expectedAt: row.expectedAt,
    observationStartsAt: row.observationStartsAt,
    observationClosesAt: row.observationClosesAt,
    nextObservationAt: row.nextObservationAt,
    observationCount: Number(row.observationCount),
    lastObservedAt: row.lastObservedAt,
    lastAvailability: row.lastAvailability,
    readiness: parsedObject(row.readinessJson),
    earlyAccess: parsedObject(row.earlyAccessJson),
    confidenceBps: Number(row.confidenceBps),
    timezone: row.timezone,
    closedReason: row.closedReason
  };
}

const WINDOW_SELECT = `SELECT window.id,
  window.source_channel_id AS sourceChannelId,
  channel.source_connection_id AS sourceConnectionId,
  window.retailer_id AS retailerId, window.kind, window.title,
  window.starts_at AS startsAt, window.closes_at AS closesAt,
  window.spread_seconds AS spreadSeconds, window.confidence_bps AS confidenceBps,
  window.timezone, window.status, window.supersedes_id AS supersedesId,
  window.superseded_by_id AS supersededById, window.author_note AS authorNote,
  window.created_at AS createdAt, window.updated_at AS updatedAt
  FROM drop_windows window
  JOIN signal_provider_channels channel ON channel.id = window.source_channel_id`;

const WINDOW_ITEM_SELECT = `SELECT item.id, item.drop_window_id AS dropWindowId,
  item.ordinal, item.expected_at AS expectedAt, item.early_access_json AS earlyAccessJson,
  listing.id AS listingId, listing.retailer_id AS retailerId,
  listing.retailer_sku AS retailerSku, listing.canonical_url AS canonicalUrl,
  variant.title
  FROM drop_window_items item
  JOIN listings listing ON listing.id = item.listing_id
  JOIN variants variant ON variant.id = listing.variant_id`;

const WATCH_SELECT = `SELECT item.id, item.drop_window_id AS dropWindowId,
  item.ordinal, item.expected_at AS expectedAt, item.early_access_json AS earlyAccessJson,
  listing.id AS listingId, listing.retailer_id AS retailerId,
  listing.retailer_sku AS retailerSku, listing.canonical_url AS canonicalUrl,
  variant.title, watch.id AS watchItemId, watch.mission_id AS missionId,
  watch.assigned_device_id AS assignedDeviceId, watch.enrollment, watch.state,
  watch.observation_starts_at AS observationStartsAt,
  watch.observation_closes_at AS observationClosesAt,
  watch.next_observation_at AS nextObservationAt,
  watch.jitter_seconds AS jitterSeconds, watch.observation_count AS observationCount,
  watch.last_observed_at AS lastObservedAt, watch.last_availability AS lastAvailability,
  watch.readiness_json AS readinessJson, watch.extension_version AS extensionVersion,
  watch.lease_expires_at AS leaseExpiresAt, watch.closed_reason AS closedReason,
  window.kind AS windowKind, window.source_channel_id AS sourceChannelId,
  channel.source_connection_id AS sourceConnectionId, window.title AS windowTitle,
  window.starts_at AS startsAt, window.closes_at AS closesAt,
  window.confidence_bps AS confidenceBps, window.timezone
  FROM watch_queue_items watch
  JOIN drop_window_items item ON item.id = watch.drop_window_item_id
  JOIN drop_windows window ON window.id = watch.drop_window_id
  JOIN signal_provider_channels channel ON channel.id = window.source_channel_id
  JOIN listings listing ON listing.id = watch.listing_id
  JOIN variants variant ON variant.id = listing.variant_id`;

export class DropWindowRepository {
  private readonly providers: SignalProviderRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.providers = new SignalProviderRepository(db);
    this.audit = new AuditRepository(db);
  }

  create(input: DropWindowInput, now = Date.now()): DropWindowRecord & { signals: SignalEventInput[] } {
    if (input?.contractVersion !== DROP_WINDOW_CONTRACT_VERSION) {
      throw new InputValidationError("The drop-window contract version is unsupported.");
    }
    if (!(input.kind === "drop_window" || input.kind === "queue_open")) {
      throw new InputValidationError("Choose a drop window or queue-open signal.");
    }
    const title = cleanText(input.title, 160);
    if (title.length < 2) throw new InputValidationError("A drop-window title is required.");
    const starts = exactTimestamp(input.startsAt, "The drop-window start");
    const closes = exactTimestamp(input.closesAt, "The drop-window close");
    if (closes.time <= starts.time || closes.time - starts.time > 7 * 24 * 60 * 60_000) {
      throw new InputValidationError("A drop window must close after it starts and within seven days.");
    }
    if (starts.time < now - 60 * 60_000 || starts.time > now + 366 * 24 * 60 * 60_000) {
      throw new InputValidationError("The drop-window start is outside the supported scheduling range.");
    }
    const spreadSeconds = boundedInteger(input.spreadSeconds, "The drop spread", 0, 86_400);
    if (spreadSeconds * 1_000 > closes.time - starts.time) {
      throw new InputValidationError("The drop spread cannot exceed the window duration.");
    }
    const confidenceBps = boundedInteger(input.confidenceBps, "The confidence", 0, 10_000);
    const windowTimezone = timezone(input.timezone);
    if (!Array.isArray(input.products) || input.products.length < 1 || input.products.length > MAX_PRODUCTS) {
      throw new InputValidationError(`A drop window requires 1 through ${MAX_PRODUCTS} exact products.`);
    }
    const productIds = input.products.map((item) => cleanText(item?.listingId, 120));
    if (productIds.some((id) => !id) || new Set(productIds).size !== productIds.length) {
      throw new InputValidationError("Drop-window products must be unique exact listing IDs.");
    }
    const listings = productIds.map((listingId) => this.requireListing(listingId, input.retailerId));
    const scope = currentRequestScope();
    const supersedesId = input.supersedesId
      ? safeId(input.supersedesId, WINDOW_ID, "The superseded drop window")
      : "";
    const previous = supersedesId ? this.requireWindow(supersedesId, "tenant") : null;
    if (previous && (previous.retailerId !== input.retailerId || !["scheduled", "active"].includes(previous.status))) {
      throw new DomainConflictError("drop_window_supersede_invalid", "Only an active or scheduled window for the same retailer can be superseded.");
    }
    const channel = this.providers.createChannel({
      provider: "drop_window",
      name: "Admin drop windows",
      externalReference: "admin-drop-window-v1",
      trustLevel: "trusted_exact",
      autoCreateMissions: false,
      replayWindowSeconds: 86_400
    }, now);
    const windowId = newId("drop_window");
    const createdAt = nowIso(now);
    const status: DropWindowStatus = starts.time <= now && closes.time > now ? "active" : "scheduled";
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO drop_windows(
           id, tenant_id, user_id, source_channel_id, retailer_id, kind, title,
           starts_at, closes_at, spread_seconds, confidence_bps, timezone, status,
           supersedes_id, superseded_by_id, author_note, created_by_actor_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        windowId, scope.tenantId, scope.userId, channel.id, input.retailerId,
        input.kind, title, starts.iso, closes.iso, spreadSeconds, confidenceBps,
        windowTimezone, status, previous?.id ?? null, cleanText(input.authorNote, 500),
        scope.actorId, createdAt, createdAt
      );
      // Both supersession columns are foreign keys. Persist the replacement
      // before pointing the previous window at it, then retire only watches
      // owned by the superseded window inside the same transaction.
      if (previous) {
        this.db.run(
          `UPDATE drop_windows SET status = 'superseded', superseded_by_id = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
          windowId, createdAt, previous.id, scope.tenantId
        );
        this.db.run(
          `UPDATE watch_queue_items SET state = 'cancelled', closed_reason = 'window_superseded',
             observation_capability_hash = '', lease_expires_at = '', updated_at = ?
           WHERE drop_window_id = ? AND tenant_id = ? AND state IN ('queued', 'observing')`,
          createdAt, previous.id, scope.tenantId
        );
      }
      listings.forEach((listing, ordinal) => {
        const expectedOffset = listings.length <= 1
          ? 0
          : Math.round((spreadSeconds * 1_000 * ordinal) / (listings.length - 1));
        const itemId = newId("drop_window_item");
        this.db.run(
          `INSERT INTO drop_window_items(
             id, tenant_id, user_id, drop_window_id, listing_id, ordinal,
             expected_at, early_access_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          itemId, scope.tenantId, scope.userId, windowId, listing.listingId, ordinal,
          nowIso(starts.time + expectedOffset),
          JSON.stringify(earlyAccess(input.products[ordinal]?.earlyAccess)), createdAt
        );
        if (this.watchQueueMode() === "auto_armed") {
          const missionId = this.armedMissionForListing(listing.listingId);
          if (missionId) this.insertWatchItem(windowId, itemId, listing.listingId, missionId, "auto_armed", starts.time, closes.time, ordinal, now);
        }
      });
      this.audit.record({
        correlationId: windowId,
        aggregateType: "drop_window",
        eventType: "drop_window_authored",
        reasonCode: input.kind === "queue_open" ? "queue_open_authored" : "drop_window_authored",
        message: "An administrator authored a bounded product observation window.",
        data: {
          dropWindowId: windowId,
          retailerId: input.retailerId,
          kind: input.kind,
          productCount: listings.length,
          spreadSeconds,
          confidenceBps,
          supersedesId: previous?.id ?? ""
        }
      }, now);
    });
    const saved = this.get(windowId);
    if (!saved) throw new Error("The drop window could not be loaded after creation.");
    return { ...saved, signals: this.windowSignals(saved, channel, now) };
  }

  list(now = Date.now(), includeClosed = true, accessScope: DropWindowAccessScope = "user"): DropWindowRecord[] {
    this.refreshWindowStates(now, accessScope);
    const scope = currentRequestScope();
    const ownership = accessScope === "tenant" ? "" : " AND window.user_id = ?";
    const parameters = accessScope === "tenant"
      ? [scope.tenantId, includeClosed ? 1 : 0]
      : [scope.tenantId, scope.userId, includeClosed ? 1 : 0];
    return this.db.all<WindowRow>(
      `${WINDOW_SELECT}
       WHERE window.tenant_id = ?${ownership}
         AND (? = 1 OR window.status IN ('scheduled', 'active'))
       ORDER BY window.starts_at DESC, window.id DESC`,
      ...parameters
    ).map((row) => this.hydrateWindow(row, accessScope));
  }

  detail(id: string, now = Date.now(), accessScope: DropWindowAccessScope = "user"): DropWindowDetailRecord | null {
    this.refreshWindowStates(now, accessScope);
    const window = this.get(id, accessScope);
    if (!window) return null;
    const scope = currentRequestScope();
    const counts = this.db.all<{ itemId: string; state: WatchQueueState; count: number }>(
      `SELECT drop_window_item_id AS itemId, state, COUNT(*) AS count
       FROM watch_queue_items
       WHERE drop_window_id = ? AND tenant_id = ?
       GROUP BY drop_window_item_id, state`,
      window.id, scope.tenantId
    );
    const byItem = new Map<string, Record<WatchQueueState, number>>();
    for (const row of counts) {
      const current = byItem.get(row.itemId) ?? {
        queued: 0,
        observing: 0,
        seen_in_stock: 0,
        window_closed: 0,
        cancelled: 0
      };
      current[row.state] = Number(row.count);
      byItem.set(row.itemId, current);
    }
    const items = window.items.map((item) => {
      const watchStateCounts = byItem.get(item.id) ?? {
        queued: 0,
        observing: 0,
        seen_in_stock: 0,
        window_closed: 0,
        cancelled: 0
      };
      return {
        ...item,
        optInCount: watchStateCounts.queued + watchStateCounts.observing,
        watchStateCounts
      };
    });
    const optedInUsers = this.db.all<DropWindowOptedInUser>(
      `SELECT DISTINCT watch.user_id AS userId,
              COALESCE(person.display_name, 'Unknown user') AS displayName
       FROM watch_queue_items watch
       LEFT JOIN users person ON person.id = watch.user_id AND person.tenant_id = watch.tenant_id
       WHERE watch.drop_window_id = ? AND watch.tenant_id = ?
         AND watch.state IN ('queued', 'observing')
       ORDER BY displayName COLLATE NOCASE, watch.user_id`,
      window.id, scope.tenantId
    ).map((row) => ({ userId: row.userId, displayName: row.displayName }));
    return {
      ...window,
      optInCount: items.reduce((sum, item) => sum + item.optInCount, 0),
      optedInUsers,
      items
    };
  }

  update(
    id: string,
    input: DropWindowUpdateInput,
    now = Date.now(),
    accessScope: DropWindowAccessScope = "user"
  ): DropWindowDetailRecord {
    const windowId = safeId(id, WINDOW_ID, "The drop window");
    this.refreshWindowStates(now, accessScope);
    const current = this.requireWindow(windowId, accessScope);
    if (current.status !== "scheduled") {
      throw new DomainConflictError("drop_window_not_editable", "Only a scheduled drop window can be edited.");
    }
    const observing = this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM watch_queue_items
       WHERE drop_window_id = ? AND tenant_id = ? AND state = 'observing'`,
      windowId, currentRequestScope().tenantId
    )?.count ?? 0;
    if (Number(observing) > 0) {
      throw new DomainConflictError("drop_window_not_editable", "This drop window is already being observed and can no longer be edited.");
    }

    const title = input.title === undefined ? current.title : cleanText(input.title, 160);
    if (title.length < 2) throw new InputValidationError("A drop-window title is required.");
    const starts = input.startsAt === undefined
      ? { iso: current.startsAt, time: new Date(current.startsAt).getTime() }
      : exactTimestamp(input.startsAt, "The drop-window start");
    const closes = input.closesAt === undefined
      ? { iso: current.closesAt, time: new Date(current.closesAt).getTime() }
      : exactTimestamp(input.closesAt, "The drop-window close");
    if (closes.time <= starts.time || closes.time - starts.time > 7 * 24 * 60 * 60_000) {
      throw new InputValidationError("A drop window must close after it starts and within seven days.");
    }
    if (starts.time < now - 60 * 60_000 || starts.time > now + 366 * 24 * 60 * 60_000) {
      throw new InputValidationError("The drop-window start is outside the supported scheduling range.");
    }
    const spreadSeconds = input.spreadSeconds === undefined
      ? Number(current.spreadSeconds)
      : boundedInteger(input.spreadSeconds, "The drop stagger", 0, 86_400);
    if (spreadSeconds * 1_000 > closes.time - starts.time) {
      throw new InputValidationError("The drop stagger cannot exceed the window duration.");
    }
    const confidenceBps = input.confidenceBps === undefined
      ? Number(current.confidenceBps)
      : boundedInteger(input.confidenceBps, "The confidence", 0, 10_000);
    const windowTimezone = input.timezone === undefined ? current.timezone : timezone(input.timezone);
    const authorNote = input.authorNote === undefined ? current.authorNote : cleanText(input.authorNote, 500);
    const updateEarlyAccessNote = Object.prototype.hasOwnProperty.call(input, "earlyAccessNote");
    const earlyAccessNote = updateEarlyAccessNote ? cleanText(input.earlyAccessNote, 240) : "";
    const timestamp = nowIso(now);
    const scope = currentRequestScope();
    const itemOwnership = accessScope === "tenant" ? "" : " AND user_id = ?";
    const itemParameters = accessScope === "tenant"
      ? [windowId, scope.tenantId]
      : [windowId, scope.tenantId, scope.userId];
    const items = this.db.all<{ id: string; ordinal: number; earlyAccessJson: string }>(
      `SELECT id, ordinal, early_access_json AS earlyAccessJson
       FROM drop_window_items
       WHERE drop_window_id = ? AND tenant_id = ?${itemOwnership}
       ORDER BY ordinal`,
      ...itemParameters
    );

    this.db.transaction(() => {
      const windowOwnership = accessScope === "tenant" ? "" : " AND user_id = ?";
      const windowParameters = accessScope === "tenant"
        ? [title, starts.iso, closes.iso, spreadSeconds, confidenceBps,
            windowTimezone, authorNote, timestamp, windowId, scope.tenantId]
        : [title, starts.iso, closes.iso, spreadSeconds, confidenceBps,
            windowTimezone, authorNote, timestamp, windowId, scope.tenantId, scope.userId];
      const updateResult = this.db.run(
        `UPDATE drop_windows
         SET title = ?, starts_at = ?, closes_at = ?, spread_seconds = ?,
             confidence_bps = ?, timezone = ?, author_note = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?${windowOwnership} AND status = 'scheduled'`,
        ...windowParameters
      );
      if (updateResult.changes !== 1) {
        throw new DomainConflictError("drop_window_changed", "The scheduled drop window changed before this edit could be saved.");
      }
      items.forEach((item, index) => {
        const expectedOffset = items.length <= 1
          ? 0
          : Math.round((spreadSeconds * 1_000 * index) / (items.length - 1));
        const access = parsedObject(item.earlyAccessJson);
        if (updateEarlyAccessNote) {
          if (earlyAccessNote) access.note = earlyAccessNote;
          else delete access.note;
        }
        const updateItemParameters = accessScope === "tenant"
          ? [nowIso(starts.time + expectedOffset), JSON.stringify(access), item.id,
              windowId, scope.tenantId]
          : [nowIso(starts.time + expectedOffset), JSON.stringify(access), item.id,
              windowId, scope.tenantId, scope.userId];
        this.db.run(
          `UPDATE drop_window_items SET expected_at = ?, early_access_json = ?
           WHERE id = ? AND drop_window_id = ? AND tenant_id = ?${itemOwnership}`,
          ...updateItemParameters
        );
      });
      const watches = this.db.all<{ id: string; ordinal: number; jitterSeconds: number }>(
        `SELECT watch.id, item.ordinal, watch.jitter_seconds AS jitterSeconds
         FROM watch_queue_items watch
         JOIN drop_window_items item ON item.id = watch.drop_window_item_id
         WHERE watch.drop_window_id = ? AND watch.tenant_id = ? AND watch.state = 'queued'`,
        windowId, scope.tenantId
      );
      for (const watch of watches) {
        const observationStartsAt = Math.max(now, starts.time - OBSERVATION_LEAD_MS);
        const nextObservationAt = Math.min(
          closes.time,
          observationStartsAt + ((Number(watch.ordinal) * Number(watch.jitterSeconds)) % 120) * 1_000
        );
        this.db.run(
          `UPDATE watch_queue_items
           SET observation_starts_at = ?, observation_closes_at = ?, next_observation_at = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND state = 'queued'`,
          nowIso(observationStartsAt), nowIso(closes.time), nowIso(nextObservationAt),
          timestamp, watch.id, scope.tenantId
        );
      }
      this.audit.record({
        correlationId: windowId,
        aggregateType: "drop_window",
        eventType: "drop_window_updated",
        reasonCode: "scheduled_window_edited",
        message: "An administrator updated a scheduled drop window.",
        data: {
          dropWindowId: windowId,
          productCount: items.length,
          spreadSeconds,
          confidenceBps
        }
      }, now);
    });
    const saved = this.detail(windowId, now, accessScope);
    if (!saved) throw new Error("The updated drop window could not be loaded.");
    return saved;
  }

  cancelWindow(
    id: string,
    reasonCode: DropWindowCancelReason,
    now = Date.now(),
    accessScope: DropWindowAccessScope = "user"
  ): DropWindowDetailRecord {
    const windowId = safeId(id, WINDOW_ID, "The drop window");
    if (!DROP_WINDOW_CANCEL_REASONS.includes(reasonCode)) {
      throw new InputValidationError("Choose a valid reason for cancelling the drop window.");
    }
    this.refreshWindowStates(now, accessScope);
    const current = this.requireWindow(windowId, accessScope);
    if (current.status === "cancelled") {
      const cancelled = this.detail(windowId, now, accessScope);
      if (!cancelled) throw new Error("The cancelled drop window could not be loaded.");
      return cancelled;
    }
    if (!["scheduled", "active"].includes(current.status)) {
      throw new DomainConflictError("drop_window_not_open", "Only an open drop window can be cancelled.");
    }
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const watches = this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM watch_queue_items
       WHERE drop_window_id = ? AND tenant_id = ? AND state IN ('queued', 'observing')`,
      windowId, scope.tenantId
    )?.count ?? 0;
    this.db.transaction(() => {
      const windowOwnership = accessScope === "tenant" ? "" : " AND user_id = ?";
      const windowParameters = accessScope === "tenant"
        ? [timestamp, windowId, scope.tenantId]
        : [timestamp, windowId, scope.tenantId, scope.userId];
      const cancelResult = this.db.run(
        `UPDATE drop_windows SET status = 'cancelled', updated_at = ?
         WHERE id = ? AND tenant_id = ?${windowOwnership} AND status IN ('scheduled', 'active')`,
        ...windowParameters
      );
      if (cancelResult.changes !== 1) {
        throw new DomainConflictError("drop_window_changed", "The open drop window changed before it could be cancelled.");
      }
      this.db.run(
        `UPDATE watch_queue_items
         SET state = 'cancelled', closed_reason = 'window_cancelled', assigned_device_id = NULL,
             observation_capability_hash = '', lease_expires_at = '', updated_at = ?
         WHERE drop_window_id = ? AND tenant_id = ? AND state IN ('queued', 'observing')`,
        timestamp, windowId, scope.tenantId
      );
      this.audit.record({
        correlationId: windowId,
        aggregateType: "drop_window",
        eventType: "drop_window_cancelled",
        reasonCode,
        message: "An administrator cancelled a drop window and its remaining read-only watches.",
        data: {
          dropWindowId: windowId,
          cancelledWatchCount: Number(watches),
          actionJobsTouched: 0
        }
      }, now);
    });
    const saved = this.detail(windowId, now, accessScope);
    if (!saved) throw new Error("The cancelled drop window could not be loaded.");
    return saved;
  }

  watchQueueMode(): WatchQueueMode {
    const value = this.db.get<{ mode: string }>(
      `SELECT watch_queue_mode AS mode FROM app_settings WHERE user_id = ?`,
      currentRequestScope().userId
    )?.mode;
    return value === "auto_armed" ? "auto_armed" : "manual";
  }

  setWatchQueueMode(mode: WatchQueueMode, now = Date.now()): {
    mode: WatchQueueMode;
    previousMode: WatchQueueMode;
    newlyEnrolledCount: number;
  } {
    if (!(["manual", "auto_armed"] as const).includes(mode)) {
      throw new InputValidationError("Choose manual watch enrollment or automatic enrollment for armed plans.");
    }
    const scope = currentRequestScope();
    const previousMode = this.watchQueueMode();
    const timestamp = nowIso(now);
    let newlyEnrolledCount = 0;
    this.db.transaction(() => {
      this.db.run(
        `UPDATE app_settings SET watch_queue_mode = ?, updated_at = ? WHERE user_id = ?`,
        mode, timestamp, scope.userId
      );
      if (mode === "auto_armed") {
        const candidates = this.db.all<{
          dropWindowId: string;
          itemId: string;
          listingId: string;
          startsAt: string;
          closesAt: string;
          ordinal: number;
        }>(
          `SELECT window.id AS dropWindowId, item.id AS itemId,
                  item.listing_id AS listingId, window.starts_at AS startsAt,
                  window.closes_at AS closesAt, item.ordinal
           FROM drop_window_items item
           JOIN drop_windows window ON window.id = item.drop_window_id
           LEFT JOIN watch_queue_items watch ON watch.drop_window_item_id = item.id
             AND watch.tenant_id = item.tenant_id AND watch.user_id = item.user_id
           WHERE item.tenant_id = ? AND item.user_id = ?
             AND window.status IN ('scheduled', 'active') AND window.closes_at > ?
             AND watch.id IS NULL
           ORDER BY window.starts_at, item.ordinal, item.id`,
          scope.tenantId, scope.userId, timestamp
        );
        for (const candidate of candidates) {
          const missionId = this.armedMissionForListing(candidate.listingId);
          if (!missionId) continue;
          this.insertWatchItem(
            candidate.dropWindowId,
            candidate.itemId,
            candidate.listingId,
            missionId,
            "auto_armed",
            new Date(candidate.startsAt).getTime(),
            new Date(candidate.closesAt).getTime(),
            Number(candidate.ordinal),
            now
          );
          newlyEnrolledCount += 1;
        }
      }
      if (previousMode !== mode || newlyEnrolledCount > 0) {
        this.audit.record({
          correlationId: scope.userId,
          aggregateType: "watch_queue",
          eventType: "watch_queue_mode_changed",
          reasonCode: mode === "auto_armed" ? "auto_armed_enabled" : "manual_enrollment_enabled",
          message: mode === "auto_armed"
            ? "Future and currently open drop-window items with an armed exact plan will enter the read-only watch queue automatically."
            : "Drop-window items now require explicit manual watch enrollment.",
          data: { previousMode, mode, newlyEnrolledCount }
        }, now);
      }
    });
    return { mode, previousMode, newlyEnrolledCount };
  }

  get(id: string, accessScope: DropWindowAccessScope = "user"): DropWindowRecord | null {
    const safeWindowId = safeId(id, WINDOW_ID, "The drop window");
    const scope = currentRequestScope();
    const ownership = accessScope === "tenant" ? "" : " AND window.user_id = ?";
    const parameters = accessScope === "tenant"
      ? [safeWindowId, scope.tenantId]
      : [safeWindowId, scope.tenantId, scope.userId];
    const row = this.db.get<WindowRow>(
      `${WINDOW_SELECT} WHERE window.id = ? AND window.tenant_id = ?${ownership}`,
      ...parameters
    );
    return row ? this.hydrateWindow(row, accessScope) : null;
  }

  enroll(dropWindowItemId: string, now = Date.now()): WatchQueueRecord {
    const itemId = safeId(dropWindowItemId, WINDOW_ITEM_ID, "The drop-window item");
    const scope = currentRequestScope();
    const item = this.db.get<WindowItemRow & { startsAt: string; closesAt: string; status: DropWindowStatus }>(
      `SELECT item.id, item.drop_window_id AS dropWindowId,
              item.ordinal, item.expected_at AS expectedAt,
              item.early_access_json AS earlyAccessJson,
              listing.id AS listingId, listing.retailer_id AS retailerId,
              listing.retailer_sku AS retailerSku, listing.canonical_url AS canonicalUrl,
              variant.title, window.starts_at AS startsAt,
              window.closes_at AS closesAt, window.status
       FROM drop_window_items item
       JOIN listings listing ON listing.id = item.listing_id
       JOIN variants variant ON variant.id = listing.variant_id
       JOIN drop_windows window ON window.id = item.drop_window_id
       WHERE item.id = ? AND item.tenant_id = ? AND item.user_id = ?`,
      itemId, scope.tenantId, scope.userId
    );
    if (!item || !["scheduled", "active"].includes(item.status)) {
      throw new DomainConflictError("watch_item_not_open", "This drop-window item is no longer open for watching.");
    }
    const existing = this.watchForWindowItem(item.id);
    if (existing) return existing;
    const missionId = this.missionForListing(item.listingId);
    this.insertWatchItem(
      item.dropWindowId, item.id, item.listingId, missionId, "manual",
      new Date(item.startsAt).getTime(), new Date(item.closesAt).getTime(), item.ordinal, now
    );
    const watch = this.watchForWindowItem(item.id);
    if (!watch) throw new Error("The watch-queue item could not be loaded after enrollment.");
    this.audit.record({
      correlationId: watch.id,
      aggregateType: "watch_queue",
      eventType: "watch_queue_enrolled",
      reasonCode: "user_opt_in",
      message: "The user opted one exact item into bounded read-only drop observation.",
      data: { dropWindowId: watch.dropWindowId, listingId: item.listingId, missionId }
    }, now);
    return watch;
  }

  cancel(watchItemId: string, now = Date.now()): WatchQueueRecord {
    const safeWatchId = safeId(watchItemId, WATCH_ITEM_ID, "The watch-queue item");
    const current = this.requireWatch(safeWatchId);
    if (["seen_in_stock", "window_closed", "cancelled"].includes(current.state)) return watchRecord(current);
    this.db.run(
      `UPDATE watch_queue_items SET state = 'cancelled', closed_reason = 'user_cancelled',
         observation_capability_hash = '', lease_expires_at = '', updated_at = ?
       WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      nowIso(now), safeWatchId, currentRequestScope().tenantId, currentRequestScope().userId
    );
    return this.getWatch(safeWatchId) as WatchQueueRecord;
  }

  listWatchQueue(now = Date.now()): WatchQueueRecord[] {
    this.refreshWindowStates(now);
    const scope = currentRequestScope();
    return this.db.all<WatchRow>(
      `${WATCH_SELECT}
       WHERE watch.tenant_id = ? AND watch.user_id = ?
       ORDER BY CASE watch.state WHEN 'observing' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                watch.next_observation_at, watch.id`,
      scope.tenantId, scope.userId
    ).map(watchRecord);
  }

  leaseNext(deviceId: string, now = Date.now()): { item: WatchQueueLease | null; reason: string } {
    const safeDeviceId = safeId(deviceId, DEVICE_ID, "The paired device");
    this.refreshWindowStates(now);
    const scope = currentRequestScope();
    return this.db.transaction(() => {
      const device = this.db.get<{ id: string }>(
        `SELECT id FROM extension_devices
         WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'active'`,
        safeDeviceId, scope.tenantId, scope.userId
      );
      if (!device) return { item: null, reason: "device_unavailable" };
      const row = this.db.get<WatchRow>(
        `${WATCH_SELECT}
         WHERE watch.tenant_id = ? AND watch.user_id = ?
           AND watch.state IN ('queued', 'observing')
           AND watch.observation_starts_at <= ? AND watch.observation_closes_at > ?
           AND watch.next_observation_at <= ?
           AND (watch.state = 'queued' OR watch.lease_expires_at = '' OR watch.lease_expires_at <= ?)
         ORDER BY watch.next_observation_at, watch.id LIMIT 1`,
        scope.tenantId, scope.userId, nowIso(now), nowIso(now), nowIso(now), nowIso(now)
      );
      if (!row) return { item: null, reason: "no_watch_items" };
      const capabilityToken = randomBytes(32).toString("base64url");
      const closeTime = new Date(row.observationClosesAt).getTime();
      const leaseExpiresAt = nowIso(Math.min(closeTime, now + OBSERVATION_LEASE_MS));
      this.db.run(
        `UPDATE watch_queue_items SET state = 'observing', assigned_device_id = ?,
           observation_capability_hash = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ?`,
        safeDeviceId, capabilityHash(capabilityToken), leaseExpiresAt, nowIso(now),
        row.watchItemId, scope.tenantId, scope.userId
      );
      const leased = this.requireWatch(row.watchItemId);
      return {
        reason: "leased",
        item: {
          ...watchRecord(leased),
          contractVersion: WATCH_QUEUE_CONTRACT_VERSION,
          capabilityToken,
          leaseExpiresAt,
          readOnly: true,
          quantity: 1
        }
      };
    });
  }

  recordObservation(
    deviceId: string,
    watchItemId: string,
    input: WatchQueueObservationInput,
    now = Date.now()
  ): { item: WatchQueueRecord; signal: SignalEventInput | null; channel: SignalProviderChannel } {
    if (input?.contractVersion !== WATCH_QUEUE_CONTRACT_VERSION || !CAPABILITY.test(input.capabilityToken)) {
      throw new InputValidationError("A valid watch-observation capability is required.");
    }
    const safeDeviceId = safeId(deviceId, DEVICE_ID, "The paired device");
    const safeWatchId = safeId(watchItemId, WATCH_ITEM_ID, "The watch-queue item");
    const observed = exactTimestamp(input.observedAt, "The watch observation");
    if (observed.time > now + 5 * 60_000 || observed.time < now - 10 * 60_000) {
      throw new InputValidationError("The watch observation is stale or too far in the future.");
    }
    return this.db.transaction(() => {
      const row = this.requireWatch(safeWatchId);
      if (row.state !== "observing" || row.assignedDeviceId !== safeDeviceId
        || row.leaseExpiresAt < nowIso(now)
        || this.watchCapabilityHash(safeWatchId) !== capabilityHash(input.capabilityToken)) {
        throw new Error("The watch-observation capability is invalid or expired.");
      }
      if (input.retailerId !== row.retailerId
        || normalizeRetailerSku(input.retailerSku) !== normalizeRetailerSku(row.retailerSku)) {
        throw new InputValidationError("The watch observation does not match the leased exact retailer item.");
      }
      const availability = ["in_stock", "preorder", "out_of_stock", "unknown"].includes(String(input.availability))
        ? input.availability
        : "unknown";
      const actionable = availability === "in_stock";
      const observationCount = Number(row.observationCount) + 1;
      const nextDelaySeconds = Math.min(300, Math.max(15,
        Number(row.jitterSeconds) + ((observationCount * 17) % Math.max(1, Number(row.jitterSeconds)))));
      const nextObservationAt = nowIso(Math.min(
        new Date(row.observationClosesAt).getTime(),
        now + nextDelaySeconds * 1_000
      ));
      const readiness = {
        readOnly: true,
        observerVersion: cleanText(input.observerVersion, 80),
        reasonCode: cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_")
      };
      this.db.run(
        `UPDATE watch_queue_items SET state = ?, observation_count = ?, last_observed_at = ?,
           last_availability = ?, readiness_json = ?, extension_version = ?,
           next_observation_at = ?, assigned_device_id = NULL,
           observation_capability_hash = '', lease_expires_at = '', closed_reason = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ?`,
        actionable ? "seen_in_stock" : "queued", observationCount, observed.iso,
        availability, JSON.stringify(readiness), cleanText(input.extensionVersion, 40),
        nextObservationAt, actionable ? "observed_in_stock" : "", nowIso(now),
        safeWatchId, currentRequestScope().tenantId, currentRequestScope().userId
      );
      const channel = this.providers.requireActiveChannel(row.sourceChannelId, "drop_window");
      const signal = actionable ? this.observationSignal(row, input, channel, observed.iso, now) : null;
      this.audit.record({
        correlationId: safeWatchId,
        aggregateType: "watch_queue",
        eventType: actionable ? "watch_item_seen_in_stock" : "watch_item_observed",
        reasonCode: actionable ? "observed_in_stock" : "read_only_observation",
        message: actionable
          ? "Bounded read-only observation saw the exact queued item in stock."
          : "Bounded read-only observation completed without an actionable stock claim.",
        data: {
          dropWindowId: row.dropWindowId,
          retailerId: row.retailerId,
          retailerSku: row.retailerSku,
          availability,
          observationCount,
          readOnly: true
        }
      }, now);
      return { item: this.getWatch(safeWatchId) as WatchQueueRecord, signal, channel };
    });
  }

  private requireListing(listingId: string, retailerId: string): ListingRow {
    const row = this.db.get<ListingRow>(
      `SELECT listing.id AS listingId, listing.retailer_id AS retailerId,
              listing.retailer_sku AS retailerSku, listing.canonical_url AS canonicalUrl,
              variant.title
       FROM listings listing JOIN variants variant ON variant.id = listing.variant_id
       WHERE listing.id = ? AND listing.retailer_id = ?`,
      cleanText(listingId, 120), cleanText(retailerId, 60)
    );
    if (!row) throw new InputValidationError("Every drop-window product must be an exact listing for the selected retailer.");
    return row;
  }

  private requireWindow(id: string, accessScope: DropWindowAccessScope = "user"): WindowRow {
    const scope = currentRequestScope();
    const ownership = accessScope === "tenant" ? "" : " AND window.user_id = ?";
    const parameters = accessScope === "tenant"
      ? [id, scope.tenantId]
      : [id, scope.tenantId, scope.userId];
    const row = this.db.get<WindowRow>(
      `${WINDOW_SELECT} WHERE window.id = ? AND window.tenant_id = ?${ownership}`,
      ...parameters
    );
    if (!row) throw new DomainNotFoundError("drop_window_not_found", "The drop window does not exist.");
    return row;
  }

  private hydrateWindow(row: WindowRow, accessScope: DropWindowAccessScope = "user"): DropWindowRecord {
    const scope = currentRequestScope();
    const ownership = accessScope === "tenant" ? "" : " AND item.user_id = ?";
    const parameters = accessScope === "tenant"
      ? [row.id, scope.tenantId]
      : [row.id, scope.tenantId, scope.userId];
    const items = this.db.all<WindowItemRow>(
      `${WINDOW_ITEM_SELECT}
       WHERE item.drop_window_id = ? AND item.tenant_id = ?${ownership}
       ORDER BY item.ordinal`,
      ...parameters
    ).map((item) => ({
      ...item,
      ordinal: Number(item.ordinal),
      earlyAccess: parsedObject(item.earlyAccessJson),
      watch: this.watchForWindowItem(item.id, accessScope)
    }));
    return {
      ...row,
      spreadSeconds: Number(row.spreadSeconds),
      confidenceBps: Number(row.confidenceBps),
      supersedesId: row.supersedesId ?? "",
      supersededById: row.supersededById ?? "",
      optInCount: items.filter((item) => item.watch && (ACTIVE_WATCH_STATES as readonly WatchQueueState[]).includes(item.watch.state)).length,
      items
    };
  }

  private armedMissionForListing(listingId: string): string {
    return this.db.get<{ id: string }>(
      `SELECT mission.id
       FROM missions mission
       JOIN mission_targets target ON target.mission_id = mission.id
       JOIN mission_intent_revisions intent ON intent.id = (
         SELECT latest.id FROM mission_intent_revisions latest
         WHERE latest.mission_id = mission.id ORDER BY latest.revision DESC LIMIT 1
       )
       WHERE mission.tenant_id = ? AND mission.user_id = ? AND mission.status = 'active'
         AND mission.fulfilled_quantity < mission.target_quantity
         AND target.listing_id = ? AND target.enabled = 1
         AND intent.action_ceiling = 'add_to_cart'
       ORDER BY mission.updated_at DESC LIMIT 1`,
      currentRequestScope().tenantId, currentRequestScope().userId, listingId
    )?.id ?? "";
  }

  private missionForListing(listingId: string): string {
    return this.db.get<{ id: string }>(
      `SELECT mission.id FROM missions mission
       JOIN mission_targets target ON target.mission_id = mission.id
       WHERE mission.tenant_id = ? AND mission.user_id = ?
         AND mission.status IN ('active', 'paused') AND target.listing_id = ?
       ORDER BY mission.updated_at DESC LIMIT 1`,
      currentRequestScope().tenantId, currentRequestScope().userId, listingId
    )?.id ?? "";
  }

  private insertWatchItem(
    windowId: string,
    itemId: string,
    listingId: string,
    missionId: string,
    enrollment: "manual" | "auto_armed",
    startsAt: number,
    closesAt: number,
    ordinal: number,
    now: number
  ): void {
    const scope = currentRequestScope();
    const observationStartsAt = Math.max(now, startsAt - OBSERVATION_LEAD_MS);
    const jitterSeconds = 15 + Number.parseInt(stableHash(windowId, itemId).slice(0, 4), 16) % 46;
    const firstObservationAt = Math.min(closesAt, observationStartsAt + ((ordinal * jitterSeconds) % 120) * 1_000);
    this.db.run(
      `INSERT OR IGNORE INTO watch_queue_items(
         id, tenant_id, user_id, drop_window_id, drop_window_item_id, listing_id,
         mission_id, assigned_device_id, enrollment, state, observation_starts_at,
         observation_closes_at, next_observation_at, jitter_seconds, observation_count,
         last_observed_at, last_availability, readiness_json, extension_version,
         observation_capability_hash, lease_expires_at, closed_reason, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'queued', ?, ?, ?, ?, 0,
                 '', 'unknown', '{}', '', '', '', '', ?, ?)`,
      newId("watch_item"), scope.tenantId, scope.userId, windowId, itemId, listingId,
      missionId || null, enrollment, nowIso(observationStartsAt), nowIso(closesAt),
      nowIso(firstObservationAt), jitterSeconds, nowIso(now), nowIso(now)
    );
  }

  private watchForWindowItem(itemId: string, accessScope: DropWindowAccessScope = "user"): WatchQueueRecord | null {
    const scope = currentRequestScope();
    const ownership = accessScope === "tenant" ? "" : " AND watch.user_id = ?";
    const parameters = accessScope === "tenant"
      ? [itemId, scope.tenantId]
      : [itemId, scope.tenantId, scope.userId];
    const row = this.db.get<WatchRow>(
      `${WATCH_SELECT}
       WHERE watch.drop_window_item_id = ? AND watch.tenant_id = ?${ownership}
       ORDER BY watch.updated_at DESC, watch.id DESC LIMIT 1`,
      ...parameters
    );
    return row ? watchRecord(row) : null;
  }

  private getWatch(id: string): WatchQueueRecord | null {
    const scope = currentRequestScope();
    const row = this.db.get<WatchRow>(
      `${WATCH_SELECT} WHERE watch.id = ? AND watch.tenant_id = ? AND watch.user_id = ?`,
      id, scope.tenantId, scope.userId
    );
    return row ? watchRecord(row) : null;
  }

  private requireWatch(id: string): WatchRow {
    const scope = currentRequestScope();
    const row = this.db.get<WatchRow>(
      `${WATCH_SELECT} WHERE watch.id = ? AND watch.tenant_id = ? AND watch.user_id = ?`,
      id, scope.tenantId, scope.userId
    );
    if (!row) throw new DomainNotFoundError("watch_item_not_found", "The watch-queue item does not exist.");
    return row;
  }

  private watchCapabilityHash(id: string): string {
    return this.db.get<{ hash: string }>(
      `SELECT observation_capability_hash AS hash FROM watch_queue_items
       WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      id, currentRequestScope().tenantId, currentRequestScope().userId
    )?.hash ?? "";
  }

  private refreshWindowStates(now: number, accessScope: DropWindowAccessScope = "user"): void {
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    const ownership = accessScope === "tenant" ? "" : " AND user_id = ?";
    const scopedParameters = () => accessScope === "tenant"
      ? [scope.tenantId]
      : [scope.tenantId, scope.userId];
    this.db.transaction(() => {
      this.db.run(
        `UPDATE drop_windows SET status = 'active', updated_at = ?
         WHERE tenant_id = ?${ownership} AND status = 'scheduled'
           AND starts_at <= ? AND closes_at > ?`,
        timestamp, ...scopedParameters(), timestamp, timestamp
      );
      this.db.run(
        `UPDATE drop_windows SET status = 'closed', updated_at = ?
         WHERE tenant_id = ?${ownership} AND status IN ('scheduled', 'active')
           AND closes_at <= ?`,
        timestamp, ...scopedParameters(), timestamp
      );
      this.db.run(
        `UPDATE watch_queue_items SET state = 'window_closed', closed_reason = 'window_closed',
           assigned_device_id = NULL, observation_capability_hash = '', lease_expires_at = '', updated_at = ?
         WHERE tenant_id = ?${ownership} AND state IN ('queued', 'observing')
           AND observation_closes_at <= ?`,
        timestamp, ...scopedParameters(), timestamp
      );
    });
  }

  private windowSignals(window: DropWindowRecord, channel: SignalProviderChannel, now: number): SignalEventInput[] {
    return window.items.map((item) => ({
      schemaVersion: 1,
      signalId: `${window.kind}:${stableHash("yoink_window_signal_v1", window.id, item.id)}`,
      sourceConnectionId: channel.sourceConnectionId,
      source: "drop_window",
      externalEventId: `${window.id}:${item.id}`,
      eventType: window.kind,
      observedAt: nowIso(now),
      receivedAt: nowIso(now),
      test: false,
      identity: {
        retailerId: item.retailerId,
        retailerSku: item.retailerSku,
        canonicalUrl: item.canonicalUrl,
        title: item.title
      },
      offer: { availability: "unknown", currency: "USD", sellerType: "unknown", fulfillment: "unknown" },
      evidence: {
        headline: window.title,
        body: `${window.kind === "queue_open" ? "Queue-open" : "Drop-window"} watch starts ${window.startsAt}.`,
        clickUrl: item.canonicalUrl
      },
      parserVersion: "drop-window-v1"
    }));
  }

  private observationSignal(
    row: WatchRow,
    input: WatchQueueObservationInput,
    channel: SignalProviderChannel,
    observedAt: string,
    now: number
  ): SignalEventInput {
    return {
      schemaVersion: 1,
      signalId: `dropwatch:${stableHash("yoink_drop_watch_signal_v1", row.watchItemId, observedAt)}`,
      sourceConnectionId: channel.sourceConnectionId,
      source: "drop_window",
      externalEventId: `${row.watchItemId}:${observedAt}`,
      eventType: "in_stock",
      observedAt,
      receivedAt: nowIso(now),
      test: false,
      identity: {
        retailerId: row.retailerId,
        retailerSku: row.retailerSku,
        canonicalUrl: row.canonicalUrl,
        title: row.title
      },
      offer: {
        availability: input.availability,
        unitPriceCents: positiveCents(input.unitPriceCents, true),
        currency: cleanText(input.currency || "USD", 3).toUpperCase(),
        sellerName: cleanText(input.sellerName, 160),
        sellerType: input.sellerType ?? "unknown",
        fulfillment: input.fulfillment ?? "unknown"
      },
      evidence: {
        headline: `${row.windowTitle} · observed in stock`,
        body: "Seen by bounded read-only observation in the user's own Chrome session.",
        clickUrl: row.canonicalUrl
      },
      parserVersion: "drop-window-v1"
    };
  }
}
