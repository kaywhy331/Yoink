import {
  TEST_CALL_CONFIRMATION,
  TEST_CALL_CONTRACT_VERSION,
  TEST_CALL_SPACING_SECONDS,
  YOINK_TEST_CALL_SOURCE,
  type SignalEventInput,
  type TestCallCandidate,
  type TestCallInput
} from "../../contracts/src/index.js";
import { MSRP_GUARDED_RETAILERS } from "../../contracts/src/official-msrp.js";
import { DomainConflictError } from "../../domain/src/domain-request-error.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import type { YoinkDatabase } from "./database.js";
import { OfficialMsrpRepository } from "./official-msrp-repository.js";
import { PurchasePolicyRepository } from "./purchase-policy-repository.js";
import { currentRequestScope, isExactLocalRequestScope, ownedIdForUser } from "./request-scope.js";

interface TargetRow {
  missionId: string; listingId: string; title: string; retailerId: string; retailerName: string;
  retailerSku: string; canonicalUrl: string; priceCents: number | null;
}

function blocked(code: string, message: string): never { throw new DomainConflictError(code, message); }
function dollars(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }

/**
 * Builds the test calls the shopper sends from Setup › Stores. It only
 * prepares the call; the signal engine then treats it like any call, so the
 * plan, MSRP, spending and Chrome checks all still apply.
 */
export class TestCallRepository {
  constructor(private readonly db: YoinkDatabase) {}

  sourceConnectionId(): string {
    return ownedIdForUser("source_yoink_test", currentRequestScope().userId, "source_yoink_test_local");
  }

  /** The cart items at a store a test call can use, ready or not, with the reason when not. */
  candidates(retailerId: string, now = Date.now()): TestCallCandidate[] {
    new AuthorizationRepository(this.db).require("user.intent.manage");
    return this.targets(cleanText(retailerId, 40), "").map((row) => this.candidate(row, now));
  }

  /** Checks the chosen item and returns the call to process. Writes nothing but the source connection. */
  input(value: TestCallInput, now = Date.now()): SignalEventInput {
    new AuthorizationRepository(this.db).require("user.intent.manage");
    if (value?.contractVersion !== TEST_CALL_CONTRACT_VERSION || value.confirmation !== TEST_CALL_CONFIRMATION) {
      blocked("test_call_confirmation_required", "Confirm the test call first.");
    }
    if (!isExactLocalRequestScope()) blocked("test_call_local_only", "Test calls are only available on your own PC.");
    const settings = this.db.get<{ actionsPaused: number; executionMode: string }>(
      "SELECT actions_paused AS actionsPaused, execution_mode AS executionMode FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    if (Number(settings?.actionsPaused) === 1) {
      blocked("test_call_auto_cart_off", "Turn Auto-cart on first. A test call adds to your cart like a real call.");
    }
    if (settings?.executionMode !== "live") blocked("test_call_not_live", "Yoink is in test mode, so it won't add to your cart.");
    const listingId = cleanText(value.listingId, 120);
    const row = this.targets("", listingId)[0];
    if (!row) blocked("test_call_not_wanted", "Choose an item on your Want list that is set to Add to cart at this store.");
    const candidate = this.candidate(row, now);
    if (!candidate.ready) blocked("test_call_not_ready", candidate.reason);
    const scope = currentRequestScope();
    const recent = this.db.get<{ receivedAt: string }>(
      `SELECT received_at AS receivedAt FROM signal_events
       WHERE tenant_id = ? AND user_id = ? AND source = ?
         AND json_extract(identity_json, '$.retailerId') = ? AND json_extract(identity_json, '$.retailerSku') = ?
       ORDER BY received_at DESC LIMIT 1`,
      scope.tenantId, scope.userId, YOINK_TEST_CALL_SOURCE, row.retailerId, row.retailerSku
    );
    const sinceMs = recent ? now - Date.parse(recent.receivedAt) : Number.POSITIVE_INFINITY;
    if (sinceMs < TEST_CALL_SPACING_SECONDS * 1_000) {
      blocked("test_call_too_soon", `A test call for this item went out ${Math.max(1, Math.round(sinceMs / 60_000))} min ago. Try again in a few minutes.`);
    }
    this.ensureSource(now);
    const timestamp = nowIso(now);
    return {
      schemaVersion: 1,
      signalId: newId("test_call"),
      sourceConnectionId: this.sourceConnectionId(),
      source: YOINK_TEST_CALL_SOURCE,
      externalEventId: newId("test_call_event"),
      eventType: "in_stock",
      observedAt: timestamp,
      receivedAt: timestamp,
      identity: { retailerId: row.retailerId, retailerSku: row.retailerSku, canonicalUrl: row.canonicalUrl, title: row.title },
      offer: { availability: "in_stock", unitPriceCents: candidate.priceCents!, currency: "USD" }
    };
  }

