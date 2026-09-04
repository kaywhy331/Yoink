import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import {
  TARGET_ADD_ADAPTER_VERSION,
  TARGET_OBSERVER_VERSION,
  type TargetShadowObservationInput
} from "../packages/contracts/src/index.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { QualificationRepository } from "../packages/database/src/qualification-repository.js";
import { ShadowObservationRepository } from "../packages/database/src/shadow-observation-repository.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 300): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

test("admin Stores shows expiring status, linked guard evidence, and launches multiple prior passing SKUs", async () => {
  const db = new YoinkDatabase();
  const now = Date.now();
  const timestamp = new Date(now - 1_000).toISOString();
  const devices = new DeviceRepository(db);
  const pairing = devices.createPairingCode(now - 12_000);
  const device = devices.pair({ pairingCode: pairing.code }, now - 11_000);
  const observations = new ShadowObservationRepository(db);
  const recordTarget = (retailerSku: string, observedAt: number, overrides: Partial<TargetShadowObservationInput> = {}) => observations.record(device.id, {
    adapterVersion: TARGET_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    pageKind: "product",
    retailerId: "target",
    retailerSku,
    availability: "in_stock",
    unitPriceCents: 1299,
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    addControlActionable: true,
    securityChallenge: false,
    interactiveBlock: "",
    ...overrides
  }, observedAt + 100);
  const first = recordTarget("95111111", now - 10_000);
  const second = recordTarget("95222222", now - 8_000);
  recordTarget("95333333", now - 6_000, {
    availability: "out_of_stock",
    unitPriceCents: null,
    sellerName: "",
    sellerType: "unknown",
    fulfillment: "unknown",
    addControlActionable: false
  });
  const qualifications = new QualificationRepository(db);
  for (const [shadow, observedAt] of [[first, now - 9_000], [second, now - 7_000]] as const) {
    qualifications.recordTargetAddRehearsal(device.id, {
      adapterVersion: TARGET_ADD_ADAPTER_VERSION,
      observerVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      shadowObservationId: shadow.id,
      observedAt: new Date(observedAt).toISOString(),
      outcome: "passed",
      reasonCode: "verified"
    }, observedAt + 100);
  }
  db.run(
    `INSERT INTO retailer_adapter_qualifications(
       tenant_id, user_id, retailer_id, adapter_version, highest_action, status,
       evidence_hash, qualified_at, updated_at, expires_at
     ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', ?, ?, ?, ?)`,
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    TARGET_ADD_ADAPTER_VERSION,
    "a".repeat(64),
    timestamp,
    timestamp,
    new Date(now + 3 * 24 * 60 * 60_000).toISOString()
  );
  db.run("UPDATE app_settings SET execution_mode = 'live', actions_paused = 0");

  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-qualification-readiness-ui-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#stores/qualification/target`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: (path: string, options: RequestInit = {}) => fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        ...(options.method && options.method !== "GET" ? { Origin: baseUrl } : {}),
        ...(options.headers || {})
      }
    })
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => { throw new Error("Native confirm must not run."); } });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: true, note: "" }) }
  });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  const opened: string[] = [];
  Object.defineProperty(browser, "open", {
    configurable: true,
    value: (url: string) => { opened.push(String(url)); return null; }
  });

  try {
    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.match(
      browser.document.querySelector("#targetQualificationSummary")?.textContent ?? "",
      /Qualification expires soon/
    ));
    assert.equal(browser.document.querySelector("#targetQualificationGate")?.textContent, "Expiring");
    assert.doesNotMatch(
      browser.document.querySelector("#targetQualificationSummary")?.textContent ?? "",
      /Guarded adds active/
    );
    await eventually(() => assert.equal(
      browser.document.querySelectorAll("#targetLaneReadiness .qualification-candidate-links a").length,
      2
    ));
    const evidenceLinks = [...browser.document.querySelectorAll<HTMLAnchorElement>(
      "#targetQualificationChecks .qualification-product"
    )];
    assert.ok(evidenceLinks.some((link) => /SKU 95111111/.test(link.textContent ?? "")));
    assert.ok(evidenceLinks.some((link) => /SKU 95333333/.test(link.textContent ?? "") && /Did not pass/.test(link.textContent ?? "")));
    assert.ok(evidenceLinks.every((link) => link.href.startsWith("https://www.target.com/p/-/A-")));

    const launch = browser.document.querySelector<HTMLButtonElement>("#targetLaneReadiness [data-open-qualification-candidates]");
    assert.equal(launch?.textContent, "Open prior passing SKUs (2)");
    launch?.click();
    assert.deepEqual(opened.sort(), [
      "https://www.target.com/p/-/A-95111111#yoink-inspect-and-qualify",
      "https://www.target.com/p/-/A-95222222#yoink-inspect-and-qualify"
    ]);
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
