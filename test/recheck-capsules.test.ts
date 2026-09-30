import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error jsdom intentionally ships without bundled TypeScript declarations here.
import { JSDOM } from "jsdom";
import { captureEvidenceCapsule } from "../apps/extension/src/evidence-capsule.js";
import {
  TARGET_OBSERVER_VERSION,
  TARGET_SELECTOR_PACK_VERSION,
  BESTBUY_OBSERVER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  BESTBUY_SELECTOR_PACK_VERSION,
  type RetailerAdapterDiagnosticInput,
  type RetailerAdapterLayoutEvidence
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { EvidenceCapsuleStore } from "../packages/database/src/evidence-capsule-store.js";
import { OperatorAlertRepository } from "../packages/database/src/operator-alert-repository.js";
// @ts-expect-error The release recheck is intentionally an importable JavaScript command module.
import { recheckCapsules } from "../scripts/recheck-capsules.mjs";

const SKU = "1011483414";
const URL = `https://www.target.com/p/fixture/A-${SKU}`;

function layout(scopeKind: "none" | "buybox" = "none"): RetailerAdapterLayoutEvidence {
  return {
    schemaVersion: 1, pageKind: "product", scopeKind, sellerShape: "legacy", fulfillmentShape: "shipping",
    addControlCount: 0, genericAddIntentCount: 1, scopedControlCount: 0, explicitSkuInputCount: 0,
    exactSkuInputCount: 0, variationSkuCount: 0, canonicalOfferInputCount: 0, canonicalOfferDistinctCount: 0,
    alternateOfferInputCount: 0, alternateOfferDistinctCount: 0, priceCandidateCount: 1,
    quantityControlCount: 0, securityChallenge: false, interactiveBlock: ""
  };
}

function failed(observedAt: number, sku = SKU, scopeKind: "none" | "buybox" = "none"): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    retailerId: "target",
    retailerSku: sku,
    adapterVersion: TARGET_OBSERVER_VERSION,
    packVersion: TARGET_SELECTOR_PACK_VERSION,
    operation: "observe",
    outcome: "failed",
    failureStage: "add_control",
    reasonCode: "add_control_selector_miss",
    attemptCount: 1,
    domChanged: false,
    layout: layout(scopeKind)
  };
}

async function savePassingReplayCapsule(
  dataDirectory: string,
  diagnostic: RetailerAdapterDiagnosticInput,
  id: string,
  now: number
): Promise<void> {
  const dom = new JSDOM(readFileSync(join(process.cwd(), "test", "fixtures", "target", "product-first-party.html"), "utf8"), { url: URL });
  const capsule = await captureEvidenceCapsule({
    id,
    document: dom.window.document,
    url: URL,
    retailerId: "target",
    retailerSku: diagnostic.retailerSku,
    diagnostic,
    trigger: "diagnostic_failed",
    observerVersion: TARGET_OBSERVER_VERSION,
    addAdapterVersion: "target-add-v12",
    packVersion: TARGET_SELECTOR_PACK_VERSION,
    extensionVersion: "1.20.0",
    capturedAt: new Date(now).toISOString(),
    environment: { isVisible: () => true }
  });
  new EvidenceCapsuleStore(dataDirectory).accept(capsule, new Date(now + 50).toISOString());
}

test("Best Buy reservation replay reports a manual step without claiming a repaired or authorized offer", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "yoink-recheck-reservation-"));
  const databasePath = join(dataDirectory, "yoink.sqlite");
  const base = Date.now();
  let db: YoinkDatabase | undefined;
  try {
    db = new YoinkDatabase(databasePath);
    const devices = new DeviceRepository(db);
    const pairing = devices.createPairingCode(base - 2_000);
    const device = devices.pair({ pairingCode: pairing.code }, base - 1_000);
    const diagnostic: RetailerAdapterDiagnosticInput = { ...failed(base), retailerId: "bestbuy", retailerSku: "6669869",
      adapterVersion: BESTBUY_OBSERVER_VERSION, packVersion: BESTBUY_SELECTOR_PACK_VERSION,
      failureStage: "fulfillment_binding", reasonCode: "fulfillment_binding_missing" };
    new AdapterDiagnosticRepository(db).record(device.id, diagnostic, base + 100);
    const url = "https://www.bestbuy.com/site/reservation-product/6669869.p";
    const dom = new JSDOM(readFileSync(join(process.cwd(), "test/fixtures/retailers/bestbuy-high-velocity-reservation.html"), "utf8"), { url });
    const capsule = await captureEvidenceCapsule({
      id: "cap_RECHECKRESERVATION0000000001", document: dom.window.document, url,
      retailerId: "bestbuy", retailerSku: "6669869", diagnostic, trigger: "diagnostic_failed",
      observerVersion: BESTBUY_OBSERVER_VERSION, addAdapterVersion: BESTBUY_ADD_ADAPTER_VERSION,
      packVersion: BESTBUY_SELECTOR_PACK_VERSION, extensionVersion: "1.22.7",
      capturedAt: new Date(base + 250).toISOString(), environment: { isVisible: () => true }
    });
    new EvidenceCapsuleStore(dataDirectory).accept(capsule, new Date(base + 300).toISOString());
    dom.window.close();
    db.close(); db = undefined;
    const result = await recheckCapsules({ dataDirectory, databasePath });
    assert.equal(result.checked, 1);
    assert.equal(result.manualActionRequired, 1);
    assert.equal(result.stillFailing, 0);
    assert.equal(result.errors, 0);
    assert.equal(result.fixedPendingLive, 0);
    assert.equal(result.results[0].reasonCode, "interactive_high_demand");
    db = new YoinkDatabase(databasePath, { migrationMode: "require_current" });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM operator_alert_incidents WHERE status IN ('fixed_pending_live', 'resolved')")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")?.count, 0);
  } finally { db?.close(); rmSync(dataDirectory, { recursive: true, force: true }); }
});

