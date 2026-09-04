import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error jsdom intentionally ships without bundled TypeScript declarations here.
import { JSDOM } from "jsdom";
import { createYoinkServer } from "../apps/api/src/app.js";
import { captureEvidenceCapsule } from "../apps/extension/src/evidence-capsule.js";
import { EvidenceCapsuleStore } from "../packages/database/src/evidence-capsule-store.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import type { EvidenceCapsuleEnvelope, RetailerAdapterDiagnosticInput } from "../packages/contracts/src/index.js";

function diagnostic(): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: "2026-09-05T18:54:10.000Z",
    retailerId: "walmart",
    retailerSku: "20895014480",
    adapterVersion: "walmart-observer-v7",
    operation: "observe",
    outcome: "failed",
    failureStage: "price_binding",
    reasonCode: "price_binding_missing",
    attemptCount: 1,
    domChanged: false,
    layout: {
      schemaVersion: 1, pageKind: "product", scopeKind: "none", sellerShape: "none", fulfillmentShape: "none",
      addControlCount: 0, scopedControlCount: 0, explicitSkuInputCount: 0, exactSkuInputCount: 0,
      variationSkuCount: 0, canonicalOfferInputCount: 0, canonicalOfferDistinctCount: 0,
      alternateOfferInputCount: 0, alternateOfferDistinctCount: 0, priceCandidateCount: 0,
      quantityControlCount: 0, securityChallenge: false, interactiveBlock: ""
    }
  };
}

async function capsule(id = "cap_01J9TESTCAPSULE000000000000"): Promise<EvidenceCapsuleEnvelope> {
  const dom = new JSDOM("<!doctype html><html><body><button>Add</button></body></html>", {
    url: "https://www.walmart.com/ip/20895014480"
  });
  return captureEvidenceCapsule({
    id,
    document: dom.window.document,
    url: dom.window.location.href,
    retailerId: "walmart",
    retailerSku: "20895014480",
    diagnostic: diagnostic(),
    trigger: "diagnostic_failed",
    observerVersion: "walmart-observer-v7",
    addAdapterVersion: "walmart-add-v8",
    extensionVersion: "1.20.0",
    environment: { isVisible: () => true }
  });
}

test("the filesystem store deduplicates, retains fifty per store, and prunes expiry without SQL", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "yoink-evidence-store-"));
  try {
    const store = new EvidenceCapsuleStore(dataDirectory);
    const first = await capsule();
    store.accept(first, "2026-09-05T19:00:00.000Z");
    assert.throws(() => store.accept(first, "2026-09-05T19:05:00.000Z"), /already saved/);
    for (let index = 1; index <= 50; index += 1) {
      const item = await capsule(`cap_01J9TESTCAPSULE${String(index).padStart(12, "0")}`);
      item.snapshot.sha256 = item.snapshot.sha256.replace(/^./, index % 16 === 0 ? "f" : (index % 16).toString(16));
      // Change the compressed page and recompute its digest through a fresh capture instead of trusting a forged hash.
      const uniqueDom = new JSDOM(`<!doctype html><html><body><button>Add ${index}</button></body></html>`, {
        url: "https://www.walmart.com/ip/20895014480"
      });
      const unique = await captureEvidenceCapsule({
        id: item.id,
        document: uniqueDom.window.document,
        url: uniqueDom.window.location.href,
        retailerId: "walmart",
        retailerSku: "20895014480",
        diagnostic: diagnostic(), trigger: "diagnostic_failed", observerVersion: "walmart-observer-v7",
        addAdapterVersion: "walmart-add-v8", extensionVersion: "1.20.0", environment: { isVisible: () => true }
      });
      store.accept(unique, new Date(Date.parse("2026-09-05T19:00:00.000Z") + index * 11 * 60_000).toISOString());
    }
    assert.equal(store.list({ retailerId: "walmart", limit: 200 }).length, 50);
    assert.equal(store.detail(first.id), null);
    const pruned = store.prune(Date.parse("2027-01-01T00:00:00.000Z"));
    assert.equal(pruned.retained, 0);
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("capsule routes accept local evidence, expose admin lifecycle, and stay closed in hosted mode", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "yoink-evidence-api-"));
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, dataDirectory, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const origin = `chrome-extension://${"d".repeat(32)}`;
  try {
    const pairingCode = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: baseUrl }, body: "{}"
    }).then((response) => response.json()) as { pairing: { code: string } };
    const paired = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ pairingCode: pairingCode.pairing.code })
    }).then((response) => response.json()) as { device: { token: string } };
    const headers = { "Content-Type": "application/json", Origin: origin, Authorization: `Bearer ${paired.device.token}` };
    const body = await capsule();
    const accepted = await fetch(`${baseUrl}/api/v1/devices/self/evidence-capsules/walmart`, {
      method: "POST", headers, body: JSON.stringify(body)
    });
    assert.equal(accepted.status, 202);
    assert.equal((await fetch(`${baseUrl}/api/v1/devices/self/evidence-capsules/walmart`, {
      method: "POST", headers, body: JSON.stringify(body)
    })).status, 409);
    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(health.localEvidenceCapsules, true);
    assert.equal(health.evidenceCapsuleTransport, "loopback");
    const list = await fetch(`${baseUrl}/api/v1/admin/evidence-capsules`).then((response) => response.json()) as { items: Array<{ id: string }> };
    assert.equal(list.items[0]?.id, body.id);
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/evidence-capsules/${body.id}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/evidence-capsules/${body.id}`, { method: "DELETE", headers: { Origin: baseUrl } })).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }

  const hostedData = mkdtempSync(join(tmpdir(), "yoink-evidence-hosted-"));
  const hostedDb = new YoinkDatabase();
  const hosted = createYoinkServer({
    db: hostedDb, dataDirectory: hostedData, hosted: true,
    webRoot: join(process.cwd(), "apps", "web"), version: "test"
  });
  hosted.listen(0, "127.0.0.1");
  await once(hosted, "listening");
  try {
    const url = `http://127.0.0.1:${(hosted.address() as AddressInfo).port}`;
    const health = await fetch(`${url}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(health.localEvidenceCapsules, false);
    assert.equal(health.evidenceCapsuleTransport, "none");
  } finally {
    hosted.close();
    await once(hosted, "close");
    hostedDb.close();
    rmSync(hostedData, { recursive: true, force: true });
  }
});
