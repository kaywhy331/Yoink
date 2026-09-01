import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import {
  AdminSignalSimulationError,
  adminSimulationPriceCents
} from "../packages/engine/src/admin-signal-simulator.js";

interface HighRiskCounts {
  listings: number;
  offerObservations: number;
  missions: number;
  incidents: number;
  jobs: number;
  notifications: number;
  spendReservations: number;
}

function highRiskCounts(db: YoinkDatabase): HighRiskCounts {
  return db.get<HighRiskCounts>(
    `SELECT
       (SELECT COUNT(*) FROM listings) AS listings,
       (SELECT COUNT(*) FROM offer_observations) AS offerObservations,
       (SELECT COUNT(*) FROM missions) AS missions,
       (SELECT COUNT(*) FROM signal_incidents) AS incidents,
       (SELECT COUNT(*) FROM action_jobs) AS jobs,
       (SELECT COUNT(*) FROM notification_deliveries) AS notifications,
       (SELECT COUNT(*) FROM spend_reservations) AS spendReservations`
  ) as HighRiskCounts;
}

test("admin signal simulation prices are converted exactly and reject ambiguous formats", () => {
  assert.equal(adminSimulationPriceCents("0.01"), 1);
  assert.equal(adminSimulationPriceCents("44.9"), 4490);
  assert.equal(adminSimulationPriceCents(44.99), 4499);
  assert.equal(adminSimulationPriceCents("1000000.00"), 100_000_000);
  for (const invalid of ["", "0", "44.999", "1e3", "$4.50", "1,000.00", "1000000.01", -1]) {
    assert.throws(
      () => adminSimulationPriceCents(invalid),
      (error) => error instanceof AdminSignalSimulationError
        && error.code === "signal_simulation_price_invalid"
    );
  }
});

test("the admin URL and price simulator records only a dry-run signal decision", async () => {
  const db = new YoinkDatabase();
  const known = new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "admin-simulation-known-product",
    sourceListingId: "admin-simulation-known-listing",
    title: "Signal Simulator Target Fixture",
    retailerId: "target",
    retailerSku: "95280894",
    canonicalUrl: "https://www.target.com/p/-/A-95280894",
    listingStatus: "in_stock",
    executionSupported: true,
    msrpCents: 4499,
    currency: "USD"
  });
  const sourceBefore = db.get<Record<string, unknown>>(
    `SELECT status, last_event_at AS lastEventAt, updated_at AS updatedAt
     FROM source_connections WHERE id = 'source_browser_local'`
  );
  const riskBefore = highRiskCounts(db);
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "admin-signal-simulator-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const simulate = (body: Record<string, unknown>) => fetch(`${baseUrl}/api/v1/admin/signals/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(body)
  });

  try {
    const matchedResponse = await simulate({
      url: "https://www.target.com/p/example/-/A-95280894?preselect=95280894#lnk=sametab",
      price: "44.99"
    });
    assert.equal(matchedResponse.status, 200);
    assert.equal(matchedResponse.headers.get("x-yoink-api-surface"), "admin");
    assert.equal(matchedResponse.headers.has("deprecation"), false);
    const matched = await matchedResponse.json() as {
      simulation: {
        dryRun: boolean;
        signalId: string;
        retailerId: string;
        retailerName: string;
        retailerSku: string;
        canonicalUrl: string;
        unitPriceCents: number;
        currency: string;
        catalog: { matched: boolean; listingId: string; title: string; executionSupported: boolean };
        evaluation: { decision: string; resolution: string; resolutionMethod: string };
        effects: Record<string, boolean>;
      };
    };
    assert.equal(matched.simulation.dryRun, true);
    assert.match(matched.simulation.signalId, /^admin_sim_signal_[a-f0-9]{32}$/);
    assert.equal(matched.simulation.retailerId, "target");
    assert.equal(matched.simulation.retailerName, "Target");
    assert.equal(matched.simulation.retailerSku, "95280894");
    assert.equal(matched.simulation.canonicalUrl, "https://www.target.com/p/-/A-95280894");
    assert.equal(matched.simulation.unitPriceCents, 4499);
    assert.equal(matched.simulation.currency, "USD");
    assert.deepEqual(matched.simulation.catalog, {
      matched: true,
      listingId: known.listing.id,
      title: "Signal Simulator Target Fixture",
      executionSupported: true
    });
    assert.deepEqual(matched.simulation.evaluation, {
      decision: "test_signal",
      reason: "Connectivity test received and resolved; test signals are always dry-run only.",
      resolution: "matched",
      resolutionMethod: "retailer_sku"
    });
    assert.deepEqual(matched.simulation.effects, {
      catalogCreated: false,
      missionCreated: false,
      incidentCreated: false,
      actionJobCreated: false,
      notificationCreated: false,
      spendReserved: false,
      retailerAction: false,
      cartChanged: false,
      sourceHealthChanged: false
    });
    assert.deepEqual(highRiskCounts(db), riskBefore);
    assert.deepEqual(db.get<Record<string, unknown>>(
      `SELECT status, last_event_at AS lastEventAt, updated_at AS updatedAt
       FROM source_connections WHERE id = 'source_browser_local'`
    ), sourceBefore);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM signal_events WHERE test = 1 AND parser_version = 'admin-simulator-v1'"
    )?.count, 1);
    assert.equal(db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM mission_decisions decision
       JOIN signal_events event ON event.id = decision.event_id
       WHERE event.test = 1 AND decision.outcome = 'test_signal'`
    )?.count, 1);

    const unresolvedResponse = await simulate({
      url: "https://www.walmart.com/ip/Unknown-Product/20252562938?athbdg=L1102&from=/search",
      price: "84.9"
    });
    assert.equal(unresolvedResponse.status, 200);
    const unresolved = await unresolvedResponse.json() as {
      simulation: {
        retailerId: string;
        retailerSku: string;
        unitPriceCents: number;
        catalog: { matched: boolean; listingId: string };
        evaluation: { decision: string; resolution: string };
      };
    };
    assert.equal(unresolved.simulation.retailerId, "walmart");
    assert.equal(unresolved.simulation.retailerSku, "20252562938");
    assert.equal(unresolved.simulation.unitPriceCents, 8490);
    assert.deepEqual(unresolved.simulation.catalog, { matched: false, listingId: "", title: "Walmart product 20252562938", executionSupported: false });
    assert.equal(unresolved.simulation.evaluation.decision, "test_signal");
    assert.equal(unresolved.simulation.evaluation.resolution, "unresolved");
    assert.deepEqual(highRiskCounts(db), riskBefore);

    const signalCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count;
    const badUrl = await simulate({ url: "https://www.walmart.com/shop/collectibles/draw", price: "84.90" });
    assert.equal(badUrl.status, 400);
    assert.equal((await badUrl.json() as { error: string }).error, "signal_simulation_url_invalid");
    const badPrice = await simulate({ url: "https://www.target.com/p/-/A-95280894", price: "44.999" });
    assert.equal(badPrice.status, 400);
    assert.equal((await badPrice.json() as { error: string }).error, "signal_simulation_price_invalid");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM signal_events")?.count, signalCount);
    assert.deepEqual(highRiskCounts(db), riskBefore);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
