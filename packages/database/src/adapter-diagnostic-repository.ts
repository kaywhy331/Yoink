import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  RETAILER_ADAPTER_DIAGNOSTIC_OPERATIONS,
  RETAILER_ADAPTER_DIAGNOSTIC_OUTCOMES,
  RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES,
  RETAILER_ADAPTER_DIAGNOSTIC_STAGES,
  RETAILER_ADAPTER_REPAIR_LANDMARK_ATTRIBUTES,
  RETAILER_OBSERVER_VERSIONS,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  type RetailerAdapterDiagnosticInput,
  type RetailerAdapterDiagnosticOperation,
  type RetailerAdapterDiagnosticOutcome,
  type RetailerAdapterDiagnosticStage,
  type RetailerAdapterLayoutEvidence,
  type RetailerAdapterRepairLandmark,
  type ObserverRecipeField,
  type ObserverRecipeMode,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

const OPERATIONS = new Set(RETAILER_ADAPTER_DIAGNOSTIC_OPERATIONS);
const OUTCOMES = new Set(RETAILER_ADAPTER_DIAGNOSTIC_OUTCOMES);
const STAGES = new Set(RETAILER_ADAPTER_DIAGNOSTIC_STAGES);
const REASON_CODES = new Set<string>(RETAILER_ADAPTER_DIAGNOSTIC_REASON_CODES);
const PAGE_KINDS = new Set(["product", "other"] as const);
const SCOPE_KINDS = new Set(["none", "form", "buybox", "qualified_buybox", "accordion", "other"] as const);
const SELLER_SHAPES = new Set(["none", "legacy", "offer_display_combined", "offer_display_split"] as const);
const FULFILLMENT_SHAPES = new Set(["none", "shipping", "pickup", "mixed"] as const);
const INTERACTIVE_BLOCKS = new Set(["", "auth", "mfa", "location", "membership", "queue", "high_demand", "unknown"] as const);
const REPAIR_LANDMARK_ATTRIBUTES = new Set(RETAILER_ADAPTER_REPAIR_LANDMARK_ATTRIBUTES);
const REPAIR_LANDMARK_ELEMENTS = new Set([
  "button", "input", "role_button", "div", "span", "p", "label", "section", "li"
] as const);
const REPAIR_LANDMARK_VALUE = /^[A-Za-z][A-Za-z0-9_.:-]{1,63}$/;
const REPAIR_LANDMARK_FORBIDDEN = /(?:checkout|buy[_.:-]?now|place[_.:-]?order|submit[_.:-]?order|payment|credit|debit|address|email|phone|account|password|cookie|csrf|token)/i;
const REPAIR_LANDMARK_TOKENS = new Set([
  "pdp", "product", "detail", "buy", "box", "fulfillment", "shipping", "delivery",
  "primary", "main", "add", "to", "cart", "bag", "pre", "preorder", "order",
  "button", "btn", "control", "atc", "submit", "action", "purchase", "state",
  "available", "availability", "unavailable", "inventory", "stock", "in", "out", "sold",
  "price", "amount", "cost", "current", "customer", "sale", "offer", "value",
  "seller", "merchant", "vendor", "display", "name", "by", "fulfilled",
  "ship", "pickup", "pick", "up", "store", "method", "option", "selected",
  "status", "label", "message", "info", "commerce"
]);
const REPAIR_FIELDS = new Set<ObserverRecipeField>([
  "availability", "unitPrice", "seller", "fulfillment", "addControl"
]);
const REPAIR_LANDMARK_INTENT: Record<ObserverRecipeField, RegExp> = {
  availability: /(?:availability|available|unavailable|inventory|stock|sold[_.:-]?out|pre[_.:-]?order)/i,
  unitPrice: /(?:price|amount|cost|sale[_.:-]?price|customer[_.:-]?price|offer[_.:-]?price)/i,
  seller: /(?:seller|merchant|vendor|sold[_.:-]?by)/i,
  fulfillment: /(?:fulfillment|shipping|delivery|pickup|pick[_.:-]?up|ship[_.:-]?to)/i,
  addControl: /(?:add|cart|bag|pre[_.:-]?order|atc)/i
};
const REPAIR_MODES: Record<ObserverRecipeField, ObserverRecipeMode> = {
  availability: "text",
  unitPrice: "text",
  seller: "text",
  fulfillment: "text",
  addControl: "disabled_state"
};
const REPAIR_COUNT_FIELDS: Record<Exclude<ObserverRecipeField, "addControl">, keyof RetailerAdapterLayoutEvidence> = {
  availability: "genericAvailabilityCandidateCount",
  unitPrice: "genericPriceCandidateCount",
  seller: "genericSellerCandidateCount",
  fulfillment: "genericFulfillmentCandidateCount"
};
const REPAIR_SELECTOR_MISS_REASONS = new Set([
  "availability_selector_miss", "add_control_selector_miss", "price_selector_miss",
  "seller_selector_miss", "fulfillment_selector_miss"
]);
const REPAIR_REASON_FIELDS: Record<string, ObserverRecipeField> = {
  availability_selector_miss: "availability",
  add_control_selector_miss: "addControl",
  price_selector_miss: "unitPrice",
  seller_selector_miss: "seller",
  fulfillment_selector_miss: "fulfillment"
};
const REPAIR_REASON_STAGES: Record<string, RetailerAdapterDiagnosticStage> = {
  availability_selector_miss: "availability_binding",
  add_control_selector_miss: "add_control",
  price_selector_miss: "price_binding",
  seller_selector_miss: "seller_binding",
  fulfillment_selector_miss: "fulfillment_binding"
};
const REPAIR_MINIMUM_DEVICES = 3;
const REPAIR_MINIMUM_SKUS = 2;
// An open repair SKU whose newest failure is older than this, with no newer
// failure, ages out: the loop cannot close it, so it stops driving replays.
const REPAIR_AGE_OUT_MS = 14 * 24 * 60 * 60_000;
// A passing no-click rehearsal proves the packaged runner binds the exact
// product again. It supersedes an earlier live-add *binding* failure; policy,
// interactive-block, identity, and runner-infrastructure stages are not
// binding evidence and keep the strict same-operation rule.
const NON_BINDING_STAGES = new Set<RetailerAdapterDiagnosticStage>([
  "policy", "interactive_block", "page_identity", "runner", "complete"
]);
const DEGRADATION_MINIMUM_REPAIR_SKUS = 2;
const DEGRADATION_REHEARSAL_WINDOW = 3;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_DIAGNOSTIC_AGE_MS = 10 * 60_000;
const RETENTION_LIMIT = 2_000;

