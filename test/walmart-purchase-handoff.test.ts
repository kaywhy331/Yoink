import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  deriveWalmartPurchaseHandoff,
  withWalmartPurchaseHandoff
} from "../apps/api/src/walmart-purchase-handoff.js";
import type { SignalEventInput, StrategyDefinition } from "../packages/contracts/src/index.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { SignalRepository } from "../packages/database/src/signal-repository.js";
import { WalmartPurchaseHandoffInteractionRepository } from "../packages/database/src/walmart-purchase-handoff-interaction-repository.js";
import { SignalEngine } from "../packages/engine/src/signal-engine.js";
import { enablePlansFromCalls } from "./helpers/plans-from-calls.js";

const NOW = Date.now();
const ITEM_ID = "19988614228";

function signal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    retailerId: "walmart",
    retailerSku: ITEM_ID,
    canonicalUrl: `https://www.walmart.com/ip/${ITEM_ID}`,
    availability: "in_stock",
    observedAt: new Date(NOW - 5_000).toISOString(),
    unitPriceCents: 8_497,
    currency: "USD",
    sellerName: "Walmart",
    sellerType: "first_party",
    fulfillment: "shipping",
    sourceTrustLevel: "trusted_exact",
    missionDecision: "qualified",
    effectiveUnitCapCents: 9_000,
    actionJobAction: "notify",
    actionJobState: "notify_only",
    actionJobExpiresAt: new Date(NOW + 60_000).toISOString(),
    actionJobMaxUnitPriceCents: 9_000,
    actionJobSellerPolicy: "first_party_only",
    actionJobFulfillment: "shipping",
    ...overrides
  };
}

test("a validated notify-only Walmart signal projects a direct review-order handoff", () => {
  assert.deepEqual(deriveWalmartPurchaseHandoff(signal(), NOW), {
    kind: "walmart_review_order",
    walmartItemId: ITEM_ID,
    destinationUrl: `https://www.walmart.com/affil/cart/reviewOrder?items=${ITEM_ID}&cn=nc&veh=aff`,
    directFallbackUrl: `https://www.walmart.com/affil/cart/reviewOrder?items=${ITEM_ID}&cn=nc&veh=aff`,
    pdpFallbackUrl: `https://www.walmart.com/ip/${ITEM_ID}`,
    trackingId: `walmart_${ITEM_ID}`,
    expiresAt: new Date(NOW + 60_000).toISOString()
  });
});

test("a valid Howl policy wraps the review-order destination and keeps deterministic fallbacks", () => {
  const handoff = deriveWalmartPurchaseHandoff(signal(), NOW, {
    publisherSlug: "collectwithdodo",
    articleName: "Walmart handoff fixture",
    articleUrl: "https://yoink.example/alerts/walmart-handoff-fixture"
  });
  assert.ok(handoff);
  const affiliate = new URL(handoff.destinationUrl);
  assert.equal(affiliate.origin, "https://howl.link");
  assert.equal(affiliate.pathname, "/link");
  assert.equal(affiliate.searchParams.get("url"), handoff.directFallbackUrl);
  assert.equal(affiliate.searchParams.get("u1"), `walmart_${ITEM_ID}`);
  assert.equal(handoff.pdpFallbackUrl, `https://www.walmart.com/ip/${ITEM_ID}`);
});

test("the handoff is absent when the guarded executor owns the cart mutation or evidence is incomplete", () => {
  assert.equal(deriveWalmartPurchaseHandoff(signal({
    actionJobAction: "add_to_cart",
    actionJobState: "awaiting_executor"
  }), NOW), null);
  assert.equal(deriveWalmartPurchaseHandoff(signal({ actionJobState: "confirmed" }), NOW), null);
  assert.equal(deriveWalmartPurchaseHandoff(signal({ sellerType: "unknown" }), NOW), null);
  assert.equal(deriveWalmartPurchaseHandoff(signal({ availability: "unknown" }), NOW), null);
  assert.equal(deriveWalmartPurchaseHandoff(signal({ missionDecision: "unmatched" }), NOW), null);
});

