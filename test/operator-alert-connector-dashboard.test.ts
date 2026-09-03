import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { AMAZON_OBSERVER_VERSION, type RetailerAdapterDiagnosticInput } from "../packages/contracts/src/index.js";
import { AdapterDiagnosticRepository } from "../packages/database/src/adapter-diagnostic-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { OperatorAlertRepository } from "../packages/database/src/operator-alert-repository.js";
import { OperatorAlertConnectorDispatchService } from "../packages/engine/src/operator-alert-connector-dispatch.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 500): Promise<void> {
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

function connectorDiagnostic(observedAt: number): RetailerAdapterDiagnosticInput {
  return {
    contractVersion: 1,
    observedAt: new Date(observedAt).toISOString(),
    retailerId: "amazon",
    retailerSku: "B0FB21526X",
    adapterVersion: AMAZON_OBSERVER_VERSION,
    operation: "observe",
    outcome: "failed",
    failureStage: "offer_binding",
    reasonCode: "offer_binding_ambiguous",
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
      scopedControlCount: 0,
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

test("the Alerts workspace binds only an opaque deployment connector reference", async () => {
  const db = new YoinkDatabase();
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({
    db,
    webRoot,
    version: "operator-alert-connector-dashboard-test",
    operatorAlertConnectorBindings: { ops_primary: "a".repeat(64) }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#alerts`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  const confirmations: Array<Record<string, unknown>> = [];
  const mutationBodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: (path: string, options: RequestInit = {}) => {
      if (options.body) mutationBodies.push({ path: String(path), body: JSON.parse(String(options.body)) as Record<string, unknown> });
      return fetch(new URL(path, baseUrl), {
        ...options,
        headers: {
          ...(options.method && options.method !== "GET" ? { Origin: baseUrl } : {}),
          ...(options.headers || {})
        }
      });
    }
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => { throw new Error("Native confirm must not run."); } });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async (options: Record<string, unknown>) => {
      confirmations.push(options);
      const title = String(options.title || "");
      return {
        confirmed: true,
        note: title.startsWith("Acknowledge") ? "Investigating the bounded failure group."
          : title.startsWith("Resolve") ? "Reviewed the repair and closed the incident." : ""
      };
    } }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.open = true; }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() { this.open = false; }
  });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  try {
    const script = readFileSync(join(webRoot, "app.js"), "utf8");
    await browser.eval(`(async () => { ${script}\n })()`);
    await eventually(() => assert.equal(
      (browser.document.querySelector("#addOperatorAlertConnectorButton") as HTMLButtonElement)?.disabled,
      false
    ));
    (browser.document.querySelector("#addOperatorAlertConnectorButton") as HTMLButtonElement).click();
    const form = browser.document.querySelector("#operatorAlertConnectorForm") as HTMLFormElement;
    assert.ok(form);
    assert.equal(form.querySelector('input[type="url"]'), null);
    (form.elements.namedItem("name") as HTMLInputElement).value = "Primary operations webhook";
    (form.elements.namedItem("endpointReference") as HTMLInputElement).value = "ops_primary";
    (form.elements.namedItem("minimumSeverity") as HTMLSelectElement).value = "warning";
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_connectors WHERE endpoint_reference = 'ops_primary'"
    )?.count, 1));
    await eventually(() => assert.match(
      browser.document.querySelector("#operatorAlertConnectorList")?.textContent ?? "",
      /idle/
    ));
    assert.match(browser.document.querySelector("#operatorAlertConnectorList")?.textContent ?? "", /5m SLO/);
    assert.equal(JSON.stringify(db.all("SELECT * FROM operator_alert_connectors")).includes("https://"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM operator_alert_connectors")).toLocaleLowerCase().includes("secret"), false);

    const at = Date.now() - 5_000;
    const devices = new DeviceRepository(db);
    const pairing = devices.createPairingCode(at);
    const device = devices.pair({ pairingCode: pairing.code }, at + 100);
    const diagnostics = new AdapterDiagnosticRepository(db);
    diagnostics.record(device.id, connectorDiagnostic(at + 200), at + 250);
    new OperatorAlertRepository(db, { ops_primary: "a".repeat(64) }).reconcileAdapterRepairs(
      diagnostics.listRepairQueue(),
      "request_dashboard_connector_dead_letter_001",
      at + 300
    );
    await new OperatorAlertConnectorDispatchService(db, {
      definitions: [{
        reference: "ops_primary",
        endpoint: "https://alerts.example.com/v1/yoink",
        signingSecretEnvironment: "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY",
        bindingFingerprint: "a".repeat(64)
      }],
      bindings: { ops_primary: "a".repeat(64) },
      fingerprint: "b".repeat(64)
    }, {
      async deliver() {
        return { disposition: "dead_letter", reasonCode: "webhook_rejected", httpStatus: 400 };
      }
    }).execute(at + 400);
    (browser.document.querySelector("[data-operator-alert-connector-edit]") as HTMLButtonElement).click();
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.match(
      browser.document.querySelector("#operatorAlertConnectorDeliveryList")?.textContent ?? "",
      /Replay once/
    ));
    assert.equal(browser.document.querySelector("#operatorAlertMetricGrid"), null);
    assert.match(browser.document.querySelector("#operatorAlertSummary")?.textContent ?? "", /1 active/);
    assert.deepEqual(
      [...browser.document.querySelectorAll('[data-alerts-panel] .panel-heading p')].map((paragraph) => paragraph.textContent?.trim()),
      [
        "Review active failures and record the outcome.",
        "Choose which failures open an incident.",
        "Send incident updates through reviewed destinations.",
        "See where incident updates went.",
        "Retry a failed delivery without changing its message."
      ]
    );
    assert.match(browser.document.querySelector("#operatorAlertConnectorList")?.textContent ?? "", /critical/);
    (browser.document.querySelector("[data-operator-alert-connector-retry]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(db.get<{ state: string }>(
      "SELECT state FROM operator_alert_connector_deliveries"
    )?.state, "pending"));
    await eventually(() => {
      const deliveryText = browser.document.querySelector("#operatorAlertConnectorDeliveryList")?.textContent ?? "";
      assert.match(deliveryText, /pending/);
      assert.doesNotMatch(deliveryText, /Replay once/);
    });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operator_alert_connector_delivery_events WHERE reason_code = 'operator_manual_replay'"
    )?.count, 1);

    const acknowledge = browser.document.querySelector("[data-operator-alert-acknowledge]") as HTMLButtonElement;
    assert.ok(acknowledge);
    acknowledge.click();
    await eventually(() => assert.equal(db.get<{ status: string }>(
      "SELECT status FROM operator_alert_incidents"
    )?.status, "acknowledged"));
    const acknowledgeRequest = mutationBodies.find((request) => request.path.endsWith("/acknowledge"));
    assert.equal(acknowledgeRequest?.body.note, "Investigating the bounded failure group.");
    assert.equal((confirmations.find((options) => String(options.title).startsWith("Acknowledge"))?.note as Record<string, unknown>)?.required, false);

    await eventually(() => assert.ok(browser.document.querySelector("[data-operator-alert-resolve]")));
    (browser.document.querySelector("[data-operator-alert-resolve]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(db.get<{ status: string }>(
      "SELECT status FROM operator_alert_incidents"
    )?.status, "resolved"));
    const resolveRequest = mutationBodies.find((request) => request.path.endsWith("/resolve"));
    assert.equal(resolveRequest?.body.note, "Reviewed the repair and closed the incident.");
    assert.equal((confirmations.find((options) => String(options.title).startsWith("Resolve"))?.note as Record<string, unknown>)?.required, true);
    await eventually(() => {
      assert.match(browser.document.querySelector("#operatorAlertIncidentList")?.textContent ?? "", /resolved/);
      assert.equal(browser.document.querySelector("#operatorAlertSummary")?.textContent, "No active incidents.");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
