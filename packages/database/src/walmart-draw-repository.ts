import {
  WALMART_DRAW_OBSERVER_VERSION,
  WALMART_DRAW_SCAN_OUTCOMES,
  WALMART_DRAW_STATES,
  type SellerType,
  type WalmartDrawItemObservationInput,
  type WalmartDrawScanInput,
  type WalmartDrawScanOutcome,
  type WalmartDrawState
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const OUTCOMES = new Set(WALMART_DRAW_SCAN_OUTCOMES);
const STATES = new Set(WALMART_DRAW_STATES);
const SELLER_TYPES = new Set<SellerType>(["first_party", "third_party", "unknown"]);
const INTERACTIVE_BLOCKS = new Set(["", "auth", "mfa", "location", "membership", "queue", "high_demand", "unknown"] as const);
const REASON_CODES = new Set([
  "verified",
  "no_active_drawings",
  "draw_binding_incomplete",
  "security_challenge",
  "interactive_auth",
  "interactive_mfa",
  "interactive_location",
  "interactive_membership",
  "interactive_queue",
  "interactive_unknown",
  "draw_module_missing",
  "draw_payload_missing",
  "observer_bundle_injection_failed",
  "observer_execution_failed",
  "observer_top_frame_missing",
  "observer_runtime_unavailable",
  "observer_collection_failed",
  "observer_contract_invalid"
]);
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_SCAN_AGE_MS = 10 * 60_000;
const RETENTION_LIMIT = 500;

interface ScanRow {
  id: string;
  deviceId: string;
  adapterVersion: typeof WALMART_DRAW_OBSERVER_VERSION;
  contractVersion: 1;
  outcome: WalmartDrawScanOutcome;
  reasonCode: string;
  expectedCardCount: number;
  observedCardCount: number;
  securityChallenge: number;
  interactiveBlock: WalmartDrawScanInput["interactiveBlock"];
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
}

interface ItemRow {
  id: string;
  scanId: string;
  retailerSku: string;
  title: string;
  canonicalUrl: string;
  unitPriceCents: number | null;
  currency: "USD";
  sellerName: string;
  sellerType: SellerType;
  drawState: WalmartDrawState;
  closesAt: string;
  conditionCode: number | null;
  conditionGroupCode: number | null;
  orderMinLimit: number | null;
  orderMaxLimit: number | null;
  drawControlPresent: number;
  addControlSuppressed: number;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
  missionId?: string | null;
  missionStatus?: string | null;
}

export interface StoredWalmartDrawItem extends Omit<WalmartDrawItemObservationInput, "closesAt"> {
  id: string;
  scanId: string;
  canonicalUrl: string;
  closesAt: string | null;
  evidenceHash: string;
  observedAt: string;
  receivedAt: string;
  tracked: boolean;
  missionId: string;
  missionStatus: string;
}

export interface StoredWalmartDrawScan extends Omit<ScanRow, "securityChallenge"> {
  pageKind: "walmart_draw_hub";
  securityChallenge: boolean;
  items: StoredWalmartDrawItem[];
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Walmart Draw ${field} must be boolean.`);
  return value;
}

function boundedCount(value: unknown, field: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 24) throw new Error(`Walmart Draw ${field} must be 0 through 24.`);
  return count;
}

function nullableInteger(value: unknown, minimum: number, maximum: number, field: string): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`Walmart Draw ${field} is invalid.`);
  return number;
}

function nullableTimestamp(value: unknown, observedTime: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = new Date(String(value)).getTime();
  if (!Number.isFinite(timestamp) || timestamp < observedTime - 31 * 24 * 60 * 60_000
    || timestamp > observedTime + 370 * 24 * 60 * 60_000) {
    throw new Error("Walmart Draw close time is invalid.");
  }
  return new Date(timestamp).toISOString();
}

function scanFromRow(row: ScanRow, items: StoredWalmartDrawItem[]): StoredWalmartDrawScan {
  return { ...row, pageKind: "walmart_draw_hub", securityChallenge: row.securityChallenge === 1, items };
}

function itemFromRow(row: ItemRow): StoredWalmartDrawItem {
  return {
    id: row.id,
    scanId: row.scanId,
    retailerSku: row.retailerSku,
    title: row.title,
    canonicalUrl: row.canonicalUrl,
    unitPriceCents: row.unitPriceCents,
    currency: "USD",
    sellerName: row.sellerName,
    sellerType: row.sellerType,
    drawState: row.drawState,
    closesAt: row.closesAt || null,
    conditionCode: row.conditionCode,
    conditionGroupCode: row.conditionGroupCode,
    orderMinLimit: row.orderMinLimit,
    orderMaxLimit: row.orderMaxLimit,
    drawControlPresent: row.drawControlPresent === 1,
    addControlSuppressed: row.addControlSuppressed === 1,
    evidenceHash: row.evidenceHash,
    observedAt: row.observedAt,
    receivedAt: row.receivedAt,
    tracked: Boolean(row.missionId),
    missionId: row.missionId || "",
    missionStatus: row.missionStatus || ""
  };
}

function outcomeMatchesReason(outcome: WalmartDrawScanOutcome, reasonCode: string): boolean {
  if (outcome === "passed") return reasonCode === "verified" || reasonCode === "no_active_drawings";
  if (outcome === "partial") return reasonCode === "draw_binding_incomplete";
  if (outcome === "manual") return reasonCode === "security_challenge" || reasonCode.startsWith("interactive_");
  return ["draw_module_missing", "draw_payload_missing"].includes(reasonCode) || reasonCode.startsWith("observer_");
}

export class WalmartDrawRepository {
  constructor(private readonly db: YoinkDatabase) {}

  record(deviceId: string, input: WalmartDrawScanInput, now = Date.now()): StoredWalmartDrawScan {
    if (!input || typeof input !== "object") throw new Error("A Walmart Draw scan is required.");
    const scope = currentRequestScope();
    const cleanDeviceId = cleanText(deviceId, 120);
    if (!this.db.get(
      "SELECT id FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'",
      cleanDeviceId,
      scope.userId
    )) throw new Error("The paired Chrome device is unavailable.");
    if (input.adapterVersion !== WALMART_DRAW_OBSERVER_VERSION || input.contractVersion !== 1
      || input.pageKind !== "walmart_draw_hub") throw new Error("The Walmart Draw observer contract is unsupported.");
    if (!OUTCOMES.has(input.outcome)) throw new Error("The Walmart Draw scan outcome is invalid.");
    const reasonCode = cleanText(input.reasonCode, 80).toLocaleLowerCase("en-US");
    if (!REASON_CODES.has(reasonCode) || !outcomeMatchesReason(input.outcome, reasonCode)) {
      throw new Error("The Walmart Draw outcome and reason are inconsistent.");
    }
    const observedTime = new Date(input.observedAt).getTime();
    if (!Number.isFinite(observedTime) || observedTime > now + MAX_CLOCK_SKEW_MS || now - observedTime > MAX_SCAN_AGE_MS) {
      throw new Error("The Walmart Draw scan is stale or has an invalid timestamp.");
    }
    const observedAt = new Date(observedTime).toISOString();
    const expectedCardCount = boundedCount(input.expectedCardCount, "expected-card count");
    const observedCardCount = boundedCount(input.observedCardCount, "observed-card count");
    const securityChallenge = booleanValue(input.securityChallenge, "security-challenge evidence");
    if (!INTERACTIVE_BLOCKS.has(input.interactiveBlock)) throw new Error("The Walmart Draw interactive block is invalid.");
    const expectedInteractiveReason = input.interactiveBlock ? `interactive_${input.interactiveBlock}` : "";
    if ((input.outcome !== "manual" && input.interactiveBlock !== "")
      || (input.outcome === "manual" && reasonCode !== "security_challenge" && reasonCode !== expectedInteractiveReason)
      || (reasonCode === "security_challenge" && input.interactiveBlock !== "")) {
      throw new Error("Walmart Draw interactive evidence is inconsistent.");
    }
    if (!Array.isArray(input.items) || input.items.length !== observedCardCount || expectedCardCount < observedCardCount) {
      throw new Error("The Walmart Draw item counts are inconsistent.");
    }
    if ((input.outcome === "manual" || input.outcome === "failed") && observedCardCount !== 0) {
      throw new Error("A blocked or failed Walmart Draw scan cannot publish items.");
    }
    if (securityChallenge !== (reasonCode === "security_challenge")) {
      throw new Error("Walmart Draw security challenge evidence is inconsistent.");
    }
    const seen = new Set<string>();
    const normalizedItems = input.items.map((value) => {
      if (!value || typeof value !== "object") throw new Error("A Walmart Draw item is invalid.");
      const retailerSku = cleanText(value.retailerSku, 24);
      if (!/^\d{5,20}$/.test(retailerSku) || seen.has(retailerSku)) throw new Error("Walmart Draw item identity is invalid or duplicated.");
      seen.add(retailerSku);
      const title = cleanText(value.title, 300);
      if (!title) throw new Error("Walmart Draw item title is required.");
      const price = value.unitPriceCents === null ? null : Number(value.unitPriceCents);
      if (price !== null && (!Number.isInteger(price) || price < 0 || price > 100_000_000)) {
        throw new Error("Walmart Draw item price is invalid.");
      }
      if (value.currency !== "USD" || !SELLER_TYPES.has(value.sellerType) || !STATES.has(value.drawState)) {
        throw new Error("Walmart Draw item enums are invalid.");
      }
      const sellerName = cleanText(value.sellerName, 160);
      if (value.sellerType === "third_party" && !sellerName) throw new Error("A Walmart Draw marketplace seller must be named.");
      const closesAt = nullableTimestamp(value.closesAt, observedTime);
      const orderMinLimit = nullableInteger(value.orderMinLimit, 1, 99, "minimum quantity");
      const orderMaxLimit = nullableInteger(value.orderMaxLimit, 1, 99, "maximum quantity");
      if (orderMinLimit !== null && orderMaxLimit !== null && orderMinLimit > orderMaxLimit) {
        throw new Error("Walmart Draw quantity limits are inconsistent.");
      }
      const drawControlPresent = booleanValue(value.drawControlPresent, "draw-control evidence");
      const addControlSuppressed = booleanValue(value.addControlSuppressed, "Add-control suppression evidence");
      if (input.outcome === "passed" && (price === null || value.sellerType === "unknown"
        || value.drawState === "unknown" || (value.drawState === "active" && !closesAt)
        || !drawControlPresent || !addControlSuppressed)) {
        throw new Error("A passed Walmart Draw item must have complete, non-actionable draw binding.");
      }
      return {
        retailerSku,
        title,
        unitPriceCents: price,
        currency: "USD" as const,
        sellerName: value.sellerType === "first_party" ? "Walmart" : sellerName,
        sellerType: value.sellerType,
        drawState: value.drawState,
        closesAt,
        conditionCode: nullableInteger(value.conditionCode, 0, 9_999_999, "condition code"),
        conditionGroupCode: nullableInteger(value.conditionGroupCode, 0, 9_999, "condition group"),
        orderMinLimit,
        orderMaxLimit,
        drawControlPresent,
        addControlSuppressed
      };
    });
    const normalizedScan = {
      adapterVersion: WALMART_DRAW_OBSERVER_VERSION,
      contractVersion: 1 as const,
      outcome: input.outcome,
      reasonCode,
      expectedCardCount,
      observedCardCount,
      securityChallenge,
      interactiveBlock: input.interactiveBlock,
      observedAt,
      items: normalizedItems
    };
    const evidenceHash = stableHash("walmart-draw-scan-v1", JSON.stringify(normalizedScan));
    const existing = this.db.get<ScanRow>(
      `SELECT id, device_id AS deviceId, adapter_version AS adapterVersion,
              contract_version AS contractVersion, outcome, reason_code AS reasonCode,
              expected_card_count AS expectedCardCount, observed_card_count AS observedCardCount,
              security_challenge AS securityChallenge, interactive_block AS interactiveBlock,
              evidence_hash AS evidenceHash, observed_at AS observedAt, received_at AS receivedAt
       FROM walmart_draw_scans WHERE device_id = ? AND evidence_hash = ?`,
      cleanDeviceId,
      evidenceHash
    );
    if (existing) return scanFromRow(existing, this.itemsForScan(existing.id));
    const scanId = newId("walmart_draw_scan");
    const receivedAt = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO walmart_draw_scans(
           id, tenant_id, user_id, device_id, adapter_version, contract_version,
           outcome, reason_code, expected_card_count, observed_card_count,
           security_challenge, interactive_block, evidence_hash, observed_at, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        scanId, scope.tenantId, scope.userId, cleanDeviceId, WALMART_DRAW_OBSERVER_VERSION, 1,
        input.outcome, reasonCode, expectedCardCount, observedCardCount,
        securityChallenge ? 1 : 0, input.interactiveBlock, evidenceHash, observedAt, receivedAt
      );
      for (const item of normalizedItems) {
        const itemEvidenceHash = stableHash("walmart-draw-item-v1", JSON.stringify(item));
        this.db.run(
          `INSERT INTO walmart_draw_items(
             id, tenant_id, user_id, scan_id, retailer_sku, title, canonical_url,
             unit_price_cents, currency, seller_name, seller_type, draw_state,
             closes_at, condition_code, condition_group_code, order_min_limit,
             order_max_limit, draw_control_present, add_control_suppressed,
             evidence_hash, observed_at, received_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId("walmart_draw_item"), scope.tenantId, scope.userId, scanId,
          item.retailerSku, item.title, `https://www.walmart.com/ip/${item.retailerSku}`,
          item.unitPriceCents, "USD", item.sellerName, item.sellerType, item.drawState,
          item.closesAt || "", item.conditionCode, item.conditionGroupCode,
          item.orderMinLimit, item.orderMaxLimit, item.drawControlPresent ? 1 : 0,
          item.addControlSuppressed ? 1 : 0, itemEvidenceHash, observedAt, receivedAt
        );
      }
      this.db.run(
        `DELETE FROM walmart_draw_scans WHERE user_id = ? AND id NOT IN (
           SELECT id FROM walmart_draw_scans WHERE user_id = ?
           ORDER BY received_at DESC, id DESC LIMIT ?
         )`,
        scope.userId,
        scope.userId,
        RETENTION_LIMIT
      );
    });
    const row: ScanRow = {
      id: scanId,
      deviceId: cleanDeviceId,
      adapterVersion: WALMART_DRAW_OBSERVER_VERSION,
      contractVersion: 1,
      outcome: input.outcome,
      reasonCode,
      expectedCardCount,
      observedCardCount,
      securityChallenge: securityChallenge ? 1 : 0,
      interactiveBlock: input.interactiveBlock,
      evidenceHash,
      observedAt,
      receivedAt
    };
    return scanFromRow(row, this.itemsForScan(scanId));
  }

  private itemsForScan(scanId: string): StoredWalmartDrawItem[] {
    const rows = this.db.all<ItemRow>(
      `SELECT i.id, i.scan_id AS scanId, i.retailer_sku AS retailerSku,
              i.title, i.canonical_url AS canonicalUrl, i.unit_price_cents AS unitPriceCents,
              i.currency, i.seller_name AS sellerName, i.seller_type AS sellerType,
              i.draw_state AS drawState, i.closes_at AS closesAt,
              i.condition_code AS conditionCode, i.condition_group_code AS conditionGroupCode,
              i.order_min_limit AS orderMinLimit, i.order_max_limit AS orderMaxLimit,
              i.draw_control_present AS drawControlPresent,
              i.add_control_suppressed AS addControlSuppressed,
              i.evidence_hash AS evidenceHash, i.observed_at AS observedAt,
              i.received_at AS receivedAt,
              (SELECT m.id FROM listings l JOIN mission_targets mt ON mt.listing_id = l.id
                 JOIN missions m ON m.id = mt.mission_id
               WHERE l.retailer_id = 'walmart' AND l.retailer_sku = i.retailer_sku
                 AND m.user_id = i.user_id AND mt.enabled = 1
               ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END, m.created_at LIMIT 1) AS missionId,
              (SELECT m.status FROM listings l JOIN mission_targets mt ON mt.listing_id = l.id
                 JOIN missions m ON m.id = mt.mission_id
               WHERE l.retailer_id = 'walmart' AND l.retailer_sku = i.retailer_sku
                 AND m.user_id = i.user_id AND mt.enabled = 1
               ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END, m.created_at LIMIT 1) AS missionStatus
       FROM walmart_draw_items i
       WHERE i.scan_id = ? AND i.user_id = ? ORDER BY i.rowid`,
      scanId,
      currentRequestScope().userId
    );
    return rows.map(itemFromRow);
  }

  latestScan(): StoredWalmartDrawScan | null {
    const row = this.db.get<ScanRow>(
      `SELECT id, device_id AS deviceId, adapter_version AS adapterVersion,
              contract_version AS contractVersion, outcome, reason_code AS reasonCode,
              expected_card_count AS expectedCardCount, observed_card_count AS observedCardCount,
              security_challenge AS securityChallenge, interactive_block AS interactiveBlock,
              evidence_hash AS evidenceHash, observed_at AS observedAt, received_at AS receivedAt
       FROM walmart_draw_scans WHERE user_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1`,
      currentRequestScope().userId
    );
    return row ? scanFromRow(row, this.itemsForScan(row.id)) : null;
  }

  currentItems(now = Date.now(), limit = 50): StoredWalmartDrawItem[] {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)));
    const rows = this.db.all<ItemRow>(
      `WITH latest_publishable AS (
         SELECT id FROM walmart_draw_scans
         WHERE user_id = ? AND outcome IN ('passed', 'partial') AND observed_at > ?
         ORDER BY observed_at DESC, id DESC LIMIT 1
       )
       SELECT i.id, i.scan_id AS scanId, i.retailer_sku AS retailerSku,
              i.title, i.canonical_url AS canonicalUrl, i.unit_price_cents AS unitPriceCents,
              i.currency, i.seller_name AS sellerName, i.seller_type AS sellerType,
              i.draw_state AS drawState, i.closes_at AS closesAt,
              i.condition_code AS conditionCode, i.condition_group_code AS conditionGroupCode,
              i.order_min_limit AS orderMinLimit, i.order_max_limit AS orderMaxLimit,
              i.draw_control_present AS drawControlPresent,
              i.add_control_suppressed AS addControlSuppressed,
              i.evidence_hash AS evidenceHash, i.observed_at AS observedAt,
              i.received_at AS receivedAt,
              (SELECT m.id FROM listings l JOIN mission_targets mt ON mt.listing_id = l.id
                 JOIN missions m ON m.id = mt.mission_id
               WHERE l.retailer_id = 'walmart' AND l.retailer_sku = i.retailer_sku
                 AND m.user_id = i.user_id AND mt.enabled = 1
               ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END, m.created_at LIMIT 1) AS missionId,
              (SELECT m.status FROM listings l JOIN mission_targets mt ON mt.listing_id = l.id
                 JOIN missions m ON m.id = mt.mission_id
               WHERE l.retailer_id = 'walmart' AND l.retailer_sku = i.retailer_sku
                 AND m.user_id = i.user_id AND mt.enabled = 1
               ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END, m.created_at LIMIT 1) AS missionStatus
       FROM walmart_draw_items i JOIN latest_publishable latest ON latest.id = i.scan_id
       WHERE i.user_id = ?
         AND (i.draw_state = 'upcoming' OR (i.draw_state = 'active' AND (i.closes_at = '' OR i.closes_at > ?)))
       ORDER BY CASE i.draw_state WHEN 'active' THEN 0 ELSE 1 END, i.closes_at, i.title LIMIT ?`,
      currentRequestScope().userId,
      nowIso(now - 30 * 24 * 60 * 60_000),
      currentRequestScope().userId,
      nowIso(now),
      safeLimit
    );
    return rows.map(itemFromRow);
  }

  counts(now = Date.now()): { walmartDrawScans: number; walmartDrawItems: number; walmartDrawFailures: number; activeWalmartDraws: number } {
    const userId = currentRequestScope().userId;
    return {
      walmartDrawScans: Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM walmart_draw_scans WHERE user_id = ?", userId)?.count ?? 0),
      walmartDrawItems: Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM walmart_draw_items WHERE user_id = ?", userId)?.count ?? 0),
      walmartDrawFailures: Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM walmart_draw_scans WHERE user_id = ? AND outcome IN ('failed', 'manual')", userId)?.count ?? 0),
      activeWalmartDraws: this.currentItems(now, 100).filter((item) => item.drawState === "active").length
    };
  }
}