test("release replay moves repairs through fixed pending live to resolution or regression", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "yoink-recheck-capsules-"));
  const databasePath = join(dataDirectory, "yoink.sqlite");
  const base = Date.now();
  try {
    let db = new YoinkDatabase(databasePath);
    const devices = new DeviceRepository(db);
    const pairing = devices.createPairingCode(base - 2_000);
    const device = devices.pair({ pairingCode: pairing.code }, base - 1_000);
    let diagnostics = new AdapterDiagnosticRepository(db);
    let alerts = new OperatorAlertRepository(db);
    const firstFailure = failed(base);
    diagnostics.record(device.id, firstFailure, base + 100);
    alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "open_first", base + 200);
    await savePassingReplayCapsule(dataDirectory, firstFailure, "cap_RECHECKFIXED0000000000000001", base + 250);
    db.close();

    const firstRecheck = await recheckCapsules({ dataDirectory, databasePath, json: false });
    assert.equal(firstRecheck.fixedPendingLive, 1);
    db = new YoinkDatabase(databasePath, { migrationMode: "require_current" });
    let firstIncident = db.get<{ status: string; summary: string }>(
      "SELECT status, summary FROM operator_alert_incidents ORDER BY created_at LIMIT 1"
    );
    assert.equal(firstIncident?.status, "fixed_pending_live");
    assert.match(firstIncident?.summary ?? "", /waiting for a live check/i);
    const audit = db.get<{ dataJson: string }>(
      "SELECT data_json AS dataJson FROM audit_events WHERE event_type = 'adapter_repair_recheck'"
    );
    assert.match(audit?.dataJson ?? "", /cap_RECHECKFIXED/);
    assert.doesNotMatch(audit?.dataJson ?? "", /<html|trace/i);

    diagnostics = new AdapterDiagnosticRepository(db);
    alerts = new OperatorAlertRepository(db);
    diagnostics.record(device.id, {
      ...firstFailure,
      observedAt: new Date(base + 10_000).toISOString(),
      outcome: "passed",
      failureStage: "complete",
      reasonCode: "verified"
    }, base + 10_100);
    assert.equal(alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "live_pass", base + 10_200).resolved, 1);
    firstIncident = db.get("SELECT status, summary FROM operator_alert_incidents ORDER BY created_at LIMIT 1");
    assert.equal(firstIncident?.status, "resolved");
    assert.equal(db.get<{ resolutionCode: string }>(
      "SELECT resolution_code AS resolutionCode FROM operator_alert_incidents ORDER BY created_at LIMIT 1"
    )?.resolutionCode, "adapter_fixed_by_replay");

    const secondFailure = failed(base + 20_000, "1011483415", "buybox");
    diagnostics.record(device.id, secondFailure, base + 20_100);
    alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "open_second", base + 20_200);
    await savePassingReplayCapsule(dataDirectory, secondFailure, "cap_RECHECKREGRESSION000000000001", base + 20_250);
    db.close();
    const secondRecheck = await recheckCapsules({ dataDirectory, databasePath, json: false });
    assert.equal(secondRecheck.fixedPendingLive, 1);

    db = new YoinkDatabase(databasePath, { migrationMode: "require_current" });
    diagnostics = new AdapterDiagnosticRepository(db);
    alerts = new OperatorAlertRepository(db);
    diagnostics.record(device.id, {
      ...secondFailure,
      observedAt: new Date(base + 30_000).toISOString()
    }, base + 30_100);
    assert.equal(alerts.reconcileAdapterRepairs(diagnostics.listRepairQueue(), "live_regression", base + 30_200).updated, 1);
    const regressed = db.get<{ status: string; reasonCode: string; summary: string }>(
      `SELECT status, reason_code AS reasonCode, summary FROM operator_alert_incidents
       WHERE layout_fingerprint <> (SELECT layout_fingerprint FROM operator_alert_incidents ORDER BY created_at LIMIT 1)`
    );
    assert.equal(regressed?.status, "open");
    assert.equal(regressed?.reasonCode, "regressed_after_replay_fix");
    assert.match(regressed?.summary ?? "", /regressed after the packaged replay fix/i);
    db.close();
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});
