import type {
  SignalProvider,
  SignalProviderChannelInput,
  SignalProviderChannelUpdate
} from "../../contracts/src/signal-provider.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const CHANNEL_ID = /^signal_channel_[a-f0-9]{32}$/;
const PROVIDERS = new Set<Exclude<SignalProvider, "trackalacker">>(["discord", "drop_window", "api"]);
const TRUST_LEVELS = new Set(["informational", "trusted_exact"]);
const CHANNEL_STATES = new Set(["active", "paused", "disabled"]);

export interface SignalProviderChannel {
  id: string;
  provider: Exclude<SignalProvider, "trackalacker">;
  name: string;
  sourceConnectionId: string;
  trustLevel: "informational" | "trusted_exact";
  autoCreateMissions: boolean;
  status: "active" | "paused" | "disabled";
  replayWindowSeconds: number;
  acceptedEventCount: number;
  rejectedEventCount: number;
  falsePositiveCount: number;
  signalCount: number;
  matchedSignalCount: number;
  unresolvedSignalCount: number;
  ambiguousSignalCount: number;
  qualifiedSignalCount: number;
  averageObservedToReceivedMs: number | null;
  p50ObservedToReceivedMs: number | null;
  p95ObservedToReceivedMs: number | null;
  matchRateBps: number | null;
  qualifiedRateBps: number | null;
  accuracyBps: number | null;
  health: "healthy" | "quiet" | "attention" | "paused" | "disabled";
  lastEventAt: string;
  lastErrorCode: string;
  createdAt: string;
  updatedAt: string;
}

interface ChannelRow extends Omit<SignalProviderChannel, "autoCreateMissions"> {
  autoCreateMissions: number;
}

function provider(value: unknown): Exclude<SignalProvider, "trackalacker"> {
  const normalized = cleanText(value, 40).toLocaleLowerCase("en-US") as Exclude<SignalProvider, "trackalacker">;
  if (!PROVIDERS.has(normalized)) throw new Error("A supported signal provider is required.");
  return normalized;
}

function name(value: unknown): string {
  const normalized = cleanText(value, 100);
  if (normalized.length < 2) throw new Error("A signal channel name is required.");
  return normalized;
}

function externalReferenceHash(value: unknown, source: string): string {
  const normalized = cleanText(value, 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,179}$/.test(normalized)) {
    throw new Error("A bounded provider channel reference is required.");
  }
  return stableHash("yoink_signal_provider_channel_external_v1", source, normalized);
}

function trustLevel(value: unknown): "informational" | "trusted_exact" {
  const normalized = cleanText(value, 40).toLocaleLowerCase("en-US");
  if (!TRUST_LEVELS.has(normalized)) throw new Error("Choose informational or trusted exact channel trust.");
  return normalized as "informational" | "trusted_exact";
}

function replayWindowSeconds(value: unknown, fallback = 900): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 30 || parsed > 86_400) {
    throw new Error("The provider replay window must be from 30 seconds through 24 hours.");
  }
  return parsed;
}

function channelId(value: unknown): string {
  const normalized = cleanText(value, 120);
  if (!CHANNEL_ID.test(normalized)) throw new Error("The signal provider channel ID is invalid.");
  return normalized;
}