const SKU_PATTERNS: Record<SupportedRetailerId, RegExp> = {
  target: /^\d{6,20}$/,
  walmart: /^\d{5,20}$/,
  amazon: /^[A-Z0-9]{10}$/,
  bestbuy: /^\d{5,20}$/,
  disney: /^\d{10,20}$/,
  ravensburger: /^\d{5,20}$/,
  riot: /^[A-Z0-9](?:[A-Z0-9-]{1,118}[A-Z0-9])?$/,
  booksamillion: /^[A-Z0-9]{10,20}$/,
  fanatics: /^\d{6,20}$/,
  kohls: /^\d{5,12}$/,
  macys: /^\d{5,20}$/,
  pbandai: /^[A-Z]\d{10}$/,
  pokemoncenter: /^\d{2,3}-\d{5}(?:-\d{3})?$/
};

const ADD_VERSIONS: Partial<Record<SupportedRetailerId, string>> = {
  target: TARGET_ADD_ADAPTER_VERSION,
  walmart: WALMART_ADD_ADAPTER_VERSION,
  amazon: AMAZON_ADD_ADAPTER_VERSION,
  bestbuy: BESTBUY_ADD_ADAPTER_VERSION
};

const COUNT_FIELDS = [
  "addControlCount",
  "scopedControlCount",
  "explicitSkuInputCount",
  "exactSkuInputCount",
  "variationSkuCount",
  "canonicalOfferInputCount",
  "canonicalOfferDistinctCount",
  "alternateOfferInputCount",
  "alternateOfferDistinctCount",
  "priceCandidateCount",
  "quantityControlCount"
] as const satisfies readonly (keyof RetailerAdapterLayoutEvidence)[];

interface DiagnosticRow {
  id: string;
  deviceId: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  adapterVersion: string;
  contractVersion: 1;
  operation: RetailerAdapterDiagnosticOperation;
  outcome: RetailerAdapterDiagnosticOutcome;
  failureStage: RetailerAdapterDiagnosticStage;
  reasonCode: string;
  attemptCount: number;
  domChanged: number;
  layoutFingerprint: string;
  layoutJson: string;
  observedAt: string;
  receivedAt: string;
}

export interface StoredRetailerAdapterDiagnostic extends Omit<DiagnosticRow, "domChanged" | "layoutJson"> {
  domChanged: boolean;
  layout: RetailerAdapterLayoutEvidence;
}

export type AdapterRepairQueueStatus = "open" | "recovered" | "aged_out";

export type LaneDegradationReason =
  | "open_repair_current_version"
  | "recent_rehearsals_rejected"
  | "live_add_failed_after_pass";

