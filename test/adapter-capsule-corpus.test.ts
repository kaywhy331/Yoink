import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import {
  ADD_LANES,
  RETAILER_OBSERVER_VERSIONS,
  RETAILER_SELECTOR_PACK_VERSIONS,
  type RetailerAdapterDiagnosticInput,
  type SupportedRetailerId
} from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
// @ts-expect-error The replay CLI is intentionally an importable JavaScript command module.
import { replayCapsuleObject } from "../scripts/replay-capsule.mjs";

const ROOT = join(process.cwd(), "test", "fixtures", "capsules");

function metadataFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return metadataFiles(path);
    return entry.isFile() && entry.name.endsWith(".json") && entry.name !== "scan-terms.json" ? [path] : [];
  });
}

const fixtures = metadataFiles(ROOT);

test("the promoted capsule corpus stays bounded", () => {
  assert.ok(fixtures.length <= 80, `Expected at most 80 promoted capsules, found ${fixtures.length}.`);
});

for (const metadataPath of fixtures) {
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, any>;
  const slug = basename(metadataPath, ".json");
  const retailerId = String(metadata.retailerId || basename(dirname(metadataPath)));
  test(`${retailerId}/${slug}`, async () => {
    assert.match(String(metadata.capsuleId || ""), /^cap_[A-Za-z0-9_-]{8,120}$/);
    assert.match(String(metadata.sha256 || ""), /^[a-f0-9]{64}$/);
    assert.ok(String(metadata.notes || "").trim(), "Promoted fixtures must explain their retained expectation.");
    const compressed = readFileSync(join(dirname(metadataPath), `${slug}.html.gz`));
    assert.equal(createHash("sha256").update(compressed).digest("hex"), metadata.sha256);
    const expectations = metadata.expectations || {};
    const capsule = {
      contractVersion: 1,
      id: metadata.capsuleId,
      capturedAt: metadata.capturedAt,
      retailerId,
      retailerSku: metadata.retailerSku,
      operation: metadata.operation || "observe",
      outcome: expectations.outcome,
      failureStage: expectations.failureStage,
      reasonCode: expectations.reasonCode,
      observerVersion: metadata.observerVersion,
      addAdapterVersion: metadata.addAdapterVersion,
      packVersion: metadata.packVersion || "",
      extensionVersion: "corpus",
      url: metadata.url,
      requiredFulfillment: metadata.requiredFulfillment || "shipping"
    };
    const result = await replayCapsuleObject(capsule, {
      html: gunzipSync(compressed).toString("utf8"),
      fulfillment: capsule.requiredFulfillment
    });
    assert.deepEqual(result.actual, {
      outcome: expectations.outcome,
      failureStage: expectations.failureStage,
      reasonCode: expectations.reasonCode
    });
    for (const field of ["availability", "unitPriceCents", "sellerType", "fulfillment"]) {
      if (Object.hasOwn(expectations, field)) assert.equal(result.observation[field], expectations[field], field);
    }
    // Contract parity: whatever the packaged observer emits for a real page
    // must be accepted by the server's diagnostic validator, or the companion
    // posts it forever and the ledger never sees the failure.
    const db = new YoinkDatabase();
    try {
      const devices = new DeviceRepository(db);
      const device = devices.pair({ pairingCode: devices.createPairingCode().code });
      const storeId = retailerId as SupportedRetailerId;
      const lane = (ADD_LANES as Record<string, { contractVersion: string } | undefined>)[storeId];
      const stored = new AdapterDiagnosticRepository(db).record(device.id, {
        ...result.diagnostic,
        contractVersion: 1,
        observedAt: new Date().toISOString(),
        retailerId: storeId,
        retailerSku: capsule.retailerSku,
        adapterVersion: capsule.operation === "observe" ? RETAILER_OBSERVER_VERSIONS[storeId] : lane?.contractVersion ?? "",
        packVersion: RETAILER_SELECTOR_PACK_VERSIONS[storeId],
        attemptCount: 1,
        domChanged: false
      } as RetailerAdapterDiagnosticInput);
      assert.equal(stored.outcome, expectations.outcome);
      assert.equal(stored.reasonCode, expectations.reasonCode);
    } finally {
      db.close();
    }
  });
}
