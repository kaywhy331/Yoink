import type {
  SignalEventInput,
  SignalProcessingResult,
  SupportedRetailerId
} from "../../contracts/src/index.js";
import { AuthorizationRepository } from "../../database/src/authorization-repository.js";
import { CatalogRepository } from "../../database/src/catalog-repository.js";
import type { YoinkDatabase } from "../../database/src/database.js";
import {
  currentRequestScope,
  scopedSourceConnectionId
} from "../../database/src/request-scope.js";
import { exactRetailerProductLink } from "../../domain/src/attribution.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { SignalEngine } from "./signal-engine.js";

export interface AdminSignalSimulationInput {
  url?: unknown;
  price?: unknown;
}

export interface AdminSignalSimulationResult {
  dryRun: true;
  signalId: string;
  retailerId: string;
  retailerName: string;
  retailerSku: string;
  canonicalUrl: string;
  unitPriceCents: number;
  currency: "USD";
  catalog: {
    matched: boolean;
    listingId: string;
    title: string;
    executionSupported: boolean;
  };
  evaluation: {
    decision: "test_signal";
    reason: string;
    resolution: SignalProcessingResult["resolution"];
    resolutionMethod: string;
  };
  effects: {
    catalogCreated: false;
    missionCreated: false;
    incidentCreated: false;
    actionJobCreated: false;
    notificationCreated: false;
    spendReserved: false;
    retailerAction: false;
    cartChanged: false;
    sourceHealthChanged: false;
  };
}

export class AdminSignalSimulationError extends Error {
  constructor(
    readonly code:
      | "signal_simulation_url_invalid"
      | "signal_simulation_price_invalid"
      | "signal_simulator_unavailable"
      | "signal_simulation_safety_invariant_failed",
    readonly status: 400 | 409 | 500,
    message: string
  ) {
    super(message);
    this.name = "AdminSignalSimulationError";
  }
}

interface RetailerRow {
  id: string;
  displayName: string;
}

interface SourceHealthRow {
  status: string;
  lastEventAt: string;
  updatedAt: string;
}

interface SafetyCounts {
  listings: number;
  offerObservations: number;
  missions: number;
  incidents: number;
  jobs: number;
  notificationDeliveries: number;
  spendReservations: number;
}

/** Convert a user-entered USD amount without floating-point rounding. */
export function adminSimulationPriceCents(value: unknown): number {
  const raw = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new AdminSignalSimulationError(
      "signal_simulation_price_invalid",
      400,
      "Enter a positive price in dollars with no more than two decimal places."
    );
  }
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const total = dollars * 100 + cents;
  if (!Number.isSafeInteger(total) || total <= 0 || total > 100_000_000) {
    throw new AdminSignalSimulationError(
      "signal_simulation_price_invalid",
      400,
      "Enter a price from $0.01 through $1,000,000.00."
    );
  }
  return total;
}

function safetyCounts(db: YoinkDatabase): SafetyCounts {
  return db.get<SafetyCounts>(
    `SELECT
       (SELECT COUNT(*) FROM listings) AS listings,
       (SELECT COUNT(*) FROM offer_observations) AS offerObservations,
       (SELECT COUNT(*) FROM missions) AS missions,
       (SELECT COUNT(*) FROM signal_incidents) AS incidents,
       (SELECT COUNT(*) FROM action_jobs) AS jobs,
       (SELECT COUNT(*) FROM notification_deliveries) AS notificationDeliveries,
       (SELECT COUNT(*) FROM spend_reservations) AS spendReservations`
  ) as SafetyCounts;
}

function sameSafetyCounts(left: SafetyCounts, right: SafetyCounts): boolean {
  return Object.keys(left).every((key) => (
    left[key as keyof SafetyCounts] === right[key as keyof SafetyCounts]
  ));
}

/**
 * Runs the production signal normalizer and resolver while server-enforcing the
 * test-only boundary. Only the signal/evaluation ledger is allowed to change.
 */
export class AdminSignalSimulator {
  private readonly authorization: AuthorizationRepository;
  private readonly catalog: CatalogRepository;

  constructor(
    private readonly db: YoinkDatabase,
    private readonly engine = new SignalEngine(db)
  ) {
    this.authorization = new AuthorizationRepository(db);
    this.catalog = new CatalogRepository(db);
  }

