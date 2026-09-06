import { SignalEngine } from "../../packages/engine/src/signal-engine.js";
import { SignalRepository } from "../../packages/database/src/signal-repository.js";
import { SpendLedgerRepository } from "../../packages/database/src/spend-ledger-repository.js";
import { TARGET_ADD_ADAPTER_VERSION } from "../../packages/contracts/src/index.js";
import { DeviceRepository } from "../../packages/database/src/device-repository.js";
import { UserActionConnectorRepository } from "../../packages/database/src/user-action-connector-repository.js";
import { join } from "node:path";
import { createYoinkServer } from "../../apps/api/src/app.js";
import { CatalogRepository } from "../../packages/database/src/catalog-repository.js";
import { CatalogLinkRepository } from "../../packages/database/src/catalog-link-repository.js";
import { ControlRepository } from "../../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../../packages/database/src/database.js";

const db = new YoinkDatabase();
const catalog = new CatalogRepository(db);
const control = new ControlRepository(db);
db.transaction(() => {
  for (let index = 0; index < 206; index += 1) {
    const sku = String(97000000 + index);
    const listing = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
      sourceProductId: `browser-${index}`, sourceListingId: `browser-listing-${index}`,
      title: `Browser product ${String(index).padStart(3, "0")}`, retailerId: "target",
      retailerSku: sku, canonicalUrl: `https://www.target.com/p/-/A-${sku}`,
      listingStatus: "in_stock", executionSupported: true, observedPriceCents: 1999, msrpCents: index % 2 === 0 ? 2499 : null, currency: "USD"
    }).listing;
    const mission = control.ensureUserMission(listing.variantId, listing.id);
    if (index === 203) {
      const detail = control.missionDetail(mission.mission.id) as { targets: Array<{ id: string }> };
      control.updateMission(mission.mission.id, {
        status: "active", targetQuantity: 1,
        targets: detail.targets.map(target => ({ id: target.id, enabled: true, maxUnitPriceCents: 2500, sellerPolicy: "first_party_only", fulfillment: "shipping" })),
        policy: { actionCeiling: "add_to_cart", decisionMode: "purchase_intent", maxAllInCents: 6000 }
      });
    }
    if (index === 205) db.run("UPDATE missions SET status = 'paused' WHERE id = ?", mission.mission.id);
  }
});
// A real reported Add on an existing fixture plan, without changing store setup readiness.
{
  const now = Date.now();
  const listing = db.get<{ id: string }>("SELECT id FROM listings WHERE retailer_sku = '97000204'")!;
  const settings = db.get<any>("SELECT * FROM app_settings");
  control.replaceStrategies([]);
  const mission = db.get<{ id: string }>("SELECT mission_id AS id FROM mission_targets WHERE listing_id = ?", listing.id)!;
  const detail = control.missionDetail(mission.id) as { targets: Array<{ id: string }> };
  control.updateMission(mission.id, { status: "active", targetQuantity: 2,
    targets: detail.targets.map(target => ({ id: target.id, enabled: true, maxUnitPriceCents: 2500, sellerPolicy: "first_party_only", fulfillment: "shipping" })),
    policy: { actionCeiling: "add_to_cart", decisionMode: "purchase_intent", maxAllInCents: 10000 } });
  db.run(`INSERT INTO retailer_adapter_qualifications(tenant_id, user_id, retailer_id, adapter_version, highest_action, status, evidence_hash, qualified_at, updated_at)
    VALUES ('tenant_local', 'user_local', 'target', ?, 'add_to_cart', 'qualified', 'browser-report-fixture', ?, ?)`, TARGET_ADD_ADAPTER_VERSION, new Date(now).toISOString(), new Date(now).toISOString());
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");
  const created = new SignalEngine(db).process({ sourceConnectionId: "source_trackalacker_local", source: "trackalacker", externalEventId: "browser-report",
    eventType: "restock", observedAt: new Date(now).toISOString(), identity: { sourceProductId: "browser-204", sourceListingId: "browser-listing-204",
      retailerId: "target", retailerSku: "97000204", canonicalUrl: "https://www.target.com/p/-/A-97000204", title: "Browser product 204" },
    offer: { availability: "in_stock", unitPriceCents: 1999, currency: "USD", sellerName: "Target", sellerType: "first_party", orderLimit: 2, fulfillment: "shipping" },
    evidence: { headline: "Browser report fixture" }, parserVersion: "browser-test" }, now);
  if (!created.actionJobId) throw new Error("Browser checkout report fixture did not create an Add.");
  db.run("UPDATE action_jobs SET state = 'confirmed' WHERE id = ?", created.actionJobId);
  new SpendLedgerRepository(db).releaseForJob(created.actionJobId, "add_to_cart_confirmed_without_order", now);
  new SignalRepository(db).reportCartOutcome(created.actionJobId, "got_it", "I_REVIEWED_CHECKOUT_RESULT", 2000, "Original browser report", now);
  db.run("DELETE FROM retailer_adapter_qualifications WHERE evidence_hash = 'browser-report-fixture'");
  db.run("UPDATE app_settings SET execution_mode = ?, actions_paused = ?", settings.execution_mode, settings.actions_paused);
}
const catalogLinks = new CatalogLinkRepository(db);
for (let index = 0; index < 61; index++) {
  const { proposal } = catalogLinks.propose({ url: `https://www.target.com/p/-/A-${98700000 + index}`, title: `Review fixture ${String(index).padStart(3, "0")}`, confirmation: "PROPOSE_EXACT_PRODUCT_LINK" }, Date.now() - 10000 + index);
  db.run("UPDATE catalog_change_proposals SET status = 'rejected', review_note = 'Please correct the product name', decided_at = ? WHERE id = ?", new Date().toISOString(), proposal.id);
}
const devices = new DeviceRepository(db);
devices.pair({ pairingCode: devices.createPairingCode().code, name: "Browser acceptance laptop", extensionVersion: "test" });
const bindings = { browser_delivery: "c".repeat(64) };
const connectors = new UserActionConnectorRepository(db, bindings);
const destination = connectors.save({ contractVersion: 1, kind: "webhook", name: "Browser acceptance updates", endpointReference: "browser_delivery", events: ["test"] });
for (let index = 0; index < 55; index++) connectors.queueTest(destination.id, Date.now() - 10000 + index);
const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "browser-test", userActionConnectorBindings: bindings });
server.listen(33993, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
