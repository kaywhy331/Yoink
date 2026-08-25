import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminChangeControlError,
  AdminChangeControlRepository
} from "../packages/database/src/admin-change-control-repository.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-25T02:00:00.000Z").getTime();

function scope(userId: string, actorId: string, assurance: "baseline" | "step_up" = "step_up"): RequestScope {
  return {
    tenantId: LOCAL_TENANT_ID,
    userId,
    actorKind: "user",
    actorId,
    authenticationAssurance: assurance,
    authenticationTime: Math.floor((NOW - 10_000) / 1_000),
    sessionId: `session_${actorId}`
  };
}

function provisionUser(db: YoinkDatabase, userId: string, displayName: string, role = "security_admin"): void {
  const timestamp = new Date(NOW).toISOString();
  db.run(
    "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
    userId,
    LOCAL_TENANT_ID,
    displayName,
    timestamp
  );
  db.run(
    `INSERT INTO authorization_memberships(
       tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'active', 'test_fixture', ?, ?)`,
    LOCAL_TENANT_ID,
    userId,
    role,
    timestamp,
    timestamp
  );
}

test("two-person change control binds fresh actors to one exact payload and consumes atomically", () => {
  const db = new YoinkDatabase();
  try {
    provisionUser(db, "user_approver", "Independent approver");
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => new AuthorizationRepository(db).grantRole(LOCAL_USER_ID, "security_admin"));
    const changes = new AdminChangeControlRepository(db);
    const requester = scope(LOCAL_USER_ID, "actor_requester");
    const approver = scope("user_approver", "actor_approver");
    const baseline = scope(LOCAL_USER_ID, "actor_baseline", "baseline");
    const protectedPayload = {
      retailerId: "amazon",
      confirmation: "ACTIVATE_AMAZON_ADD_V1",
      transientCredential: "must_never_be_retained"
    };
    let executions = 0;

    assert.throws(
      () => runWithRequestScope(baseline, () => changes.execute({
        operationType: "retailer_lane_activate",
        targetKey: "amazon",
        payload: protectedPayload,
        summary: { retailerId: "amazon", action: "Activate guarded add-only execution" },
        correlationId: "change_baseline_001"
      }, () => { executions += 1; }, NOW)),
      (error) => error instanceof AdminChangeControlError && error.code === "step_up_required"
    );
    assert.equal(executions, 0);

    const pending = runWithRequestScope(requester, () => changes.execute({
      operationType: "retailer_lane_activate",
      targetKey: "amazon",
      payload: protectedPayload,
      summary: { retailerId: "amazon", action: "Activate guarded add-only execution" },
      correlationId: "change_request_001"
    }, () => { executions += 1; }, NOW));
    assert.equal(pending.disposition, "pending_approval");
    assert.equal(pending.request.status, "pending");
    assert.equal(pending.request.controlLevel, "two_person");
    assert.equal(executions, 0);

    assert.throws(
      () => runWithRequestScope(requester, () => changes.decide(pending.request.id, {
        decision: "approve",
        confirmation: "APPROVE_HIGH_RISK_CHANGE"
      }, "change_self_approval_001", NOW + 1_000)),
      (error) => error instanceof AdminChangeControlError && error.code === "independent_approval_required"
    );

    const approved = runWithRequestScope(approver, () => changes.decide(pending.request.id, {
      decision: "approve",
      confirmation: "APPROVE_HIGH_RISK_CHANGE"
    }, "change_approval_001", NOW + 2_000));
    assert.equal(approved.status, "approved");
    assert.equal(approved.decisions[0]?.reviewerDisplayName, "Independent approver");

    assert.throws(
      () => runWithRequestScope(requester, () => changes.execute({
        operationType: "retailer_lane_activate",
        targetKey: "amazon",
        payload: { ...protectedPayload, confirmation: "DIFFERENT" },
        summary: { retailerId: "amazon", action: "Activate guarded add-only execution" },
        correlationId: "change_drift_001",
        changeRequestId: pending.request.id
      }, () => { executions += 1; }, NOW + 3_000)),
      (error) => error instanceof AdminChangeControlError && error.code === "change_request_mismatch"
    );
    assert.equal(executions, 0);

    assert.throws(
      () => runWithRequestScope(requester, () => changes.execute({
        operationType: "retailer_lane_activate",
        targetKey: "amazon",
        payload: { transientCredential: "must_never_be_retained", confirmation: "ACTIVATE_AMAZON_ADD_V1", retailerId: "amazon" },
        summary: { action: "Activate guarded add-only execution", retailerId: "amazon" },
        correlationId: "change_atomic_failure_001",
        changeRequestId: pending.request.id
      }, () => { throw new Error("simulated protected operation failure"); }, NOW + 4_000)),
      /simulated protected operation failure/
    );
    assert.equal(runWithRequestScope(requester, () => changes.detail(pending.request.id).status), "approved");

    const consumed = runWithRequestScope(requester, () => changes.execute({
      operationType: "retailer_lane_activate",
      targetKey: "amazon",
      payload: { transientCredential: "must_never_be_retained", confirmation: "ACTIVATE_AMAZON_ADD_V1", retailerId: "amazon" },
      summary: { action: "Activate guarded add-only execution", retailerId: "amazon" },
      correlationId: "change_consume_001"
    }, () => { executions += 1; return "activated"; }, NOW + 5_000));
    assert.equal(consumed.disposition, "executed");
    assert.equal(consumed.result, "activated");
    assert.equal(consumed.request.status, "consumed");
    assert.equal(executions, 1);

    assert.throws(
      () => runWithRequestScope(requester, () => changes.execute({
        operationType: "retailer_lane_activate",
        targetKey: "amazon",
        payload: protectedPayload,
        summary: { retailerId: "amazon", action: "Activate guarded add-only execution" },
        correlationId: "change_replay_001",
        changeRequestId: pending.request.id
      }, () => { executions += 1; }, NOW + 6_000)),
      (error) => error instanceof AdminChangeControlError && error.code === "change_request_not_ready"
    );
    assert.equal(executions, 1);

    const durable = JSON.stringify({
      requests: db.all("SELECT * FROM admin_change_requests"),
      decisions: db.all("SELECT * FROM admin_change_decisions"),
      events: db.all("SELECT * FROM admin_change_events")
    });
    assert.equal(durable.includes("must_never_be_retained"), false);
    assert.throws(() => db.run("UPDATE admin_change_decisions SET decision = 'reject'"), /append-only/);
    assert.throws(() => db.run("DELETE FROM admin_change_events"), /append-only/);
    assert.ok(Number(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type LIKE 'admin_change_%'"
    )?.count ?? 0) >= 3);
  } finally {
    db.close();
  }
});