  simulate(input: AdminSignalSimulationInput, now = Date.now()): AdminSignalSimulationResult {
    this.authorization.require("source.manage");
    const exact = exactRetailerProductLink(input?.url);
    if (!exact) {
      throw new AdminSignalSimulationError(
        "signal_simulation_url_invalid",
        400,
        "Paste a supported store product page with an exact item ID. Search, category, drawing-hub, sign-in, and credential-bearing links are not accepted."
      );
    }
    const unitPriceCents = adminSimulationPriceCents(input?.price);
    const retailer = this.db.get<RetailerRow>(
      `SELECT id, display_name AS displayName FROM retailers WHERE id = ?`,
      exact.retailerId
    );
    if (!retailer) {
      throw new AdminSignalSimulationError(
        "signal_simulation_url_invalid",
        400,
        "That store is not registered in Yoink's catalog."
      );
    }

    const sourceConnectionId = scopedSourceConnectionId("browser");
    const sourceHealth = this.db.get<SourceHealthRow>(
      `SELECT status, last_event_at AS lastEventAt, updated_at AS updatedAt
       FROM source_connections WHERE id = ? AND user_id = ?`,
      sourceConnectionId,
      currentRequestScope().userId
    );
    if (!sourceHealth) {
      throw new AdminSignalSimulationError(
        "signal_simulator_unavailable",
        409,
        "The private browser signal source is not provisioned for this account."
      );
    }

    const listing = this.catalog.exactRetailerListing(
      exact.retailerId as SupportedRetailerId,
      exact.retailerSku
    );
    const identityHash = stableHash(
      "yoink_admin_signal_simulation_v1",
      exact.retailerId,
      exact.retailerSku
    ).slice(0, 32);
    const timestamp = nowIso(now);
    const signal: SignalEventInput = {
      schemaVersion: 1,
      signalId: newId("admin_sim_signal"),
      sourceConnectionId,
      source: "browser",
      externalEventId: newId("admin_sim_event"),
      eventType: "in_stock",
      observedAt: timestamp,
      receivedAt: timestamp,
      test: true,
      identity: {
        sourceProductId: `admin_sim_product_${identityHash}`,
        sourceListingId: `admin_sim_listing_${identityHash}`,
        retailerId: exact.retailerId,
        retailerSku: exact.retailerSku,
        canonicalUrl: exact.canonicalUrl,
        title: listing?.title ?? `${retailer.displayName} product ${exact.retailerSku}`,
        globalIdentifiers: {
          retailer_item: `${exact.retailerId}:${exact.retailerSku}`
        }
      },
      offer: {
        availability: "in_stock",
        unitPriceCents,
        currency: "USD",
        sellerName: "",
        sellerType: "unknown",
        orderLimit: 1,
        fulfillment: "unknown"
      },
      evidence: {
        headline: "Admin dry-run signal",
        body: "Submitted through the private Yoink admin signal simulator."
      },
      parserVersion: "admin-simulator-v1"
    };

    return this.db.transaction(() => {
      const before = safetyCounts(this.db);
      const result = this.engine.process(signal, now);
      const after = safetyCounts(this.db);
      const dryRunHeld = result.accepted
        && result.decision === "test_signal"
        && result.missionCreated === false
        && result.missionId === ""
        && result.incidentId === ""
        && result.actionJobId === ""
        && sameSafetyCounts(before, after);
      if (!dryRunHeld) {
        throw new AdminSignalSimulationError(
          "signal_simulation_safety_invariant_failed",
          500,
          "The simulated signal did not remain inside the dry-run boundary. All simulation writes were rolled back."
        );
      }

      // The simulator is not a browser-extension heartbeat. Preserve the
      // source's real health while retaining the dry-run signal decision.
      this.db.run(
        `UPDATE source_connections
         SET status = ?, last_event_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        sourceHealth.status,
        sourceHealth.lastEventAt,
        sourceHealth.updatedAt,
        sourceConnectionId,
        currentRequestScope().userId
      );

      return {
        dryRun: true,
        signalId: result.signalId,
        retailerId: retailer.id,
        retailerName: retailer.displayName,
        retailerSku: exact.retailerSku,
        canonicalUrl: exact.canonicalUrl,
        unitPriceCents,
        currency: "USD",
        catalog: {
          matched: listing !== null,
          listingId: listing?.id ?? "",
          title: listing?.title ?? `${retailer.displayName} product ${exact.retailerSku}`,
          executionSupported: listing?.executionSupported ?? false
        },
        evaluation: {
          decision: "test_signal",
          reason: result.reason,
          resolution: result.resolution,
          resolutionMethod: result.resolutionMethod
        },
        effects: {
          catalogCreated: false,
          missionCreated: false,
          incidentCreated: false,
          actionJobCreated: false,
          notificationCreated: false,
          spendReserved: false,
          retailerAction: false,
          cartChanged: false,
          sourceHealthChanged: false
        }
      };
    });
  }
}
