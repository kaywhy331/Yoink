import {
  PURCHASE_INTENT_DELETE_CONFIRMATION,
  TEST_CALL_CONFIRMATION,
  TEST_CALL_CONTRACT_VERSION,
  TEST_CALL_PLAN_MINUTES,
  TEST_CALL_PLAN_ORIGIN,
  TEST_CALL_SPACING_SECONDS,
  YOINK_TEST_CALL_SOURCE,
  type SignalEventInput,
  type TestCallCandidate,
  type TestCallInput,
  type TestCallLinkInput
} from "../../contracts/src/index.js";
import { exactRetailerProductLink } from "../../domain/src/attribution.js";
import { CatalogRepository } from "./catalog-repository.js";
import type { ControlRepository, ProductWantOptions } from "./control-repository.js";
import { MSRP_GUARDED_RETAILERS, guardedCartQuantity } from "../../contracts/src/official-msrp.js";
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

/** A Best Buy product link that names only its product code (/product/<name>/<code>), with no SKU. */
function bestBuyCodeOnlyLink(value: string): boolean {
  try {
    const url = new URL(value);
    return /(?:^|\.)bestbuy\.com$/i.test(url.hostname) && /^\/product\/[^/]+\/(?=[0-9]*[a-z])[a-z0-9]{10}\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}
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
    this.requireTestable();
    const listingId = cleanText(value.listingId, 120);
    const row = this.targets("", listingId)[0];
    if (!row) blocked("test_call_not_wanted", "Choose an item on your Want list that is set to Add to cart at this store.");
    const candidate = this.candidate(row, now);
    if (!candidate.ready) blocked("test_call_not_ready", candidate.reason);
    this.requireSpacing(row.retailerId, row.retailerSku, now);
    return this.signal(row, candidate.priceCents!, now);
  }

  /**
   * Test any in-stock item (Kevin, 2026-10-08): called items are usually sold
   * out, so the shopper links an item they know is in stock and gives a max
   * price. Yoink adds the listing if it's new, saves a 15-minute Add to cart
   * plan for that one listing (that price = MSRP = max), and returns a call at
   * it. Chrome adds the item at the store's price when that is at or under it
   * (2026-10-11: a typed $25.00 had refused Target's $24.99).
   */
  inputForLink(value: TestCallLinkInput, control: ControlRepository, now = Date.now(), options: ProductWantOptions = {}): SignalEventInput {
    new AuthorizationRepository(this.db).require("user.intent.manage");
    if (value?.contractVersion !== TEST_CALL_CONTRACT_VERSION || value.confirmation !== TEST_CALL_CONFIRMATION) {
      blocked("test_call_confirmation_required", "Confirm the test call first.");
    }
    this.requireTestable();
    // Best Buy's current links name a product code, not the SKU (Kevin's Test
    // call, 2026-10-11); the SKU shown on its page works instead.
    const raw = String(value.url ?? "").trim();
    const bestBuySku = cleanText(value.retailerId, 40) === "bestbuy" ? raw.match(/^(?:sku\s*:?\s*)?(\d{5,20})$/i)?.[1] : undefined;
    const exact = exactRetailerProductLink(bestBuySku ? `https://www.bestbuy.com/site/-/${bestBuySku}.p` : raw);
    if (!exact) {
      blocked("test_call_link_invalid", bestBuyCodeOnlyLink(raw)
        ? "Best Buy's link doesn't include the SKU. Paste the SKU shown on the page (SKU: 1234567) instead."
        : "Paste a product page link with the store's item number in it.");
    }
    const store = this.db.get<{ name: string }>("SELECT display_name AS name FROM retailers WHERE id = ?", exact.retailerId);
    if (!store) blocked("test_call_link_invalid", "Yoink doesn't support that store.");
    if (cleanText(value.retailerId, 40) && exact.retailerId !== cleanText(value.retailerId, 40)) {
      blocked("test_call_link_store", `That link is for ${store.name}. Use ${store.name}'s Test call.`);
    }
    const msrpCents = Number(value.msrpCents);
    if (!Number.isSafeInteger(msrpCents) || msrpCents <= 0 || msrpCents > 100_000_000) blocked("test_call_msrp_invalid", "Enter your max price above $0.");
    // How many to add (Kevin, 2026-10-10); the store's own limit still caps it in Chrome.
    const quantity = value.quantity === undefined || value.quantity === null ? 1 : Number(value.quantity);
    if (!guardedCartQuantity(quantity)) blocked("test_call_quantity_invalid", "Choose a quantity from 1 to 10.");
    this.requireSpacing(exact.retailerId, exact.retailerSku, now);
    this.ensureSource(now);
    const existing = this.db.get<{ id: string }>("SELECT id FROM listings WHERE retailer_id = ? AND retailer_sku = ?", exact.retailerId, exact.retailerSku);
    const listingId = existing?.id ?? new CatalogRepository(this.db).upsertListing({
      sourceConnectionId: this.sourceConnectionId(), source: YOINK_TEST_CALL_SOURCE,
      sourceProductId: `test-call-${exact.retailerId}-${exact.retailerSku}`, sourceListingId: `test-call-${exact.retailerId}-${exact.retailerSku}`,
      title: `Test item at ${store.name} (${exact.retailerSku})`, retailerId: exact.retailerId, retailerSku: exact.retailerSku,
      canonicalUrl: exact.canonicalUrl, executionSupported: true, msrpCents, currency: "USD", observedAt: nowIso(now)
    }, now).listing.id;
    control.saveTestCallPlan(listingId, msrpCents, now + TEST_CALL_PLAN_MINUTES * 60_000, now, options, quantity);
    const row = this.targets("", listingId)[0];
    if (!row) blocked("test_call_not_ready", "Yoink couldn't set up the test for this item.");
    return this.signal(row, msrpCents, now);
  }

  /** Removes test plans ten minutes after they expired, by which time their cart add has long finished. */
  retireTestPlans(control: ControlRepository, now = Date.now()): number {
    const scope = currentRequestScope();
    const plans = this.db.all<{ id: string }>(
      "SELECT id FROM missions WHERE tenant_id = ? AND user_id = ? AND origin = ? AND status <> 'deleted'",
      scope.tenantId, scope.userId, TEST_CALL_PLAN_ORIGIN
    );
    let retired = 0;
    for (const plan of plans) {
      const expiresAt = Date.parse(new PurchasePolicyRepository(this.db).current(plan.id)?.expiresAt || "");
      if (!Number.isFinite(expiresAt) || now - expiresAt < 10 * 60_000) continue;
      control.deleteMission(plan.id, { confirmation: PURCHASE_INTENT_DELETE_CONFIRMATION }, now);
      retired += 1;
    }
    return retired;
  }

  private requireTestable(): void {
    if (!isExactLocalRequestScope()) blocked("test_call_local_only", "Test calls are only available on your own PC.");
    const settings = this.db.get<{ actionsPaused: number; executionMode: string }>(
      "SELECT actions_paused AS actionsPaused, execution_mode AS executionMode FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    if (Number(settings?.actionsPaused) === 1) {
      blocked("test_call_auto_cart_off", "Turn Auto-cart on first. A test call adds to your cart like a real call.");
    }
    if (settings?.executionMode !== "live") blocked("test_call_not_live", "Yoink is in test mode, so it won't add to your cart.");
  }

  private requireSpacing(retailerId: string, retailerSku: string, now: number): void {
    const scope = currentRequestScope();
    const recent = this.db.get<{ receivedAt: string }>(
      `SELECT received_at AS receivedAt FROM signal_events
       WHERE tenant_id = ? AND user_id = ? AND source = ?
         AND json_extract(identity_json, '$.retailerId') = ? AND json_extract(identity_json, '$.retailerSku') = ?
       ORDER BY received_at DESC LIMIT 1`,
      scope.tenantId, scope.userId, YOINK_TEST_CALL_SOURCE, retailerId, retailerSku
    );
    const sinceMs = recent ? now - Date.parse(recent.receivedAt) : Number.POSITIVE_INFINITY;
    if (sinceMs < TEST_CALL_SPACING_SECONDS * 1_000) {
      blocked("test_call_too_soon", `A test call for this item went out ${Math.max(1, Math.round(sinceMs / 60_000))} min ago. Try again in a few minutes.`);
    }
  }

  private signal(row: TargetRow, priceCents: number, now: number): SignalEventInput {
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
      offer: { availability: "in_stock", unitPriceCents: priceCents, currency: "USD" }
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
