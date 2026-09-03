import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { AuditRepository } from "../packages/database/src/audit-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = Date.parse("2026-09-01T18:00:00.000Z");
const USER_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "user",
  actorId: LOCAL_USER_ID
};

function scope(actorKind: RequestScope["actorKind"]): RequestScope {
  return { ...USER_SCOPE, actorKind, actorId: `${actorKind}_audit_fixture` };
}

function recordFixture(
  audit: AuditRepository,
  actorKind: RequestScope["actorKind"],
  eventType: string,
  reasonCode: string,
  hoursAgo: number
): void {
  runWithRequestScope(scope(actorKind), () => audit.record({
    correlationId: `correlation_${actorKind}_${eventType}`,
    eventType,
    reasonCode,
    message: `${eventType} fixture`
  }, NOW - hoursAgo * 60 * 60 * 1000));
}

function seedAudit(db: YoinkDatabase): AuditRepository {
  const audit = new AuditRepository(db);
  recordFixture(audit, "user", "guardrail_settings_updated", "approval_recorded", 2);
  recordFixture(audit, "device", "cart_ready", "verified", 3);
  recordFixture(audit, "maintainer", "listing_updated", "recorded", 30);
  recordFixture(audit, "service", "signal_received", "accepted", 4);
  recordFixture(audit, "user", "user_pairing_created", "recorded", 5);
  db.run(
    `INSERT INTO audit_events(
       id, tenant_id, user_id, correlation_id, event_type, reason_code, message, data_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
    "audit_legacy_unknown",
    LOCAL_TENANT_ID,
    LOCAL_USER_ID,
    "correlation_legacy_system",
    "maintenance_completed",
    "recorded",
    "Legacy fixture",
    new Date(NOW - 60 * 60 * 1000).toISOString()
  );
  return audit;
}

test("audit queries combine family, actor, date, and text filters without breaking legacy callers", () => {
  const db = new YoinkDatabase();
  try {
    const audit = seedAudit(db);
    const safety = runWithRequestScope(USER_SCOPE, () => audit.list(20, 0, {
      type: "safety",
      actor: "user",
      since: new Date(NOW - 24 * 60 * 60 * 1000).toISOString()
    })) as Array<Record<string, unknown>>;
    assert.deepEqual(safety.map((event) => event.eventType), ["guardrail_settings_updated"]);
    assert.equal(safety[0]?.eventFamily, "safety");
    assert.equal(safety[0]?.actorKind, "user");
    assert.equal(runWithRequestScope(USER_SCOPE, () => audit.count({ type: "safety", actor: "user" })), 1);

    const chromeActions = runWithRequestScope(USER_SCOPE, () => audit.list(20, 0, {
      type: "actions",
      actor: "device"
    })) as Array<Record<string, unknown>>;
    assert.deepEqual(chromeActions.map((event) => event.eventType), ["cart_ready"]);
    assert.equal(chromeActions[0]?.eventFamily, "actions");

    const recentCatalog = runWithRequestScope(USER_SCOPE, () => audit.list(20, 0, {
      type: "catalog",
      since: new Date(NOW - 24 * 60 * 60 * 1000).toISOString()
    }));
    assert.deepEqual(recentCatalog, []);

    const unknown = runWithRequestScope(USER_SCOPE, () => audit.list(20, 0, { actor: "unknown" })) as Array<Record<string, unknown>>;
    assert.deepEqual(unknown.map((event) => event.eventType), ["maintenance_completed"]);
    assert.equal(unknown[0]?.eventFamily, "system");
    assert.equal(unknown[0]?.actorKind, "unknown");

    const legacySearch = runWithRequestScope(USER_SCOPE, () => audit.list(20, 0, "signal received"));
    assert.equal(legacySearch.length, 1);
    assert.equal(legacySearch[0]?.eventType, "signal_received");
    assert.equal(runWithRequestScope(USER_SCOPE, () => audit.count("signal received")), 1);

    const invalidFiltersFailOpen = runWithRequestScope(USER_SCOPE, () => audit.list(20, 0, {
      type: "not_a_family",
      actor: "not_an_actor",
      since: "not-a-date"
    }));
    assert.equal(invalidFiltersFailOpen.length, 6);
  } finally {
    db.close();
  }
});

test("the user audit API applies family, actor, and since together", async () => {
  const db = new YoinkDatabase();
  seedAudit(db);
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "audit-filter-test",
    requestScopeResolver: () => USER_SCOPE
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const since = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    const response = await fetch(`${baseUrl}/api/v1/user/audit?type=safety&actor=user&since=${encodeURIComponent(since)}`);
    assert.equal(response.status, 200);
    const result = await response.json() as {
      items: Array<{ eventType: string; eventFamily: string; actorKind: string }>;
      total: number;
    };
    assert.equal(result.total, 1);
    assert.deepEqual(result.items, [{
      ...result.items[0],
      eventType: "guardrail_settings_updated",
      eventFamily: "safety",
      actorKind: "user"
    }]);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