function record(row: ChannelRow): SignalProviderChannel {
  const signalCount = Number(row.signalCount);
  const acceptedEventCount = Number(row.acceptedEventCount);
  const falsePositiveCount = Number(row.falsePositiveCount);
  const status = row.status;
  const lastEventTime = new Date(row.lastEventAt).getTime();
  const health = status === "paused" ? "paused"
    : status === "disabled" ? "disabled"
      : row.lastErrorCode || Number(row.rejectedEventCount) > 0 ? "attention"
        : Number.isFinite(lastEventTime) && lastEventTime >= Date.now() - 24 * 60 * 60_000 ? "healthy"
          : "quiet";
  return {
    ...row,
    autoCreateMissions: Number(row.autoCreateMissions) === 1,
    replayWindowSeconds: Number(row.replayWindowSeconds),
    acceptedEventCount: Number(row.acceptedEventCount),
    rejectedEventCount: Number(row.rejectedEventCount),
    falsePositiveCount: Number(row.falsePositiveCount),
    signalCount,
    matchedSignalCount: Number(row.matchedSignalCount),
    unresolvedSignalCount: Number(row.unresolvedSignalCount),
    ambiguousSignalCount: Number(row.ambiguousSignalCount),
    qualifiedSignalCount: Number(row.qualifiedSignalCount),
    averageObservedToReceivedMs: row.averageObservedToReceivedMs === null
      ? null
      : Math.max(0, Math.round(Number(row.averageObservedToReceivedMs))),
    p50ObservedToReceivedMs: row.p50ObservedToReceivedMs === null
      ? null : Math.max(0, Math.round(Number(row.p50ObservedToReceivedMs))),
    p95ObservedToReceivedMs: row.p95ObservedToReceivedMs === null
      ? null : Math.max(0, Math.round(Number(row.p95ObservedToReceivedMs))),
    matchRateBps: signalCount ? Math.round(Number(row.matchedSignalCount) * 10_000 / signalCount) : null,
    qualifiedRateBps: signalCount ? Math.round(Number(row.qualifiedSignalCount) * 10_000 / signalCount) : null,
    accuracyBps: acceptedEventCount
      ? Math.max(0, Math.round((acceptedEventCount - falsePositiveCount) * 10_000 / acceptedEventCount))
      : null,
    health
  };
}

const CHANNEL_SELECT = `SELECT channel.id, channel.provider, channel.name,
  channel.source_connection_id AS sourceConnectionId,
  channel.trust_level AS trustLevel,
  connection.auto_create_missions AS autoCreateMissions,
  channel.status, channel.replay_window_seconds AS replayWindowSeconds,
  channel.accepted_event_count AS acceptedEventCount,
  channel.rejected_event_count AS rejectedEventCount,
  channel.false_positive_count AS falsePositiveCount,
  (SELECT COUNT(*) FROM signal_events event
   WHERE event.source_connection_id = channel.source_connection_id AND event.test = 0) AS signalCount,
  (SELECT COUNT(*) FROM signal_events event
   WHERE event.source_connection_id = channel.source_connection_id AND event.test = 0
     AND event.resolution_status = 'matched') AS matchedSignalCount,
  (SELECT COUNT(*) FROM signal_events event
   WHERE event.source_connection_id = channel.source_connection_id AND event.test = 0
     AND event.resolution_status = 'unresolved') AS unresolvedSignalCount,
  (SELECT COUNT(*) FROM signal_events event
   WHERE event.source_connection_id = channel.source_connection_id AND event.test = 0
     AND event.resolution_status = 'ambiguous') AS ambiguousSignalCount,
  (SELECT COUNT(*) FROM signal_events event
   JOIN mission_decisions decision ON decision.event_id = event.id
   WHERE event.source_connection_id = channel.source_connection_id AND event.test = 0
     AND decision.outcome IN ('qualified', 'corroborated', 'sibling_store_claimed')) AS qualifiedSignalCount,
  (SELECT AVG(MAX(0, (julianday(event.received_at) - julianday(event.observed_at)) * 86400000.0))
   FROM signal_events event WHERE event.source_connection_id = channel.source_connection_id
     AND event.test = 0) AS averageObservedToReceivedMs,
  NULL AS p50ObservedToReceivedMs,
  NULL AS p95ObservedToReceivedMs,
  channel.last_event_at AS lastEventAt, channel.last_error_code AS lastErrorCode,
  channel.created_at AS createdAt, channel.updated_at AS updatedAt
  FROM signal_provider_channels channel
  JOIN source_connections connection ON connection.id = channel.source_connection_id`;

