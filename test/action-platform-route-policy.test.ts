import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiRoutePolicy } from "../apps/api/src/api-route-policy.js";

test("action-platform routes keep their intended surface and least-privilege permission", () => {
  const cases = [
    ["GET", "/api/v1/user/action-platform", "/api/v1/user/action-platform", "user", "user.read"],
    ["POST", "/api/v1/user/watch-queue/watch_item_123/enroll", "/api/v1/user/watch-queue/watch_item_123/enroll", "user", "user.intent.manage"],
    ["PATCH", "/api/v1/user/watch-queue/settings", "/api/v1/user/watch-queue/settings", "user", "user.settings.manage"],
    ["POST", "/api/v1/user/connectors", "/api/v1/user/connectors", "user", "user.settings.manage"],
    ["POST", "/api/v1/user/source-feedback/false-positive", "/api/v1/user/source-feedback/false-positive", "user", "user.intent.manage"],
    ["POST", "/api/v1/admin/drop-windows", "/api/v1/admin/drop-windows", "admin", "source.manage"],
    ["GET", "/api/v1/admin/restock-patterns", "/api/v1/admin/restock-patterns", "admin", "admin.read"],
    ["PATCH", "/api/v1/admin/workers/schedules/background_schedule_123", "/api/v1/workers/schedules/background_schedule_123", "admin", "worker.manage"],
    ["POST", "/api/v1/admin/workers/restart", "/api/v1/admin/workers/restart", "admin", "worker.manage"],
    ["POST", "/api/v1/devices/self/readiness/target", "/api/v1/devices/self/readiness/target", "device", "device.self"]
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