test("step-up-only and local changes execute immediately while tenant and expiry boundaries stay closed", () => {
  const db = new YoinkDatabase();
  try {
    provisionUser(db, "user_approver", "Independent approver");
    const changes = new AdminChangeControlRepository(db, { requestTtlSeconds: 60 });
    const requester = scope(LOCAL_USER_ID, "actor_requester");
    const approver = scope("user_approver", "actor_approver");
    let executions = 0;

    const staleRequester = {
      ...requester,
      authenticationTime: Math.floor((NOW - 301_000) / 1_000)
    };
    assert.throws(
      () => runWithRequestScope(staleRequester, () => changes.execute({
        operationType: "affiliate_policy_replace",
        targetKey: "tenant_policies",
        payload: { policies: [] },
        summary: { policyCount: 0, enabledCount: 0, action: "Replace affiliate policies" },
        correlationId: "change_stale_step_up_001"
      }, () => { executions += 1; }, NOW)),
      (error) => error instanceof AdminChangeControlError && error.code === "step_up_expired"
    );
    assert.equal(executions, 0);

    const steppedUp = runWithRequestScope(requester, () => changes.execute({
      operationType: "affiliate_policy_replace",
      targetKey: "tenant_policies",
      payload: { policies: [] },
      summary: { policyCount: 0, enabledCount: 0, action: "Replace affiliate policies" },
      correlationId: "change_step_up_001"
    }, () => { executions += 1; return "saved"; }, NOW));
    assert.equal(steppedUp.disposition, "executed");
    assert.equal(steppedUp.request.requestedAssurance, "step_up");

    const local = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => changes.execute({
      operationType: "global_actions_resume",
      targetKey: "global_actions",
      payload: { paused: false },
      summary: { action: "Resume global purchase actions" },
      correlationId: "change_local_001"
    }, () => { executions += 1; return "resumed"; }, NOW + 1_000));
    assert.equal(local.disposition, "executed");
    assert.equal(local.request.requestedAssurance, "local_trusted");
    assert.equal(local.request.events[0]?.eventType, "local_trusted_consumed");

    const expiring = runWithRequestScope(requester, () => changes.execute({
      operationType: "retailer_lane_activate",
      targetKey: "bestbuy",
      payload: { retailerId: "bestbuy" },
      summary: { retailerId: "bestbuy", action: "Activate guarded add-only execution" },
      correlationId: "change_expiring_001"
    }, () => { executions += 1; }, NOW + 2_000));
    assert.equal(expiring.disposition, "pending_approval");
    assert.throws(
      () => runWithRequestScope(approver, () => changes.decide(expiring.request.id, {
        decision: "approve",
        confirmation: "APPROVE_HIGH_RISK_CHANGE"
      }, "change_expired_001", NOW + 63_000)),
      (error) => error instanceof AdminChangeControlError && error.code === "change_request_expired"
    );
    assert.equal(runWithRequestScope(approver, () => changes.detail(expiring.request.id).status), "expired");
    assert.equal(executions, 2);
    const counts = runWithRequestScope(requester, () => changes.counts(NOW + 64_000));
    assert.deepEqual(counts, { total: 3, pending: 0, approved: 0, consumed: 2, rejected: 0, expired: 1 });
  } finally {
    db.close();
  }
});

test("an untouched expired request closes before an exact replacement is created", () => {
  const db = new YoinkDatabase();
  try {
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => new AuthorizationRepository(db).grantRole(LOCAL_USER_ID, "security_admin"));
    const changes = new AdminChangeControlRepository(db, { requestTtlSeconds: 60 });
    const requester = scope(LOCAL_USER_ID, "actor_requester");
    const input = {
      operationType: "retailer_lane_activate" as const,
      targetKey: "amazon",
      payload: { retailerId: "amazon", confirmation: "EXACT_RETRY" },
      summary: { retailerId: "amazon", action: "Activate guarded add-only execution" },
      correlationId: "change_expiry_rollover_001"
    };
    const first = runWithRequestScope(requester, () => changes.execute(input, () => "unexpected", NOW));
    assert.equal(first.disposition, "pending_approval");

    const replacement = runWithRequestScope(requester, () => changes.execute({
      ...input,
      correlationId: "change_expiry_rollover_002"
    }, () => "unexpected", NOW + 61_000));
    assert.equal(replacement.disposition, "pending_approval");
    assert.notEqual(replacement.request.id, first.request.id);
    assert.equal(runWithRequestScope(requester, () => changes.detail(first.request.id).status), "expired");
    assert.deepEqual(runWithRequestScope(requester, () => changes.counts(NOW + 61_000)), {
      total: 2,
      pending: 1,
      approved: 0,
      consumed: 0,
      rejected: 0,
      expired: 1
    });
  } finally {
    db.close();
  }
});
