import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { AMAZON_OBSERVER_VERSION, type RetailerAdapterDiagnosticInput } from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

function diagnostic(outcome: "failed" | "passed" = "failed"): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date().toISOString(),
    retailerId: "amazon",
    retailerSku: "B0FB21526X",
    adapterVersion: AMAZON_OBSERVER_VERSION,
    operation: "observe",
    outcome,
    failureStage: outcome === "passed" ? "complete" : "offer_binding",
    reasonCode: outcome === "passed" ? "verified" : "offer_binding_ambiguous",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "accordion",
      sellerShape: "legacy",
      fulfillmentShape: "shipping",
      addControlCount: 1,
      genericAddIntentCount: 1,
      scopedControlCount: outcome === "passed" ? 1 : 0,
      explicitSkuInputCount: 2,
      exactSkuInputCount: 2,
      variationSkuCount: 0,
      canonicalOfferInputCount: 2,
      canonicalOfferDistinctCount: 1,
      alternateOfferInputCount: 1,
      alternateOfferDistinctCount: 1,
      priceCandidateCount: 1,
      quantityControlCount: 0,
      securityChallenge: false,
      interactiveBlock: ""
    }
  };
}

function runtimeDiagnostic(): RetailerAdapterDiagnosticInput {
  const counts = {
    addControlCount: 0,
    genericAddIntentCount: 0,
    scopedControlCount: 0,
    explicitSkuInputCount: 0,
    exactSkuInputCount: 0,
    variationSkuCount: 0,
    canonicalOfferInputCount: 0,
    canonicalOfferDistinctCount: 0,
    alternateOfferInputCount: 0,
    alternateOfferDistinctCount: 0,
    priceCandidateCount: 0,
    quantityControlCount: 0
  };
  return {
    ...diagnostic(),
    failureStage: "runner",
    reasonCode: "observer_bundle_injection_failed",
    layout: {
      schemaVersion: 1,
      pageKind: "product",
      scopeKind: "none",
      sellerShape: "none",
      fulfillmentShape: "none",
      ...counts,
      securityChallenge: false,
      interactiveBlock: ""
    }
  };
}

test("the authenticated diagnostic endpoint immediately feeds the sanitized repair queue", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"d".repeat(32)}`;
  try {
    const pairing = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    }).then((response) => response.json()) as { pairing: { code: string } };
    const paired = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ pairingCode: pairing.pairing.code })
    }).then((response) => response.json()) as { device: { token: string } };
    const headers = {
      "Content-Type": "application/json",
      Origin: extensionOrigin,
      Authorization: `Bearer ${paired.device.token}`
    };
    const failedPayload = { ...diagnostic(), rawDom: "DO_NOT_STORE", offerListingID: "DO_NOT_STORE" };
    const failedResponse = await fetch(`${baseUrl}/api/v1/devices/self/adapter-diagnostics/amazon`, {
      method: "POST",
      headers,
      body: JSON.stringify(failedPayload)
    });
    assert.equal(failedResponse.status, 201);
    const failed = await failedResponse.json() as { diagnostic: Record<string, unknown> };
    assert.match(String(failed.diagnostic.layoutFingerprint), /^[a-f0-9]{64}$/);
    assert.equal("rawDom" in failed.diagnostic, false);
    const retriedResponse = await fetch(`${baseUrl}/api/v1/devices/self/adapter-diagnostics/amazon`, {
      method: "POST",
      headers,
      body: JSON.stringify(failedPayload)
    });
    assert.equal(retriedResponse.status, 201);
    const retried = await retriedResponse.json() as { diagnostic: Record<string, unknown> };
    assert.equal(retried.diagnostic.id, failed.diagnostic.id);

    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      adapterRepairQueue: Array<{ status: string; reasonCode: string }>;
      capabilities: Record<string, boolean>;
    };
    assert.equal(snapshot.counts.adapterDiagnosticEvents, 1);
    assert.equal(snapshot.counts.openAdapterRepairGroups, 1);
    assert.equal(snapshot.adapterRepairQueue[0]?.status, "open");
    assert.equal(snapshot.adapterRepairQueue[0]?.reasonCode, "offer_binding_ambiguous");
    assert.equal(snapshot.capabilities.sanitizedAdapterDiagnostics, true);
    assert.equal(snapshot.capabilities.durableAdapterDiagnosticDelivery, true);
    assert.equal(JSON.stringify(snapshot).includes("DO_NOT_STORE"), false);

    const foreign = await fetch(`${baseUrl}/api/v1/devices/self/adapter-diagnostics/amazon`, {
      method: "POST",
      headers: { ...headers, Origin: "https://attacker.example" },
      body: JSON.stringify(diagnostic())
    });
    assert.equal(foreign.status, 403);

    const passedResponse = await fetch(`${baseUrl}/api/v1/devices/self/adapter-diagnostics/amazon`, {
      method: "POST",
      headers,
      body: JSON.stringify(diagnostic("passed"))
    });
    assert.equal(passedResponse.status, 201);
    const repaired = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      adapterRepairQueue: Array<{ status: string }>;
    };
    assert.equal(repaired.counts.openAdapterRepairGroups, 0);
    assert.equal(repaired.adapterRepairQueue[0]?.status, "recovered");
    // Parser-derived scope readiness is excluded from the fingerprint, so a
    // later success closes repair work for the same raw page structure.
    assert.equal(JSON.stringify(db.all("SELECT * FROM retailer_adapter_diagnostics")).includes("DO_NOT_STORE"), false);

    const runtimeFailureResponse = await fetch(`${baseUrl}/api/v1/devices/self/adapter-diagnostics/amazon`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...runtimeDiagnostic(),
        browserError: `DO_NOT_STORE token=${paired.device.token}`,
        canonicalUrl: "https://www.amazon.com/dp/B0FB21526X?secret=DO_NOT_STORE"
      })
    });
    assert.equal(runtimeFailureResponse.status, 201);
    const runtimeSnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      adapterRepairQueue: Array<{ status: string; reasonCode: string; failureStage: string; layout: Record<string, unknown> }>;
    };
    const runtimeRepair = runtimeSnapshot.adapterRepairQueue.find((item) => item.reasonCode === "observer_bundle_injection_failed");
    assert.equal(runtimeSnapshot.counts.adapterDiagnosticEvents, 3);
    assert.equal(runtimeSnapshot.counts.openAdapterRepairGroups, 1);
    assert.equal(runtimeRepair?.status, "open");
    assert.equal(runtimeRepair?.failureStage, "runner");
    assert.equal(runtimeRepair?.layout.addControlCount, 0);
    assert.equal(JSON.stringify(runtimeSnapshot).includes("DO_NOT_STORE"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM retailer_adapter_diagnostics")).includes(paired.device.token), false);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