export class SignalProviderRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  createChannel(input: SignalProviderChannelInput, now = Date.now()): SignalProviderChannel & { created: boolean } {
    const source = provider(input?.provider);
    const channelName = name(input?.name);
    const externalRefHash = externalReferenceHash(input?.externalReference, source);
    const channelTrust = trustLevel(input?.trustLevel);
    const replayWindow = replayWindowSeconds(input?.replayWindowSeconds);
    const autoCreate = input?.autoCreateMissions === true;
    const owner = currentRequestScope();
    return this.db.transaction(() => {
      const existing = this.db.get<ChannelRow>(
        `${CHANNEL_SELECT}
         WHERE channel.user_id = ? AND channel.provider = ? AND channel.external_ref_hash = ?`,
        owner.userId,
        source,
        externalRefHash
      );
      if (existing) return { ...record(existing), created: false };
      const id = newId("signal_channel");
      const sourceConnectionId = newId(`source_${source}`);
      const timestamp = nowIso(now);
      this.db.run(
        `INSERT INTO source_connections(
           id, tenant_id, user_id, source, name, status, trust_level,
           auto_create_missions, is_private, last_event_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'disconnected', ?, ?, 1, '', ?, ?)`,
        sourceConnectionId,
        owner.tenantId,
        owner.userId,
        source,
        `${source === "discord" ? "Discord" : "Signal provider"}: ${channelName}`,
        channelTrust,
        autoCreate ? 1 : 0,
        timestamp,
        timestamp
      );
      this.db.run(
        `INSERT INTO signal_provider_channels(
           id, tenant_id, user_id, source_connection_id, provider, name,
           external_ref_hash, trust_level, status, replay_window_seconds,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        id,
        owner.tenantId,
        owner.userId,
        sourceConnectionId,
        source,
        channelName,
        externalRefHash,
        channelTrust,
        replayWindow,
        timestamp,
        timestamp
      );
      this.audit.record({
        correlationId: id,
        aggregateType: "signal_provider_channel",
        eventType: "signal_provider_channel_created",
        reasonCode: `${source}_channel_created`,
        message: "A private signal provider channel was created with explicit trust.",
        data: { channelId: id, provider: source, trustLevel: channelTrust, autoCreateMissions: autoCreate }
      }, now);
      const saved = this.getChannel(id);
      if (!saved) throw new Error("The signal provider channel could not be loaded after creation.");
      return { ...saved, created: true };
    });
  }

  updateChannel(id: string, input: SignalProviderChannelUpdate, now = Date.now()): SignalProviderChannel {
    const safeId = channelId(id);
    const current = this.getChannel(safeId);
    if (!current) throw new Error("The signal provider channel does not exist.");
    const nextName = input?.name === undefined ? current.name : name(input.name);
    const nextTrust = input?.trustLevel === undefined ? current.trustLevel : trustLevel(input.trustLevel);
    const nextStatus = input?.status === undefined ? current.status : cleanText(input.status, 20);
    if (!CHANNEL_STATES.has(nextStatus)) throw new Error("Choose an active, paused, or disabled channel state.");
    const nextAutoCreate = input?.autoCreateMissions === undefined
      ? current.autoCreateMissions
      : input.autoCreateMissions === true;
    const nextReplayWindow = replayWindowSeconds(input?.replayWindowSeconds, current.replayWindowSeconds);
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE signal_provider_channels
         SET name = ?, trust_level = ?, status = ?, replay_window_seconds = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ?`,
        nextName,
        nextTrust,
        nextStatus,
        nextReplayWindow,
        timestamp,
        safeId,
        currentRequestScope().tenantId,
        currentRequestScope().userId
      );
      this.db.run(
        `UPDATE source_connections
         SET name = ?, trust_level = ?, auto_create_missions = ?,
             status = CASE WHEN ? = 'active' THEN status ELSE 'disconnected' END,
             updated_at = ?
         WHERE id = ? AND user_id = ?`,
        `${current.provider === "discord" ? "Discord" : "Signal provider"}: ${nextName}`,
        nextTrust,
        nextAutoCreate ? 1 : 0,
        nextStatus,
        timestamp,
        current.sourceConnectionId,
        currentRequestScope().userId
      );
      this.audit.record({
        correlationId: safeId,
        aggregateType: "signal_provider_channel",
        eventType: "signal_provider_channel_updated",
        reasonCode: "channel_configuration_updated",
        message: "Signal provider channel trust and delivery state were updated.",
        data: {
          channelId: safeId,
          provider: current.provider,
          trustLevel: nextTrust,
          status: nextStatus,
          autoCreateMissions: nextAutoCreate
        }
      }, now);
    });
    return this.getChannel(safeId) as SignalProviderChannel;
  }

  getChannel(id: string): SignalProviderChannel | null {
    const safeId = channelId(id);
    const row = this.db.get<ChannelRow>(
      `${CHANNEL_SELECT} WHERE channel.id = ? AND channel.tenant_id = ? AND channel.user_id = ?`,
      safeId,
      currentRequestScope().tenantId,
      currentRequestScope().userId
    );
    return row ? this.withPercentiles(record(row)) : null;
  }

  listChannels(providerFilter = ""): SignalProviderChannel[] {
    const normalizedProvider = providerFilter ? provider(providerFilter) : "";
    return this.db.all<ChannelRow>(
      `${CHANNEL_SELECT}
       WHERE channel.tenant_id = ? AND channel.user_id = ?
         AND (? = '' OR channel.provider = ?)
       ORDER BY channel.provider, channel.name, channel.id`,
      currentRequestScope().tenantId,
      currentRequestScope().userId,
      normalizedProvider,
      normalizedProvider
    ).map((row) => this.withPercentiles(record(row)));
  }

  requireActiveChannel(id: string, expectedProvider: SignalProvider): SignalProviderChannel {
    if (expectedProvider === "trackalacker") throw new Error("TrackaLacker does not use a provider channel record.");
    const channel = this.getChannel(id);
    if (!channel || channel.provider !== expectedProvider) throw new Error("The signal provider channel does not match this event.");
    if (channel.status !== "active") throw new Error("The signal provider channel is not active.");
    return channel;
  }

  recordIngress(id: string, accepted: boolean, error: string, observedAt: string, now = Date.now()): void {
    const safeId = channelId(id);
    const errorCode = cleanText(error, 80).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_");
    const timestamp = nowIso(now);
    this.db.run(
      `UPDATE signal_provider_channels SET
         accepted_event_count = accepted_event_count + ?,
         rejected_event_count = rejected_event_count + ?,
         last_event_at = CASE WHEN ? = 1 THEN ? ELSE last_event_at END,
         last_error_code = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      accepted ? 1 : 0,
      accepted ? 0 : 1,
      accepted ? 1 : 0,
      accepted ? cleanText(observedAt, 40) : "",
      accepted ? "" : errorCode,
      timestamp,
      safeId,
      currentRequestScope().tenantId,
      currentRequestScope().userId
    );
  }

  reportFalsePositive(id: string, now = Date.now()): SignalProviderChannel {
    const safeId = channelId(id);
    if (!this.getChannel(safeId)) throw new Error("The signal provider channel does not exist.");
    this.db.run(
      `UPDATE signal_provider_channels
       SET false_positive_count = false_positive_count + 1, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      nowIso(now),
      safeId,
      currentRequestScope().tenantId,
      currentRequestScope().userId
    );
    return this.getChannel(safeId) as SignalProviderChannel;
  }

  private withPercentiles(channel: SignalProviderChannel): SignalProviderChannel {
    const values = this.db.all<{ duration: number }>(
      `SELECT CAST(MAX(0, (julianday(received_at) - julianday(observed_at)) * 86400000.0) AS INTEGER) AS duration
       FROM signal_events
       WHERE source_connection_id = ? AND test = 0
       ORDER BY duration`,
      channel.sourceConnectionId
    ).map((row) => Math.max(0, Number(row.duration))).filter(Number.isFinite);
    const percentile = (fraction: number): number | null => values.length
      ? Math.round(values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] ?? 0)
      : null;
    return {
      ...channel,
      p50ObservedToReceivedMs: percentile(0.50),
      p95ObservedToReceivedMs: percentile(0.95)
    };
  }
}
