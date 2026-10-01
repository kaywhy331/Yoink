import assert from "node:assert/strict";
import test from "node:test";
import { operationalRouteKey, resolveApiRoutePolicy } from "../apps/api/src/api-route-policy.js";
import { OPERATIONAL_ROUTE_KEYS } from "../packages/database/src/operational-telemetry-repository.js";

test("action-platform routes keep their intended surface and least-privilege permission", () => {
  const cases = [
    ["GET", "/api/v1/user/action-platform", "/api/v1/user/action-platform", "user", "user.read"],
    ["GET", "/api/v1/user/action-handoff", "/api/v1/user/action-handoff", "user", "user.read"],
    ["POST", "/api/v1/user/watch-queue/watch_item_123/enroll", "/api/v1/user/watch-queue/watch_item_123/enroll", "user", "user.intent.manage"],
    ["PATCH", "/api/v1/user/watch-queue/settings", "/api/v1/user/watch-queue/settings", "user", "user.settings.manage"],
    ["POST", "/api/v1/user/connectors", "/api/v1/user/connectors", "user", "user.settings.manage"],
    ["POST", "/api/v1/user/source-feedback/false-positive", "/api/v1/user/source-feedback/false-positive", "user", "user.intent.manage"],
    ["POST", "/api/v1/user/purchase-handoffs/job_walmart_fixture/click", "/api/v1/user/purchase-handoffs/job_walmart_fixture/click", "user", "user.intent.manage"],
    ["POST", "/api/v1/user/store-link-clicks", "/api/v1/user/store-link-clicks", "user", "user.intent.manage"],
    ["POST", "/api/v1/user/purchase-profiles/apply", "/api/v1/purchase-profiles/apply", "user", "user.intent.manage"],
    ["POST", "/api/v1/admin/drop-windows", "/api/v1/admin/drop-windows", "admin", "source.manage"],
    ["GET", "/api/v1/admin/restock-patterns", "/api/v1/admin/restock-patterns", "admin", "admin.read"],
    ["POST", "/api/v1/admin/signals/simulate", "/api/v1/admin/signals/simulate", "admin", "source.manage"],
    ["GET", "/api/v1/admin/notifications", "/api/v1/admin/notifications", "admin", "admin.read"],
    ["GET", "/api/v1/admin/attribution-receipts", "/api/v1/admin/attribution-receipts", "admin", "admin.read"],
    ["GET", "/api/v1/admin/analytics", "/api/v1/admin/analytics", "admin", "admin.read"],
    ["PATCH", "/api/v1/admin/workers/schedules/background_schedule_123", "/api/v1/workers/schedules/background_schedule_123", "admin", "worker.manage"],
    ["POST", "/api/v1/admin/workers/restart", "/api/v1/admin/workers/restart", "admin", "worker.manage"],
    ["POST", "/api/v1/devices/self/readiness/target", "/api/v1/devices/self/readiness/target", "device", "device.self"],
    ["POST", "/api/v1/devices/self/jobs/job_fixture/outcome", "/api/v1/devices/self/jobs/job_fixture/outcome", "device", "device.self"]
  ] as const;
  for (const [method, path, canonicalPath, surface, permission] of cases) {
    const policy = resolveApiRoutePolicy(method, path);
    assert.ok(policy, path);
    assert.equal(policy.pathname, canonicalPath, path);
    assert.equal(policy.surface, surface, path);
    assert.equal(policy.permission, permission, path);
    assert.equal(policy.classified, true, path);
    assert.equal(policy.surfaceMismatch, false, path);
  }
});

test("the credential-free affiliate directory is an explicitly classified public route", () => {
  const policy = resolveApiRoutePolicy("GET", "/api/v1/affiliate-routing");
  assert.ok(policy);
  assert.equal(policy.pathname, "/api/v1/affiliate-routing");
  assert.equal(policy.surface, "public");
  assert.equal(policy.permission, null);
  assert.equal(policy.classified, true);
  assert.equal(policy.surfaceMismatch, false);
});

test("the compact handoff route has an allowlisted operational identity", () => {
  const policy = resolveApiRoutePolicy("GET", "/api/v1/user/action-handoff");
  assert.ok(policy);
  const routeKey = operationalRouteKey("/api/v1/user/action-handoff", policy);
  assert.equal(routeKey, "user.actions");
  assert.equal(OPERATIONAL_ROUTE_KEYS.includes(routeKey), true);
});

test("Setup's store switch is a shopper route whose turn-on needs Admin's activation permission", () => {
  for (const [path, permission] of [
    ["/api/v1/user/stores/walmart/turn-on", "qualification.manage"],
    ["/api/v1/user/stores/target/turn-off", "user.settings.manage"]
  ] as const) {
    const policy = resolveApiRoutePolicy("POST", path);
    assert.ok(policy, path);
    assert.equal(policy.pathname, path, "never rewritten to an admin path");
    assert.equal(policy.surface, "user", path);
    assert.equal(policy.permission, permission, path);
    assert.equal(policy.classified, true, path);
    assert.equal(policy.surfaceMismatch, false, path);
    assert.equal(operationalRouteKey(path, policy), "user.settings");
  }
  assert.equal(resolveApiRoutePolicy("POST", "/api/v1/user/stores/walmart/remove")?.classified, false);
  for (const [method, path] of [
    ["GET", "/api/v1/user/purchase-intents/call-added"],
    ["POST", "/api/v1/user/purchase-intents/call-added/remove"]
  ] as const) {
    const policy = resolveApiRoutePolicy(method, path);
    assert.equal(policy?.pathname, path);
    assert.equal(policy?.surface, "user");
    assert.equal(policy?.permission, "user.intent.manage");
  }
});
