import { randomBytes, randomInt } from "node:crypto";
import { cleanText } from "../../domain/src/normalize.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION
} from "../../contracts/src/index.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";
import { AuditRepository } from "./audit-repository.js";

const PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAIRING_CODE_LENGTH = 12;
const PAIRING_TTL_MS = 5 * 60_000;
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

export interface DeviceCapabilities {
  readiness: boolean;
  jobReconciliation: boolean;
  notifications: boolean;
  retailerShadow: boolean;
  communityReadOnlyEvidence: boolean;
  observerRecipeShadow: boolean;
  durableAdapterDiagnostics: boolean;
  trackalackerPush: boolean;
  trackalackerCatalogSync: boolean;
  retailerMutation: false;
  targetAddOnly: boolean;
  targetAddAdapterVersion: "" | typeof TARGET_ADD_ADAPTER_VERSION;
  walmartAddOnly: boolean;
  walmartAddAdapterVersion: "" | typeof WALMART_ADD_ADAPTER_VERSION;
  amazonAddOnly: boolean;
  amazonAddAdapterVersion: "" | typeof AMAZON_ADD_ADAPTER_VERSION;
  bestBuyAddOnly: boolean;
  bestBuyAddAdapterVersion: "" | typeof BESTBUY_ADD_ADAPTER_VERSION;
}

export interface PairDeviceInput {
  pairingCode: string;
  name?: string;
  platform?: string;
  extensionVersion?: string;
  capabilities?: Partial<DeviceCapabilities>;
}

export interface AuthenticatedDevice {
  id: string;
  name: string;
  platform: string;
  extensionVersion: string;
  capabilities: DeviceCapabilities;
  lastSeenAt: string;
}

export interface PairingCodeResult {
  code: string;
  expiresAt: string;
}

export interface PairedDeviceResult extends AuthenticatedDevice {
  token: string;
}

function pairingCode(): string {
  let value = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    value += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  }
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
}

function normalizedPairingCode(value: unknown): string {
  const normalized = cleanText(value, 32).toUpperCase().replace(/[\s-]/g, "");
  if (normalized.length !== PAIRING_CODE_LENGTH || [...normalized].some((character) => !PAIRING_ALPHABET.includes(character))) {
    throw new Error("The pairing code is invalid or expired.");
  }
  return normalized;
}

function tokenHash(token: string): string {
  return stableHash("yoink-device-token-v1", token);
}

function codeHash(code: string): string {
  return stableHash("yoink-pairing-code-v1", code);
}

function capabilities(input: Partial<DeviceCapabilities> | undefined): DeviceCapabilities {
  const targetAddOnly = input?.targetAddOnly === true
    && input?.targetAddAdapterVersion === TARGET_ADD_ADAPTER_VERSION;
  const walmartAddOnly = input?.walmartAddOnly === true
    && input?.walmartAddAdapterVersion === WALMART_ADD_ADAPTER_VERSION;
  const amazonAddOnly = input?.amazonAddOnly === true
    && input?.amazonAddAdapterVersion === AMAZON_ADD_ADAPTER_VERSION;
  const bestBuyAddOnly = input?.bestBuyAddOnly === true
    && input?.bestBuyAddAdapterVersion === BESTBUY_ADD_ADAPTER_VERSION;
  return {
    readiness: input?.readiness === true,
    jobReconciliation: input?.jobReconciliation === true,
    notifications: input?.notifications === true,
    retailerShadow: input?.retailerShadow === true,
    communityReadOnlyEvidence: input?.communityReadOnlyEvidence === true,
    observerRecipeShadow: input?.observerRecipeShadow === true,
    durableAdapterDiagnostics: input?.durableAdapterDiagnostics === true,
    trackalackerPush: input?.trackalackerPush === true,
    trackalackerCatalogSync: input?.trackalackerCatalogSync === true,
    retailerMutation: false,
    targetAddOnly,
    targetAddAdapterVersion: targetAddOnly ? TARGET_ADD_ADAPTER_VERSION : "",
    walmartAddOnly,
    walmartAddAdapterVersion: walmartAddOnly ? WALMART_ADD_ADAPTER_VERSION : "",
    amazonAddOnly,
    amazonAddAdapterVersion: amazonAddOnly ? AMAZON_ADD_ADAPTER_VERSION : "",
    bestBuyAddOnly,
    bestBuyAddAdapterVersion: bestBuyAddOnly ? BESTBUY_ADD_ADAPTER_VERSION : ""
  };
}