export interface LaneDegradation {
  degraded: boolean;
  reasons: LaneDegradationReason[];
}

export interface AdapterRepairQueueItem {
  retailerId: SupportedRetailerId;
  operation: RetailerAdapterDiagnosticOperation;
  status: AdapterRepairQueueStatus;
  layoutFingerprint: string;
  latestAdapterVersion: string;
  latestRetailerSku: string;
  failureStage: RetailerAdapterDiagnosticStage;
  reasonCode: string;
  occurrenceCount: number;
  affectedSkuCount: number;
  repairRetailerSkus: string[];
  maxAttemptCount: number;
  domChangedSeen: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  lastFailureAt: string;
  lastRecoveryAt: string;
  layout: RetailerAdapterLayoutEvidence;
  repairSuggestions: AdapterRepairSuggestion[];
}

export interface AdapterRepairSuggestion {
  field: ObserverRecipeField;
  selector: string;
  mode: ObserverRecipeMode;
  occurrenceCount: number;
  distinctDeviceCount: number;
  distinctSkuCount: number;
  minimumDeviceCount: typeof REPAIR_MINIMUM_DEVICES;
  minimumSkuCount: typeof REPAIR_MINIMUM_SKUS;
  reviewState: "collecting_evidence" | "maintainer_ready";
  executable: false;
}

