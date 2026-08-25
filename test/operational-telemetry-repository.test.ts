import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { OperationalTelemetryRepository } from "../packages/database/src/operational-telemetry-repository.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-25T04:00:00.000Z").getTime();

function scope(tenantId: string, userId: string): RequestScope {
  return { tenantId, userId, actorKind: "user", actorId: userId };
}

function seedPrincipal(db: YoinkDatabase, tenantId: string, userId: string): void {
  const timestamp = new Date(NOW).toISOString();
  db.run("INSERT INTO tenants(id, name, created_at) VALUES (?, ?, ?)", tenantId, tenantId, timestamp);
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)", userId, tenantId, userId, timestamp);
}

test("operational telemetry keeps aggregate health without raw URLs, bodies, identifiers, or correlation IDs", () => {
  const db = new YoinkDatabase();
  try {
    const telemetry = new OperationalTelemetryRepository(db);
    telemetry.record({
      correlationId: "request_raw_secret_B0PRODUCT123",
      routeKey: "public.health",
      method: "GET",
      actorKind: "maintainer",
      statusCode: 200,
      durationMs: 42
    }, NOW);
    telemetry.record({
      correlationId: "request_second_success",
      routeKey: "public.health",
      method: "GET",
      actorKind: "maintainer",
      statusCode: 200,
      durationMs: 140
    }, NOW + 1_000);
    telemetry.record({
      correlationId: "request_user_error_secret",
      routeKey: "user.purchase_intents",
      method: "PATCH",
      actorKind: "user",
      statusCode: 409,
      errorCode: "intent_purchase_target_unsafe",
      durationMs: 2_500
    }, NOW + 2_000);
    telemetry.record({
      correlationId: "request_malformed_error",
      routeKey: "user.purchase_intents",
      method: "PATCH",
      actorKind: "user",
      statusCode: 400,
      errorCode: "SKU B0SHOULD_NOT_PERSIST",
      durationMs: 600
    }, NOW + 3_000);

    const summary = telemetry.summary("1h", NOW + 4_000);
    assert.deepEqual(summary.totals, {
      requests: 4,
      successes: 2,
      redirects: 0,
      clientErrors: 2,
      serverErrors: 0,
      errorRatePercent: 50,
      averageDurationMs: 821,
      maximumDurationMs: 2_500,
      latencyP95Bucket: "gte_2000"
    });
    assert.equal(summary.privacyClassification, "operational_aggregate");
    assert.equal(summary.containsRequestBodies, false);
    assert.equal(summary.containsRawUrls, false);
    assert.equal(summary.containsProductIdentifiers, false);
    assert.deepEqual(summary.errorCodes.map((item) => item.errorCode), ["http_400", "intent_purchase_target_unsafe"]);
    assert.equal(summary.routes[0]?.routeKey, "user.purchase_intents");
    assert.match(summary.recentErrors[0]?.correlationKey ?? "", /^opcorr_[a-f0-9]{48}$/);

    const durable = JSON.stringify({
      rollups: db.all("SELECT * FROM operational_request_rollups"),
      errors: db.all("SELECT * FROM operational_error_events")
    });
    assert.equal(durable.includes("request_raw_secret"), false);
    assert.equal(durable.includes("B0PRODUCT123"), false);
    assert.equal(durable.includes("B0SHOULD_NOT_PERSIST"), false);
    assert.equal(durable.includes("SKU"), false);
    assert.equal(durable.includes("intent_purchase_target_unsafe"), true);
    assert.throws(() => telemetry.record({
      correlationId: "request_invalid_route",
      routeKey: "user.product_B0SECRET" as "user.other",
      method: "GET",
      actorKind: "user",
      statusCode: 200,
      durationMs: 1
    }, NOW + 5_000), /not allowlisted/);
  } finally {
    db.close();
  }
});

test("operational telemetry is tenant isolated and retention deletes detail with an immutable receipt", () => {
  const db = new YoinkDatabase();
  try {
    seedPrincipal(db, "tenant_operational_second", "user_operational_second");
    const telemetry = new OperationalTelemetryRepository(db, { retentionDays: 1 });
    telemetry.record({
      correlationId: "request_local_old",
      routeKey: "admin.operations",
      method: "GET",
      actorKind: "maintainer",
      statusCode: 500,
      errorCode: "internal_error",
      durationMs: 300
    }, NOW - 2 * 24 * 60 * 60_000);
    runWithRequestScope(scope("tenant_operational_second", "user_operational_second"), () => telemetry.record({
      correlationId: "request_second_current",
      routeKey: "user.overview",
      method: "GET",
      actorKind: "user",
      statusCode: 200,
      durationMs: 20
    }, NOW));
    telemetry.record({
      correlationId: "request_local_current",
      routeKey: "admin.operations",
      method: "GET",
      actorKind: "maintainer",
      statusCode: 200,
      durationMs: 30
    }, NOW);

    assert.deepEqual(telemetry.counts(), {
      operationalRollupRows: 1,
      operationalErrorEvents: 0,
      operationalRetentionReceipts: 1
    });
    const local = telemetry.summary("24h", NOW + 1);
    assert.equal(local.totals.requests, 1);
    assert.equal(local.routes[0]?.routeKey, "admin.operations");
    const second = runWithRequestScope(
      scope("tenant_operational_second", "user_operational_second"),
      () => telemetry.summary("24h", NOW + 1)
    );
    assert.equal(second.totals.requests, 1);
    assert.equal(second.routes[0]?.routeKey, "user.overview");
    const receipt = db.get<{ deletedRollupRows: number; deletedErrorEvents: number }>(
      `SELECT deleted_rollup_rows AS deletedRollupRows,
              deleted_error_events AS deletedErrorEvents
       FROM operational_telemetry_retention_receipts
       WHERE tenant_id = ?`,
      LOCAL_TENANT_ID
    );
    assert.equal(receipt?.deletedRollupRows, 1);
    assert.equal(receipt?.deletedErrorEvents, 1);
    assert.throws(
      () => db.run("UPDATE operational_telemetry_retention_receipts SET deleted_error_events = 0"),
      /append-only/
    );
  } finally {
    db.close();
  }
});
