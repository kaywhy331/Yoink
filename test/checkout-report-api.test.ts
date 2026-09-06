import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { operationalRouteKey, resolveApiRoutePolicy } from "../apps/api/src/api-route-policy.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { LOCAL_REQUEST_SCOPE } from "../packages/database/src/request-scope.js";
import { checkoutFixture } from "./helpers/checkout-report-fixture.js";

test("checkout reports use actor-owned routes, preview without writes and retry-safe saves", async () => {
  const f = checkoutFixture();
  const other = new AuthorizationRepository(f.db).createTenantUser({ displayName: "Other shopper" }).user;
  const server = createYoinkServer({ db: f.db, webRoot: join(process.cwd(), "apps/web"), version: "report-test",
    requestScopeResolver: req => req.headers["x-test-principal"] === "other" ? { ...LOCAL_REQUEST_SCOPE, userId: other.id, actorId: other.id } : LOCAL_REQUEST_SCOPE });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const path = `/api/v1/user/checkout-reports/${f.jobId}`;
  const request = (suffix = "", body?: unknown, foreign = false) => fetch(base + path + suffix, {
    method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(foreign ? { "X-Test-Principal": "other" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    for (const [method, suffix, permission] of [["GET", "", "user.read"], ["POST", "/preview", "user.intent.manage"], ["POST", "/corrections", "user.intent.manage"]]) {
      const route = path + suffix;
      const policy = resolveApiRoutePolicy(method!, route);
      assert.equal(policy?.pathname, route); assert.equal(policy?.permission, permission);
      assert.equal(operationalRouteKey(route, policy), "user.actions");
    }
    const loaded = await request(); assert.equal(loaded.status, 200); assert.match(loaded.headers.get("cache-control") || "", /no-store/);
    const data = await loaded.json() as any;
    const draft = { kind: "refund", refundAmountCents: 1500, expectedReportId: data.report.id, reason: "Partial refund received" };
    const before = f.db.all("SELECT * FROM spend_ledger_entries");
    const reviewed = await request("/preview", draft); assert.equal(reviewed.status, 200);
    assert.deepEqual(f.db.all("SELECT * FROM spend_ledger_entries"), before);
    const { preview } = await reviewed.json() as any;
    const command = { ...preview.draft, fingerprint: preview.fingerprint, confirmation: "CORRECT_CHECKOUT_REPORT", requestId: "api_refund_request_001" };
    assert.equal((await request("", undefined, true)).status, 404);
    assert.equal((await request("/preview", draft, true)).status, 404);
    assert.equal((await request("/corrections", command, true)).status, 404);
    assert.equal((await request("/corrections", { ...command, confirmation: "" })).status, 400);
    const [first, retry] = await Promise.all([request("/corrections", command), request("/corrections", command)]);
    assert.equal(first.status, 200); assert.equal(retry.status, 200);
    const results = await Promise.all([first.json(), retry.json()]) as any[];
    assert.deepEqual(results.map(result => result.disposition).sort(), ["corrected", "unchanged"]);
    assert.equal(results[0].correctionId, results[1].correctionId);
    assert.equal((await request("/corrections", { ...command, refundAmountCents: 1600 })).status, 409);
    assert.equal((await request("/corrections", { ...command, requestId: "api_different_request" })).status, 409);
    const updated = await (await request()).json() as any;
    assert.equal(updated.report.netCents, 5000); assert.equal(updated.history.total, 2);
    const analytics = await (await fetch(base + "/api/v1/user/analytics")).json() as any;
    assert.equal(analytics.analytics.spend.refundedCents, 1500);
    assert.equal(f.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM action_jobs")!.count, 1);
    assert.equal(f.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM user_action_connector_deliveries")!.count, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.db.close(); }
});