test("a cart handoff deterministically outranks a Walmart purchase-ready handoff on Home", () => {
  const summary = {
    contractVersion: 1 as const,
    generatedAt: new Date(NOW).toISOString(),
    counts: { queued: 0, checking: 0, readyToCheckout: 1, needsYou: 0 },
    primary: {
      id: "job_existing_cart",
      stage: "ready_to_checkout" as const,
      statusLabel: "Ready to check out",
      statusSummary: "The exact cart is ready.",
      title: "Existing cart",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      createdAt: new Date(NOW - 1_000).toISOString()
    }
  };
  const walmart = {
    jobId: "job_walmart_ready",
    createdAt: new Date(NOW).toISOString(),
    title: "Walmart ready",
    retailerId: "walmart" as const,
    retailerSku: ITEM_ID,
    canonicalUrl: `https://www.walmart.com/ip/${ITEM_ID}`,
    purchaseHandoff: deriveWalmartPurchaseHandoff(signal(), NOW)!
  };
  assert.equal(withWalmartPurchaseHandoff(summary, walmart), summary);
  const idle = { ...summary, counts: { ...summary.counts, readyToCheckout: 0 }, primary: null };
  const purchaseReady = withWalmartPurchaseHandoff(idle, walmart);
  assert.equal(purchaseReady.primary?.stage, "purchase_ready");
  assert.equal(purchaseReady.primary?.id, walmart.jobId);
});