function boundedCount(value: unknown, field: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 50) throw new Error(`Adapter diagnostic ${field} must be an integer from 0 through 50.`);
  return count;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Adapter diagnostic ${field} must be boolean.`);
  return value;
}

function normalizeRepairLandmarks(value: unknown): RetailerAdapterRepairLandmark[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) {
    throw new Error("Adapter diagnostic repair landmarks must be a bounded list.");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Adapter diagnostic repair landmarks are invalid.");
    }
    const input = item as Record<string, unknown>;
    const field = input.field as ObserverRecipeField;
    const elementKind = input.elementKind;
    const attribute = input.attribute;
    const landmarkValue = String(input.value ?? "").trim();
    if (!REPAIR_FIELDS.has(field)
      || !REPAIR_LANDMARK_ELEMENTS.has(elementKind as RetailerAdapterRepairLandmark["elementKind"])
      || (field === "addControl" && !["button", "input", "role_button"].includes(String(elementKind)))
      || (field !== "addControl" && elementKind === "input")
      || !REPAIR_LANDMARK_ATTRIBUTES.has(attribute as RetailerAdapterRepairLandmark["attribute"])
      || !REPAIR_LANDMARK_VALUE.test(landmarkValue)
      || !REPAIR_LANDMARK_INTENT[field].test(landmarkValue)
      || REPAIR_LANDMARK_FORBIDDEN.test(landmarkValue)
      || !landmarkValue.split(/[_.:-]+/).filter(Boolean)
        .every((token) => REPAIR_LANDMARK_TOKENS.has(token.toLocaleLowerCase("en-US")))
      || /\d{4,}|[a-f0-9]{12,}/i.test(landmarkValue)) {
      throw new Error("Adapter diagnostic repair landmarks are not privacy bounded.");
    }
    const key = `${field}:${elementKind}:${attribute}:${landmarkValue}`;
    if (seen.has(key)) throw new Error("Adapter diagnostic repair landmarks must be unique.");
    seen.add(key);
    return {
      field,
      elementKind: elementKind as RetailerAdapterRepairLandmark["elementKind"],
      attribute: attribute as RetailerAdapterRepairLandmark["attribute"],
      value: landmarkValue
    };
  });
}

function repairSelector(landmark: RetailerAdapterRepairLandmark): string {
  const element = landmark.elementKind === "role_button" ? "[role='button']" : landmark.elementKind;
  return `${element}[${landmark.attribute}='${landmark.value}']`;
}

function normalizeLayout(value: unknown, retailerId: SupportedRetailerId): RetailerAdapterLayoutEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Adapter diagnostic layout evidence is required.");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1
    || !PAGE_KINDS.has(input.pageKind as RetailerAdapterLayoutEvidence["pageKind"])
    || !SCOPE_KINDS.has(input.scopeKind as RetailerAdapterLayoutEvidence["scopeKind"])
    || !SELLER_SHAPES.has(input.sellerShape as RetailerAdapterLayoutEvidence["sellerShape"])
    || !FULFILLMENT_SHAPES.has(input.fulfillmentShape as RetailerAdapterLayoutEvidence["fulfillmentShape"])
    || !INTERACTIVE_BLOCKS.has(input.interactiveBlock as RetailerAdapterLayoutEvidence["interactiveBlock"])) {
    throw new Error("Adapter diagnostic layout enums are invalid.");
  }
  const counts = Object.fromEntries(COUNT_FIELDS.map((field) => [field, boundedCount(input[field], field)])) as Record<(typeof COUNT_FIELDS)[number], number>;
  const genericAddIntentCount = boundedCount(input.genericAddIntentCount ?? 0, "genericAddIntentCount");
  const repairCandidateCounts = Object.fromEntries(Object.values(REPAIR_COUNT_FIELDS).map((field) => [
    field,
    boundedCount(input[field] ?? 0, field)
  ])) as Record<(typeof REPAIR_COUNT_FIELDS)[keyof typeof REPAIR_COUNT_FIELDS], number>;
  const repairLandmarks = normalizeRepairLandmarks(input.repairLandmarks);
  const semanticControlBinding = counts.addControlCount === 0
    && genericAddIntentCount === 1
    && counts.scopedControlCount === 1
    && repairLandmarks.some((landmark) => landmark.field === "addControl");
  if (counts.exactSkuInputCount > counts.explicitSkuInputCount
    || counts.canonicalOfferDistinctCount > counts.canonicalOfferInputCount
    || counts.alternateOfferDistinctCount > counts.alternateOfferInputCount
    || (counts.scopedControlCount > counts.addControlCount && !semanticControlBinding)) {
    throw new Error("Adapter diagnostic layout counts are inconsistent.");
  }
  if (retailerId !== "amazon" && (
    counts.explicitSkuInputCount
    || counts.exactSkuInputCount
    || counts.variationSkuCount
    || counts.canonicalOfferInputCount
    || counts.canonicalOfferDistinctCount
    || counts.alternateOfferInputCount
    || counts.alternateOfferDistinctCount
  )) throw new Error("Amazon-only layout fields must be empty for other retailers.");
  if (repairLandmarks.length && (
    input.pageKind !== "product"
    || input.securityChallenge !== false
    || input.interactiveBlock !== ""
  )) throw new Error("Adapter diagnostic repair landmarks require one unblocked selector-miss layout.");
  for (const landmark of repairLandmarks) {
    const candidateCount = landmark.field === "addControl"
      ? genericAddIntentCount
      : repairCandidateCounts[REPAIR_COUNT_FIELDS[landmark.field]];
    if (candidateCount < 1) throw new Error("Adapter diagnostic repair landmarks require matching bounded structural evidence.");
  }
  return {
    schemaVersion: 1,
    pageKind: input.pageKind as RetailerAdapterLayoutEvidence["pageKind"],
    scopeKind: input.scopeKind as RetailerAdapterLayoutEvidence["scopeKind"],
    sellerShape: input.sellerShape as RetailerAdapterLayoutEvidence["sellerShape"],
    fulfillmentShape: input.fulfillmentShape as RetailerAdapterLayoutEvidence["fulfillmentShape"],
    ...counts,
    genericAddIntentCount,
    ...Object.fromEntries(Object.entries(repairCandidateCounts).filter(([, count]) => count > 0)),
    securityChallenge: requiredBoolean(input.securityChallenge, "securityChallenge"),
    interactiveBlock: input.interactiveBlock as RetailerAdapterLayoutEvidence["interactiveBlock"],
    ...(repairLandmarks.length ? { repairLandmarks } : {})
  };
}

function repairSuggestions(rows: StoredRetailerAdapterDiagnostic[], open: boolean): AdapterRepairSuggestion[] {
  if (!open) return [];
  const evidence = new Map<string, {
    landmark: RetailerAdapterRepairLandmark;
    occurrences: number;
    devices: Set<string>;
    skus: Set<string>;
  }>();
  for (const row of rows) {
    if (row.operation !== "observe" || row.outcome !== "failed"
      || !REPAIR_SELECTOR_MISS_REASONS.has(row.reasonCode)) continue;
    for (const landmark of row.layout.repairLandmarks ?? []) {
      const selector = repairSelector(landmark);
      const key = `${landmark.field}:${selector}`;
      const item = evidence.get(key) ?? {
        landmark,
        occurrences: 0,
        devices: new Set<string>(),
        skus: new Set<string>()
      };
      item.occurrences += 1;
      item.devices.add(row.deviceId);
      item.skus.add(row.retailerSku);
      evidence.set(key, item);
    }
  }
  return [...evidence.values()].map<AdapterRepairSuggestion>((item) => {
    const ready = item.devices.size >= REPAIR_MINIMUM_DEVICES && item.skus.size >= REPAIR_MINIMUM_SKUS;
    return {
      field: item.landmark.field,
      selector: repairSelector(item.landmark),
      mode: REPAIR_MODES[item.landmark.field],
      occurrenceCount: item.occurrences,
      distinctDeviceCount: item.devices.size,
      distinctSkuCount: item.skus.size,
      minimumDeviceCount: REPAIR_MINIMUM_DEVICES,
      minimumSkuCount: REPAIR_MINIMUM_SKUS,
      reviewState: ready ? "maintainer_ready" as const : "collecting_evidence" as const,
      executable: false as const
    };
  }).sort((left, right) => Number(right.reviewState === "maintainer_ready") - Number(left.reviewState === "maintainer_ready")
    || right.distinctDeviceCount - left.distinctDeviceCount
    || right.distinctSkuCount - left.distinctSkuCount
    || right.occurrenceCount - left.occurrenceCount
    || left.field.localeCompare(right.field)
    || left.selector.localeCompare(right.selector));
}

function rowToStored(row: DiagnosticRow): StoredRetailerAdapterDiagnostic {
  return {
    ...row,
    domChanged: row.domChanged === 1,
    layout: JSON.parse(row.layoutJson) as RetailerAdapterLayoutEvidence
  };
}

function strictlyNewerAdapterVersion(candidate: string, previous: string): boolean {
  const candidateMatch = /^(.*)-v(\d+)$/.exec(candidate);
  const previousMatch = /^(.*)-v(\d+)$/.exec(previous);
  return Boolean(candidateMatch && previousMatch
    && candidateMatch[1] === previousMatch[1]
    && Number(candidateMatch[2]) > Number(previousMatch[2]));
}

export class AdapterDiagnosticRepository {
  constructor(private readonly db: YoinkDatabase) {}

  record(deviceId: string, input: RetailerAdapterDiagnosticInput, now = Date.now()): StoredRetailerAdapterDiagnostic {
    if (!input || typeof input !== "object") throw new Error("A retailer adapter diagnostic is required.");
    const cleanDeviceId = cleanText(deviceId, 120);
    if (!this.db.get("SELECT id FROM extension_devices WHERE id = ? AND user_id = ? AND status = 'active'", cleanDeviceId, currentRequestScope().userId)) {
      throw new Error("The paired Chrome device is unavailable.");
    }
    if (!Object.hasOwn(SKU_PATTERNS, input.retailerId)) throw new Error("The adapter diagnostic retailer is unsupported.");
    const retailerId = input.retailerId;
    const retailerSku = cleanText(input.retailerSku, 64).toUpperCase();
    if (!SKU_PATTERNS[retailerId].test(retailerSku)) throw new Error("A valid exact retailer SKU is required for adapter diagnostics.");
    if (input.contractVersion !== 1 || !OPERATIONS.has(input.operation) || !OUTCOMES.has(input.outcome) || !STAGES.has(input.failureStage)) {
      throw new Error("The adapter diagnostic contract is unsupported.");
    }
    const expectedVersion = input.operation === "observe" ? RETAILER_OBSERVER_VERSIONS[retailerId] : ADD_VERSIONS[retailerId];
    if (!expectedVersion || input.adapterVersion !== expectedVersion) throw new Error("The adapter diagnostic version is unsupported.");
    if ((input.outcome === "passed") !== (input.failureStage === "complete")) {
      throw new Error("Adapter diagnostic outcome and failure stage are inconsistent.");
    }
    const reasonCode = cleanText(input.reasonCode, 80).toLowerCase();
    if (!REASON_CODES.has(reasonCode)) throw new Error("The adapter diagnostic reason code is not allowlisted.");
    if (REPAIR_SELECTOR_MISS_REASONS.has(reasonCode)
      && input.failureStage !== REPAIR_REASON_STAGES[reasonCode]) {
      throw new Error("The adapter diagnostic selector-miss stage is inconsistent.");
    }
    if (reasonCode === "product_page_unavailable"
      && (input.operation !== "observe" || input.outcome !== "rejected" || input.failureStage !== "page_identity")) {
      throw new Error("An unavailable product page is a rejected read-only page-identity result.");
    }
    const attemptCount = Number(input.attemptCount);
    if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > 3) throw new Error("Adapter diagnostic attempt count must be 1 through 3.");
    if (input.outcome === "recovered" && attemptCount < 2) throw new Error("A recovered diagnostic requires a retry attempt.");
    const domChanged = requiredBoolean(input.domChanged, "domChanged");
    const observedTime = new Date(input.observedAt).getTime();
    if (!Number.isFinite(observedTime) || observedTime > now + MAX_CLOCK_SKEW_MS || now - observedTime > MAX_DIAGNOSTIC_AGE_MS) {
      throw new Error("The adapter diagnostic is stale or has an invalid timestamp.");
    }
    const observedAt = new Date(observedTime).toISOString();
    const layout = normalizeLayout(input.layout, retailerId);
    const repairEvidenceAllowed = input.operation === "observe" && (
      (input.outcome === "failed" && REPAIR_SELECTOR_MISS_REASONS.has(reasonCode))
      || (input.outcome === "recovered" && reasonCode === "dom_hydration_recovered")
      || (input.outcome === "passed" && reasonCode === "semantic_layout_recovered")
    );
    if ((layout.repairLandmarks?.length ?? 0) > 0 && !repairEvidenceAllowed) {
      throw new Error("Adapter diagnostic repair landmarks require one selector-miss or recovered observer result.");
    }
    const requiredRepairField = REPAIR_REASON_FIELDS[reasonCode];
    if (requiredRepairField && requiredRepairField !== "addControl"
      && !layout.repairLandmarks?.some((landmark) => landmark.field === requiredRepairField)) {
      throw new Error("The adapter diagnostic selector miss lacks its matching bounded landmark.");
    }
    const layoutJson = JSON.stringify(layout);
    // scopedControlCount reflects the adapter's interpretation, not the page's
    // raw structure. Excluding it keeps a layout fingerprint stable when a
    // newer adapter learns to bind the same markup successfully.
    const fingerprintLayout = { ...layout, scopedControlCount: 0 };
    const layoutFingerprint = stableHash("retailer-adapter-layout-v1", retailerId, JSON.stringify(fingerprintLayout));
    const existing = this.db.get<DiagnosticRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              retailer_sku AS retailerSku, adapter_version AS adapterVersion,
              contract_version AS contractVersion, operation, outcome,
              failure_stage AS failureStage, reason_code AS reasonCode,
              attempt_count AS attemptCount, dom_changed AS domChanged,
              layout_fingerprint AS layoutFingerprint, layout_json AS layoutJson,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_adapter_diagnostics
       WHERE user_id = ? AND device_id = ? AND retailer_id = ?
         AND retailer_sku = ? AND adapter_version = ? AND operation = ?
         AND outcome = ? AND failure_stage = ? AND reason_code = ?
         AND attempt_count = ? AND dom_changed = ? AND layout_fingerprint = ?
         AND layout_json = ? AND observed_at = ?
       ORDER BY received_at DESC, id DESC LIMIT 1`,
      currentRequestScope().userId,
      cleanDeviceId,
      retailerId,
      retailerSku,
      expectedVersion,
      input.operation,
      input.outcome,
      input.failureStage,
      reasonCode,
      attemptCount,
      domChanged ? 1 : 0,
      layoutFingerprint,
      layoutJson,
      observedAt
    );
    if (existing) return rowToStored(existing);
    const id = newId("adapter_diagnostic");
    const receivedAt = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO retailer_adapter_diagnostics(
           id, tenant_id, user_id, device_id, retailer_id, retailer_sku,
           adapter_version, contract_version, operation, outcome, failure_stage,
           reason_code, attempt_count, dom_changed, layout_fingerprint,
           layout_json, observed_at, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        currentRequestScope().tenantId,
        currentRequestScope().userId,
        cleanDeviceId,
        retailerId,
        retailerSku,
        expectedVersion,
        input.operation,
        input.outcome,
        input.failureStage,
        reasonCode,
        attemptCount,
        domChanged ? 1 : 0,
        layoutFingerprint,
        layoutJson,
        observedAt,
        receivedAt
      );
      this.db.run(
        `DELETE FROM retailer_adapter_diagnostics
         WHERE user_id = ? AND id NOT IN (
           SELECT id FROM retailer_adapter_diagnostics
           WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?
         )`,
        currentRequestScope().userId,
        currentRequestScope().userId,
        RETENTION_LIMIT
      );
    });
    return {
      id,
      deviceId: cleanDeviceId,
      retailerId,
      retailerSku,
      adapterVersion: expectedVersion,
      contractVersion: 1,
      operation: input.operation,
      outcome: input.outcome,
      failureStage: input.failureStage,
      reasonCode,
      attemptCount,
      domChanged,
      layoutFingerprint,
      layout,
      observedAt,
      receivedAt
    };
  }

  listRecent(limit = 100): StoredRetailerAdapterDiagnostic[] {
    const safeLimit = Math.max(1, Math.min(RETENTION_LIMIT, Math.trunc(Number(limit) || 100)));
    return this.db.all<DiagnosticRow>(
      `SELECT id, device_id AS deviceId, retailer_id AS retailerId,
              retailer_sku AS retailerSku, adapter_version AS adapterVersion,
              contract_version AS contractVersion, operation, outcome,
              failure_stage AS failureStage, reason_code AS reasonCode,
              attempt_count AS attemptCount, dom_changed AS domChanged,
              layout_fingerprint AS layoutFingerprint, layout_json AS layoutJson,
              observed_at AS observedAt, received_at AS receivedAt
       FROM retailer_adapter_diagnostics
       WHERE user_id = ? ORDER BY received_at DESC, id DESC LIMIT ?`,
      currentRequestScope().userId,
      safeLimit
    ).map(rowToStored);
  }

  listRepairQueue(limit = 50, now = Date.now()): AdapterRepairQueueItem[] {
    const recent = this.listRecent(RETENTION_LIMIT);
    const ageOutCutoff = nowIso(now - REPAIR_AGE_OUT_MS);
    const groups = new Map<string, {
      rows: StoredRetailerAdapterDiagnostic[];
      repairs: StoredRetailerAdapterDiagnostic[];
      skus: Set<string>;
    }>();
    for (const row of recent) {
      const key = `${row.retailerId}:${row.operation}:${row.layoutFingerprint}`;
      const group = groups.get(key) ?? { rows: [], repairs: [], skus: new Set<string>() };
      group.rows.push(row);
      if (row.outcome === "failed" || row.outcome === "recovered") {
        group.repairs.push(row);
        group.skus.add(row.retailerSku);
      }
      groups.set(key, group);
    }
    const queue: AdapterRepairQueueItem[] = [];
    for (const group of groups.values()) {
      if (!group.repairs.length) continue;
      const latest = group.rows[0] as StoredRetailerAdapterDiagnostic;
      const latestRepair = group.repairs[0] as StoredRetailerAdapterDiagnostic;
      const failures = group.rows.filter((row) => row.outcome === "failed");
      const recoveries = group.rows.filter((row) => row.outcome === "passed" || row.outcome === "recovered");
      const lastFailureAt = failures[0]?.receivedAt ?? "";
      let lastRecoveryAt = recoveries[0]?.receivedAt ?? "";
      const supersedingRows: StoredRetailerAdapterDiagnostic[] = [];
      const failedSkus = [...new Set(failures.map((row) => row.retailerSku))];
      const repairRetailerSkus = failedSkus.filter((retailerSku) => {
        const latestFailure = failures.find((row) => row.retailerSku === retailerSku);
        if (!latestFailure) return false;
        const replacement = recent.find((row) => row.retailerId === latestFailure.retailerId
          && row.retailerSku === retailerSku
          && row.receivedAt > latestFailure.receivedAt
          && row.outcome !== "failed"
          && (row.adapterVersion === latestFailure.adapterVersion
            || strictlyNewerAdapterVersion(row.adapterVersion, latestFailure.adapterVersion))
          && (row.operation === latestFailure.operation
            || (latestFailure.operation === "live_add"
              && row.operation === "rehearse_add"
              && row.outcome === "passed"
              && !NON_BINDING_STAGES.has(latestFailure.failureStage))));
        if (replacement) supersedingRows.push(replacement);
        return !replacement;
      });
      const unresolved = repairRetailerSkus.length > 0;
      const agedOut = unresolved && lastFailureAt !== "" && lastFailureAt < ageOutCutoff;
      const open = unresolved && !agedOut;
      lastRecoveryAt = supersedingRows
        .map((row) => row.receivedAt)
        .reduce((value, candidate) => candidate > value ? candidate : value, lastRecoveryAt);
      const firstSeenAt = group.repairs.reduce((value, row) => value < row.receivedAt ? value : row.receivedAt, latestRepair.receivedAt);
      queue.push({
        retailerId: latest.retailerId,
        operation: latest.operation,
        status: open ? "open" : agedOut ? "aged_out" : "recovered",
        layoutFingerprint: latest.layoutFingerprint,
        latestAdapterVersion: latest.adapterVersion,
        latestRetailerSku: latestRepair.retailerSku,
        failureStage: latestRepair.failureStage,
        reasonCode: latestRepair.reasonCode,
        occurrenceCount: group.repairs.length,
        affectedSkuCount: group.skus.size,
        repairRetailerSkus,
        maxAttemptCount: Math.max(...group.repairs.map((row) => row.attemptCount)),
        domChangedSeen: group.repairs.some((row) => row.domChanged),
        firstSeenAt,
        lastSeenAt: lastRecoveryAt > latest.receivedAt ? lastRecoveryAt : latest.receivedAt,
        lastFailureAt,
        lastRecoveryAt,
        layout: latestRepair.layout,
        repairSuggestions: repairSuggestions(group.rows, open)
      });
    }
    return queue
      .sort((left, right) => Number(right.status === "open") - Number(left.status === "open") || right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, Math.max(1, Math.min(RETENTION_LIMIT, Math.trunc(Number(limit) || 50))));
  }

  counts(now = Date.now()): {
    adapterDiagnosticEvents: number;
    openAdapterRepairGroups: number;
    recoveredAdapterRepairGroups: number;
    agedOutAdapterRepairGroups: number;
  } {
    const adapterDiagnosticEvents = Number(this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM retailer_adapter_diagnostics WHERE user_id = ?",
      currentRequestScope().userId
    )?.count ?? 0);
    const queue = this.listRepairQueue(RETENTION_LIMIT, now);
    return {
      adapterDiagnosticEvents,
      openAdapterRepairGroups: queue.filter((item) => item.status === "open").length,
      recoveredAdapterRepairGroups: queue.filter((item) => item.status === "recovered").length,
      agedOutAdapterRepairGroups: queue.filter((item) => item.status === "aged_out").length
    };
  }
}