function parseCapabilities(value: string): DeviceCapabilities {
  try {
    return capabilities(JSON.parse(value) as Partial<DeviceCapabilities>);
  } catch {
    return capabilities(undefined);
  }
}

export class DeviceRepository {
  private readonly auditEvents: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.auditEvents = new AuditRepository(db);
  }

  createPairingCode(now = Date.now()): PairingCodeResult {
    return this.db.transaction(() => {
      const timestamp = nowIso(now);
      const code = pairingCode();
      const normalized = normalizedPairingCode(code);
      const expiresAt = nowIso(now + PAIRING_TTL_MS);
      this.db.run(
        "UPDATE device_pairing_codes SET used_at = ? WHERE user_id = ? AND used_at = ''",
        timestamp,
        currentRequestScope().userId
      );
      this.db.run(
        `DELETE FROM device_pairing_codes
         WHERE user_id = ? AND ((used_at <> '' AND used_at < ?) OR expires_at < ?)`,
        currentRequestScope().userId,
        nowIso(now - 24 * 60 * 60_000),
        nowIso(now - 24 * 60 * 60_000)
      );
      const id = newId("pairing_code");
      this.db.run(
        `INSERT INTO device_pairing_codes(
           id, tenant_id, user_id, code_hash, expires_at, used_at, created_at
         ) VALUES (?, ?, ?, ?, ?, '', ?)`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        codeHash(normalized),
        expiresAt,
        timestamp
      );
      this.audit(id, "device_pairing_code_created", "created", "A one-time extension pairing code was created.", {}, now);
      return { code, expiresAt };
    });
  }

  pair(input: PairDeviceInput, now = Date.now()): PairedDeviceResult {
    const normalizedCode = normalizedPairingCode(input.pairingCode);
    const name = cleanText(input.name || "Desktop - Windows - Chrome", 100) || "Desktop - Windows - Chrome";
    const platform = cleanText(input.platform || "desktop-chrome", 80) || "desktop-chrome";
    const extensionVersion = cleanText(input.extensionVersion, 40);
    const declaredCapabilities = capabilities(input.capabilities);

    return this.db.transaction(() => {
      const timestamp = nowIso(now);
      const pairing = this.db.get<{ id: string }>(
        `SELECT id FROM device_pairing_codes
         WHERE user_id = ? AND code_hash = ? AND used_at = '' AND expires_at >= ?`,
        currentRequestScope().userId,
        codeHash(normalizedCode),
        timestamp
      );
      if (!pairing) throw new Error("The pairing code is invalid or expired.");
      const consumed = this.db.run(
        "UPDATE device_pairing_codes SET used_at = ? WHERE id = ? AND used_at = ''",
        timestamp,
        pairing.id
      );
      if (Number(consumed.changes) !== 1) throw new Error("The pairing code is invalid or expired.");

      const token = randomBytes(32).toString("base64url");
      const id = newId("device");
      this.db.run(
        `INSERT INTO extension_devices(
           id, tenant_id, user_id, name, token_hash, extension_version,
           status, capabilities_json, last_seen_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        name,
        tokenHash(token),
        extensionVersion,
        JSON.stringify({ ...declaredCapabilities, platform }),
        timestamp,
        timestamp,
        timestamp
      );
      this.audit(id, "extension_device_paired", "paired", "A Chrome companion was paired.", { platform, extensionVersion }, now);
      return { id, token, name, platform, extensionVersion, capabilities: declaredCapabilities, lastSeenAt: timestamp };
    });
  }

  authenticate(token: unknown): AuthenticatedDevice | null {
    const value = typeof token === "string" ? token.trim() : "";
    if (!DEVICE_TOKEN_PATTERN.test(value)) return null;
    const row = this.db.get<{
      id: string;
      name: string;
      extension_version: string;
      capabilities_json: string;
      last_seen_at: string;
    }>(
      `SELECT id, name, extension_version, capabilities_json, last_seen_at
       FROM extension_devices WHERE user_id = ? AND token_hash = ? AND status = 'active'`,
      currentRequestScope().userId,
      tokenHash(value)
    );
    if (!row) return null;
    let stored: Record<string, unknown> = {};
    try { stored = JSON.parse(row.capabilities_json) as Record<string, unknown>; } catch { stored = {}; }
    return {
      id: row.id,
      name: row.name,
      platform: cleanText(stored.platform, 80),
      extensionVersion: row.extension_version,
      capabilities: parseCapabilities(row.capabilities_json),
      lastSeenAt: row.last_seen_at
    };
  }

  heartbeat(deviceId: string, input: Omit<PairDeviceInput, "pairingCode" | "name">, now = Date.now()): AuthenticatedDevice {
    const current = this.db.get<{ name: string }>(
      "SELECT name FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
      deviceId,
      currentRequestScope().userId
    );
    if (!current) throw new Error("The paired device is unavailable or revoked.");
    const timestamp = nowIso(now);
    const platform = cleanText(input.platform || "desktop-chrome", 80) || "desktop-chrome";
    const extensionVersion = cleanText(input.extensionVersion, 40);
    const declaredCapabilities = capabilities(input.capabilities);
    this.db.run(
      `UPDATE extension_devices SET extension_version = ?, capabilities_json = ?,
         last_seen_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
      extensionVersion,
      JSON.stringify({ ...declaredCapabilities, platform }),
      timestamp,
      timestamp,
      deviceId
    );
    return {
      id: deviceId,
      name: current.name,
      platform,
      extensionVersion,
      capabilities: declaredCapabilities,
      lastSeenAt: timestamp
    };
  }

  revoke(deviceId: string, now = Date.now()): boolean {
    const timestamp = nowIso(now);
    const result = this.db.run(
      `UPDATE extension_devices SET status = 'revoked', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'active'`,
      timestamp,
      cleanText(deviceId, 120),
      currentRequestScope().userId
    );
    if (Number(result.changes) === 1) {
      this.audit(deviceId, "extension_device_revoked", "revoked", "A Chrome companion was revoked.", {}, now);
      return true;
    }
    return false;
  }

  listDevices(now = Date.now()): Array<Record<string, unknown>> {
    return this.db.all<{
      id: string;
      name: string;
      extensionVersion: string;
      status: string;
      capabilitiesJson: string;
      lastSeenAt: string;
      createdAt: string;
    }>(
      `SELECT id, name, extension_version AS extensionVersion, status,
              capabilities_json AS capabilitiesJson, last_seen_at AS lastSeenAt,
              created_at AS createdAt
       FROM extension_devices WHERE user_id = ? ORDER BY created_at DESC`,
      currentRequestScope().userId
    ).map((row) => {
      let stored: Record<string, unknown> = {};
      try { stored = JSON.parse(row.capabilitiesJson) as Record<string, unknown>; } catch { stored = {}; }
      const lastSeen = new Date(row.lastSeenAt).getTime();
      return {
        id: row.id,
        name: row.name,
        platform: cleanText(stored.platform, 80),
        extensionVersion: row.extensionVersion,
        status: row.status,
        online: row.status === "active" && Number.isFinite(lastSeen) && now - lastSeen <= 90_000,
        capabilities: parseCapabilities(row.capabilitiesJson),
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt
      };
    });
  }

  private audit(
    correlationId: string,
    eventType: string,
    reasonCode: string,
    message: string,
    data: Record<string, unknown>,
    now: number
  ): void {
    this.auditEvents.record({ correlationId, aggregateType: "extension_device", eventType, reasonCode, message, data }, now);
  }
}