  private candidate(row: TargetRow, now: number): TestCallCandidate {
    const guarded = MSRP_GUARDED_RETAILERS.includes(row.retailerId);
    const policy = new PurchasePolicyRepository(this.db).current(row.missionId);
    const target = policy?.targets.find((item) => item.listingId === row.listingId && item.enabled);
    const evidence = guarded ? new OfficialMsrpRepository(this.db).current(row.listingId, now) : null;
    const max = Number.isSafeInteger(Number(target?.maxUnitPriceCents)) && Number(target?.maxUnitPriceCents) > 0
      ? Number(target!.maxUnitPriceCents) : null;
    const price = Number.isSafeInteger(Number(row.priceCents)) && Number(row.priceCents) > 0 ? Number(row.priceCents) : null;
    let reason = "";
    if (!policy || policy.actionCeiling !== "add_to_cart" || !target) reason = "Set this item to Add to cart in Want it first.";
    else if (guarded && (!evidence || target.officialMsrpEvidenceId !== evidence.id)) reason = "Confirm the MSRP in Want it first.";
    else if (max === null) reason = "Set a max price in Want it first.";
    else if (price === null) reason = "Yoink hasn't recorded a price for this item yet.";
    else if (price > max) reason = `The last recorded price, ${dollars(price)}, is above your max of ${dollars(max)}.`;
    else if (evidence && price > evidence.msrpCents) reason = `The last recorded price, ${dollars(price)}, is above the MSRP of ${dollars(evidence.msrpCents)}.`;
    return {
      listingId: row.listingId, title: row.title, retailerId: row.retailerId, retailerName: row.retailerName,
      retailerSku: row.retailerSku, priceCents: price, maxUnitPriceCents: max, msrpCents: evidence?.msrpCents ?? null,
      ready: !reason, reason
    };
  }

  /** Enabled Add-to-cart targets of the shopper's active plans, at one store or for one listing. */
  private targets(retailerId: string, listingId: string): TargetRow[] {
    const scope = currentRequestScope();
    return this.db.all<TargetRow>(
      `SELECT m.id AS missionId, l.id AS listingId, v.title, l.retailer_id AS retailerId, r.display_name AS retailerName,
              l.retailer_sku AS retailerSku, l.canonical_url AS canonicalUrl,
              (SELECT oo.unit_price_cents FROM offer_observations oo
               WHERE oo.listing_id = l.id AND oo.unit_price_cents IS NOT NULL
               ORDER BY oo.observed_at DESC, oo.id DESC LIMIT 1) AS priceCents
       FROM missions m
       JOIN mission_targets mt ON mt.mission_id = m.id AND mt.enabled = 1
       JOIN listings l ON l.id = mt.listing_id
       JOIN variants v ON v.id = l.variant_id
       JOIN retailers r ON r.id = l.retailer_id
       WHERE m.tenant_id = ? AND m.user_id = ? AND m.status = 'active'
         AND (? = '' OR l.retailer_id = ?) AND (? = '' OR l.id = ?)
       ORDER BY v.title COLLATE NOCASE, l.retailer_sku`,
      scope.tenantId, scope.userId, retailerId, retailerId, listingId, listingId
    ).filter((row) => new PurchasePolicyRepository(this.db).current(row.missionId)?.actionCeiling === "add_to_cart");
  }

  private ensureSource(now: number): void {
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    this.db.run(
      `INSERT INTO source_connections(id, tenant_id, user_id, source, name, status, trust_level,
         auto_create_missions, is_private, last_event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Yoink test calls', 'connected', 'trusted_exact', 0, 1, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = 'connected', trust_level = 'trusted_exact', updated_at = excluded.updated_at`,
      this.sourceConnectionId(), scope.tenantId, scope.userId, YOINK_TEST_CALL_SOURCE, timestamp, timestamp
    );
  }
}
