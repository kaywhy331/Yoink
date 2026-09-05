import { DeviceRepository } from "../../packages/database/src/device-repository.js";
import { UserActionConnectorRepository } from "../../packages/database/src/user-action-connector-repository.js";
import { join } from "node:path";
import { createYoinkServer } from "../../apps/api/src/app.js";
import { CatalogRepository } from "../../packages/database/src/catalog-repository.js";
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
      listingStatus: "in_stock", executionSupported: true, observedPriceCents: 1999, currency: "USD"
    }).listing;
    const mission = control.ensureUserMission(listing.variantId, listing.id);
    if (index === 205) db.run("UPDATE missions SET status = 'paused' WHERE id = ?", mission.mission.id);
  }
});
const devices = new DeviceRepository(db);
devices.pair({ pairingCode: devices.createPairingCode().code, name: "Browser acceptance laptop", extensionVersion: "test" });
const bindings = { browser_delivery: "c".repeat(64) };
const connectors = new UserActionConnectorRepository(db, bindings);
const destination = connectors.save({ contractVersion: 1, kind: "webhook", name: "Browser acceptance updates", endpointReference: "browser_delivery", events: ["test"] });
for (let index = 0; index < 55; index++) connectors.queueTest(destination.id, Date.now() - 10000 + index);
const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "browser-test", userActionConnectorBindings: bindings });
server.listen(33993, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