/**
 * Derives whether a guarded-add lane should stop leasing live adds because
 * current-version evidence is failing. Pure read: it never writes the
 * qualification row, so a later passing rehearsal lifts it automatically.
 */
export function laneDegradation(
  db: YoinkDatabase,
  retailerId: "target" | "walmart" | "amazon" | "bestbuy",
  versions: { add: string; observer: string },
  now = Date.now()
): LaneDegradation {
  const scope = currentRequestScope();
  const reasons: LaneDegradationReason[] = [];
  const repairSkus = new Set<string>();
  for (const group of new AdapterDiagnosticRepository(db).listRepairQueue(RETENTION_LIMIT, now)) {
    if (group.retailerId !== retailerId || group.status !== "open") continue;
    if (group.latestAdapterVersion !== versions.add && group.latestAdapterVersion !== versions.observer) continue;
    for (const retailerSku of group.repairRetailerSkus) repairSkus.add(retailerSku);
  }
  if (repairSkus.size >= DEGRADATION_MINIMUM_REPAIR_SKUS) reasons.push("open_repair_current_version");
  const rehearsals = db.all<{ outcome: string }>(
    `SELECT outcome FROM retailer_adapter_trials
     WHERE tenant_id = ? AND user_id = ? AND retailer_id = ? AND adapter_version = ?
       AND trial_kind = 'pre_click_rehearsal'
     ORDER BY received_at DESC, id DESC LIMIT ?`,
    scope.tenantId,
    scope.userId,
    retailerId,
    versions.add,
    DEGRADATION_REHEARSAL_WINDOW
  );
  if (rehearsals.length === DEGRADATION_REHEARSAL_WINDOW && rehearsals.every((row) => row.outcome === "rejected")) {
    reasons.push("recent_rehearsals_rejected");
  }
  const latestLiveFailure = db.get<{ receivedAt: string }>(
    `SELECT received_at AS receivedAt FROM retailer_adapter_diagnostics
     WHERE user_id = ? AND retailer_id = ? AND adapter_version = ?
       AND operation = 'live_add' AND outcome = 'failed' AND failure_stage <> 'interactive_block'
     ORDER BY received_at DESC, id DESC LIMIT 1`,
    scope.userId,
    retailerId,
    versions.add
  );
  if (latestLiveFailure) {
    const latestLivePass = db.get<{ receivedAt: string }>(
      `SELECT received_at AS receivedAt FROM retailer_adapter_diagnostics
       WHERE user_id = ? AND retailer_id = ? AND adapter_version = ?
         AND operation IN ('live_add', 'rehearse_add') AND outcome = 'passed'
       ORDER BY received_at DESC, id DESC LIMIT 1`,
      scope.userId,
      retailerId,
      versions.add
    );
    const latestRehearsalPass = db.get<{ receivedAt: string }>(
      `SELECT received_at AS receivedAt FROM retailer_adapter_trials
       WHERE tenant_id = ? AND user_id = ? AND retailer_id = ? AND adapter_version = ?
         AND trial_kind = 'pre_click_rehearsal' AND outcome = 'passed'
       ORDER BY received_at DESC, id DESC LIMIT 1`,
      scope.tenantId,
      scope.userId,
      retailerId,
      versions.add
    );
    const latestPassAt = [latestLivePass?.receivedAt ?? "", latestRehearsalPass?.receivedAt ?? ""]
      .reduce((value, candidate) => candidate > value ? candidate : value, "");
    if (!latestPassAt || latestLiveFailure.receivedAt > latestPassAt) reasons.push("live_add_failed_after_pass");
  }
  return { degraded: reasons.length > 0, reasons };
}