test("stored signal rows expose the evidence needed for the Walmart handoff projection and click receipt", async () => {
  const db = new YoinkDatabase();
  enablePlansFromCalls(db);
  try {
    new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "walmart-handoff-product",
      sourceListingId: "walmart-handoff-listing",
      title: "Walmart handoff fixture",
      retailerId: "walmart",
      retailerSku: ITEM_ID,
      canonicalUrl: `https://www.walmart.com/ip/${ITEM_ID}`,
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 9_000,
      currency: "USD",
      observedAt: new Date(NOW - 60_000).toISOString()
    }, NOW);
    const strategy: StrategyDefinition = {
      id: "strategy_walmart_handoff_notify",
      name: "Walmart handoff notify",
      enabled: true,
      position: 1,
      revision: 1,
      sources: ["trackalacker"],
      retailers: ["walmart"],
      pricePolicy: { kind: "absolute_max", maxPriceCents: 9_000 },
      sellerPolicy: "first_party_only",
      allowedSellers: [],
      includeKeywords: "",
      excludeKeywords: "",
      action: "notify",
      quantity: 1,
      fulfillment: "shipping",
      maxSignalAgeSeconds: 120
    };
    new ControlRepository(db).replaceStrategies([strategy], NOW);
    const input: SignalEventInput = {
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      externalEventId: "walmart-handoff-event",
      eventType: "restock",
      observedAt: new Date(NOW - 1_000).toISOString(),
      identity: {
        sourceProductId: "walmart-handoff-product",
        sourceListingId: "walmart-handoff-listing",
        retailerId: "walmart",
        retailerSku: ITEM_ID,
        canonicalUrl: `https://www.walmart.com/ip/${ITEM_ID}`,
        title: "Walmart handoff fixture"
      },
      offer: {
        availability: "in_stock",
        unitPriceCents: 8_497,
        currency: "USD",
        sellerName: "Walmart",
        sellerType: "first_party",
        fulfillment: "shipping"
      }
    };
    const result = new SignalEngine(db).process(input, NOW);
    assert.equal(result.decision, "qualified");
    assert.equal(result.actionJobState, "notify_only");

    const stored = new SignalRepository(db).listSignals(1)[0];
    assert.ok(stored);
    assert.equal(stored.availability, "in_stock");
    assert.equal(stored.sellerName, "Walmart");
    assert.equal(stored.sellerType, "first_party");
    assert.equal(stored.fulfillment, "shipping");
    assert.equal(stored.sourceTrustLevel, "trusted_exact");
    assert.equal(stored.actionJobAction, "notify");
    assert.equal(stored.actionJobSellerPolicy, "first_party_only");
    assert.equal(stored.actionJobFulfillment, "shipping");
    assert.equal(deriveWalmartPurchaseHandoff(stored, NOW)?.walmartItemId, ITEM_ID);

    const interactions = new WalmartPurchaseHandoffInteractionRepository(db);
    assert.equal(interactions.current(result.actionJobId, NOW)?.walmartItemId, ITEM_ID);
    assert.equal(interactions.latest(NOW)?.jobId, result.actionJobId);
    const summaryServer = createYoinkServer({
      db,
      webRoot: join(process.cwd(), "apps", "web"),
      version: "walmart-home-handoff-test"
    });
    summaryServer.listen(0, "127.0.0.1");
    await once(summaryServer, "listening");
    try {
      const summaryAddress = summaryServer.address() as AddressInfo;
      const summaryResponse = await fetch(
        `http://127.0.0.1:${summaryAddress.port}/api/v1/user/action-handoff`
      );
      assert.equal(summaryResponse.status, 200);
      const summary = (await summaryResponse.json() as {
        actionHandoff: { primary: Record<string, unknown> | null };
      }).actionHandoff;
      assert.equal(summary.primary?.stage, "purchase_ready");
      assert.equal(summary.primary?.id, result.actionJobId);
      assert.equal(summary.primary?.retailerSku, ITEM_ID);
      assert.equal(
        (summary.primary?.purchaseHandoff as Record<string, unknown>)?.walmartItemId,
        ITEM_ID
      );
    } finally {
      await new Promise<void>((resolve) => summaryServer.close(() => resolve()));
    }
    const first = interactions.recordClick(result.actionJobId, "howl", NOW + 500);
    assert.deepEqual(first, {
      jobId: result.actionJobId,
      walmartItemId: ITEM_ID,
      routeKind: "howl",
      trackingId: `walmart_${ITEM_ID}`,
      surface: "calls",
      recorded: true,
      duplicate: false,
      recordedAt: new Date(NOW + 500).toISOString()
    });
    const replay = interactions.recordClick(result.actionJobId, "howl", NOW + 750);
    assert.equal(replay.recorded, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.recordedAt, first.recordedAt);
    assert.equal(interactions.current(result.actionJobId, NOW + 750), null);
    assert.equal(interactions.latest(NOW + 750), null);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'walmart_purchase_handoff_clicked'"
    )?.count, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'walmart_purchase_handoff_clicked'"
    )?.count, 1);

    const server = createYoinkServer({
      db,
      webRoot: join(process.cwd(), "apps", "web"),
      version: "walmart-purchase-click-test"
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const click = (body: Record<string, unknown>) => fetch(
      `${baseUrl}/api/v1/user/purchase-handoffs/${result.actionJobId}/click`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl },
        body: JSON.stringify(body)
      }
    );
    try {
      assert.equal((await click({ routeKind: "direct" })).status, 400);
      assert.equal((await click({
        routeKind: "pdp",
        confirmation: "OPEN_WALMART_PURCHASE_HANDOFF"
      })).status, 400);
      const accepted = await click({
        routeKind: "direct",
        confirmation: "OPEN_WALMART_PURCHASE_HANDOFF"
      });
      assert.equal(accepted.status, 202);
      assert.equal(accepted.headers.get("x-yoink-api-surface"), "user");
      const acceptedClick = (await accepted.json() as { click: Record<string, unknown> }).click;
      const acceptedRecordedAt = String(acceptedClick.recordedAt || "");
      assert.match(acceptedRecordedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual({ ...acceptedClick, recordedAt: "<iso>" }, {
        jobId: result.actionJobId,
        walmartItemId: ITEM_ID,
        routeKind: "howl",
        trackingId: `walmart_${ITEM_ID}`,
        surface: "calls",
        recorded: false,
        duplicate: true,
        recordedAt: "<iso>"
      });
      const duplicate = await click({
        routeKind: "direct",
        confirmation: "OPEN_WALMART_PURCHASE_HANDOFF"
      });
      assert.equal(duplicate.status, 202);
      assert.equal((await duplicate.json() as { click: { duplicate: boolean } }).click.duplicate, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const auditData = db.all<{ data_json: string }>(
      "SELECT data_json FROM audit_events WHERE event_type = 'walmart_purchase_handoff_clicked'"
    ).map((row) => JSON.parse(row.data_json) as Record<string, unknown>);
    assert.deepEqual(auditData.map((entry) => entry.routeKind), ["howl"]);
    assert.equal(JSON.stringify(auditData).includes("reviewOrder"), false);
    assert.equal(JSON.stringify(auditData).includes("clickid"), false);
    assert.equal(
      interactions.recordClick(result.actionJobId, "direct", NOW + 180_000).duplicate,
      true,
      "A retried click receipt remains idempotent after the original route expires."
    );
    assert.throws(
      () => interactions.recordClick("job_not_owned", "direct", NOW),
      /no longer current/
    );
  } finally {
    db.close();
  }
});
