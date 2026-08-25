import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { AuthorizationRepository } from "../packages/database/src/authorization-repository.js";
import { AttributionRepository } from "../packages/database/src/attribution-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";

function humanScope(tenantId: string, userId: string, actorId: string, assurance: "baseline" | "step_up"): RequestScope {
  return {
    tenantId,
    userId,
    actorKind: "user",
    actorId,
    authenticationAssurance: assurance,
    authenticationTime: Math.floor(Date.now() / 1_000) - 5,
    sessionId: `session_${actorId}`
  };
}

function insertUser(db: YoinkDatabase, tenantId: string, userId: string, displayName: string, roles: string[]): void {
  const timestamp = new Date().toISOString();
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)", userId, tenantId, displayName, timestamp);
  for (const role of roles) {
    db.run(
      `INSERT INTO authorization_memberships(
         tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'active', 'test_fixture', ?, ?)`,
      tenantId,
      userId,
      role,
      timestamp,
      timestamp
    );
  }
}

test("hosted high-risk APIs require signed step-up, independent approval, exact retry, and tenant isolation", async () => {
  const db = new YoinkDatabase();
  const authorization = new AuthorizationRepository(db);
  runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
    authorization.grantRole(LOCAL_USER_ID, "security_admin");
    authorization.grantRole(LOCAL_USER_ID, "affiliate_manager");
  });
  insertUser(db, LOCAL_TENANT_ID, "user_approver", "Independent approver", ["security_admin"]);
  insertUser(db, LOCAL_TENANT_ID, "user_subject", "Role recipient", ["yoink_user"]);
  const timestamp = new Date().toISOString();
  db.run("INSERT INTO tenants(id, name, created_at) VALUES ('tenant_other', 'Other tenant', ?)", timestamp);
  insertUser(db, "tenant_other", "user_other_admin", "Other administrator", ["security_admin"]);

  const scopes = {
    requesterBaseline: humanScope(LOCAL_TENANT_ID, LOCAL_USER_ID, "actor_requester_baseline", "baseline"),
    requesterStepUp: humanScope(LOCAL_TENANT_ID, LOCAL_USER_ID, "actor_requester_stepup", "step_up"),
    approverStepUp: humanScope(LOCAL_TENANT_ID, "user_approver", "actor_approver_stepup", "step_up"),
    otherStepUp: humanScope("tenant_other", "user_other_admin", "actor_other_stepup", "step_up")
  };
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "change-control-api-test",
    requestScopeResolver(request) {
      const principal = String(request.headers["x-test-principal"] ?? "");
      const resolved = scopes[principal as keyof typeof scopes];
      if (!resolved) throw new Error("Authenticated request scope is required.");
      return resolved;
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const rolePath = "/api/v1/admin/authorization/users/user_subject/roles/support_readonly";
  const attributionPolicies = runWithRequestScope(LOCAL_REQUEST_SCOPE, () => new AttributionRepository(db).listPolicies())
    .map((policy) => ({
      retailerId: policy.retailerId,
      enabled: policy.enabled,
      provider: policy.provider,
      publisherSlug: policy.publisherSlug,
      articleBaseUrl: policy.articleBaseUrl,
      associateTag: policy.associateTag
    }));
  const mutationHeaders = (principal: string, additional: Record<string, string> = {}) => ({
    "X-Test-Principal": principal,
    Origin: baseUrl,
    ...additional
  });

  try {
    const baseline = await fetch(`${baseUrl}${rolePath}`, {
      method: "POST",
      headers: mutationHeaders("requesterBaseline")
    });
    assert.equal(baseline.status, 403);
    assert.equal((await baseline.json() as { error: string }).error, "step_up_required");

    const proposed = await fetch(`${baseUrl}${rolePath}`, {
      method: "POST",
      headers: mutationHeaders("requesterStepUp")
    });
    assert.equal(proposed.status, 202);
    assert.equal(proposed.headers.get("x-yoink-api-surface"), "admin");
    const proposal = await proposed.json() as {
      disposition: string;
      changeRequest: { id: string; status: string; controlLevel: string; summary: Record<string, unknown> };
    };
    assert.equal(proposal.disposition, "pending_approval");
    assert.equal(proposal.changeRequest.status, "pending");
    assert.equal(proposal.changeRequest.controlLevel, "two_person");
    assert.deepEqual(proposal.changeRequest.summary, {
      action: "Grant role",
      roleId: "support_readonly",
      subjectUserId: "user_subject"
    });
    assert.equal(runWithRequestScope(LOCAL_REQUEST_SCOPE, () => authorization.memberships("user_subject"))
      .some((membership) => membership.roleId === "support_readonly" && membership.status === "active"), false);

    const queue = await fetch(`${baseUrl}/api/v1/admin/change-requests`, {
      headers: { "X-Test-Principal": "requesterBaseline" }
    });
    assert.equal(queue.status, 200);
    assert.equal(queue.headers.get("x-yoink-api-surface"), "admin");
    const queueBody = await queue.json() as {
      items: Array<{ id: string }>;
      assurance: { level: string; fresh: boolean };
      approvalCapable: boolean;
    };
    assert.deepEqual(queueBody.items.map((item) => item.id), [proposal.changeRequest.id]);
    assert.deepEqual(queueBody.assurance, { level: "baseline", fresh: false, expiresAt: "" });
    assert.equal(queueBody.approvalCapable, true);

    const selfApproval = await fetch(`${baseUrl}/api/v1/admin/change-requests/${proposal.changeRequest.id}/decision`, {
      method: "POST",
      headers: {
        ...mutationHeaders("requesterStepUp"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ decision: "approve", confirmation: "APPROVE_HIGH_RISK_CHANGE" })
    });
    assert.equal(selfApproval.status, 409);
    assert.equal((await selfApproval.json() as { error: string }).error, "independent_approval_required");

    const approval = await fetch(`${baseUrl}/api/v1/admin/change-requests/${proposal.changeRequest.id}/decision`, {
      method: "POST",
      headers: {
        ...mutationHeaders("approverStepUp"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ decision: "approve", confirmation: "APPROVE_HIGH_RISK_CHANGE" })
    });
    assert.equal(approval.status, 200);
    assert.equal((await approval.json() as { request: { status: string } }).request.status, "approved");

    const crossTenant = await fetch(`${baseUrl}/api/v1/admin/change-requests/${proposal.changeRequest.id}`, {
      headers: { "X-Test-Principal": "otherStepUp" }
    });
    assert.equal(crossTenant.status, 404);
    assert.equal((await crossTenant.json() as { error: string }).error, "change_request_not_found");

    const drift = await fetch(`${baseUrl}/api/v1/admin/authorization/users/user_subject/roles/catalog_curator`, {
      method: "POST",
      headers: mutationHeaders("requesterStepUp", { "X-Yoink-Change-Request-Id": proposal.changeRequest.id })
    });
    assert.equal(drift.status, 409);
    assert.equal((await drift.json() as { error: string }).error, "change_request_mismatch");

    const executed = await fetch(`${baseUrl}${rolePath}`, {
      method: "POST",
      headers: mutationHeaders("requesterStepUp")
    });
    assert.equal(executed.status, 200);
    assert.equal((await executed.json() as { memberships: Array<{ roleId: string; status: string }> }).memberships
      .some((membership) => membership.roleId === "support_readonly" && membership.status === "active"), true);

    const replay = await fetch(`${baseUrl}${rolePath}`, {
      method: "POST",
      headers: mutationHeaders("requesterStepUp", { "X-Yoink-Change-Request-Id": proposal.changeRequest.id })
    });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json() as { error: string }).error, "change_request_not_ready");

    const baselineAffiliate = await fetch(`${baseUrl}/api/v1/admin/attribution-policies`, {
      method: "PUT",
      headers: {
        ...mutationHeaders("requesterBaseline"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ policies: attributionPolicies })
    });
    assert.equal(baselineAffiliate.status, 403);
    assert.equal((await baselineAffiliate.json() as { error: string }).error, "step_up_required");

    const steppedUpAffiliate = await fetch(`${baseUrl}/api/v1/admin/attribution-policies`, {
      method: "PUT",
      headers: {
        ...mutationHeaders("requesterStepUp"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ policies: attributionPolicies })
    });
    const steppedUpAffiliateBody = await steppedUpAffiliate.json();
    assert.equal(steppedUpAffiliate.status, 200, JSON.stringify(steppedUpAffiliateBody));
    assert.equal(steppedUpAffiliate.headers.get("x-yoink-api-surface"), "admin");
    assert.equal(Array.isArray((steppedUpAffiliateBody as { policies?: unknown }).policies), true);

    const finalQueue = await fetch(`${baseUrl}/api/v1/admin/change-requests`, {
      headers: { "X-Test-Principal": "requesterStepUp" }
    }).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      counts: { total: number; consumed: number; pending: number };
    };
    assert.equal(finalQueue.counts.total, 2);
    assert.equal(finalQueue.counts.consumed, 2);
    assert.equal(finalQueue.counts.pending, 0);
    assert.equal(JSON.stringify(finalQueue).includes("payloadHash"), false);

    const snapshot = await fetch(`${baseUrl}/api/v1/admin/snapshot`, {
      headers: { "X-Test-Principal": "requesterStepUp" }
    }).then((response) => response.json()) as {
      counts: Record<string, number>;
      capabilities: Record<string, boolean>;
      authorization: { assurance: { level: string; fresh: boolean }; changeApprovalEnabled: boolean };
    };
    assert.equal(snapshot.counts.adminChangeRequests, 2);
    assert.equal(snapshot.capabilities.signedAuthenticationAssurance, true);
    assert.equal(snapshot.capabilities.highRiskChangeControl, true);
    assert.equal(snapshot.capabilities.independentSafetyExpansionApproval, true);
    assert.equal(snapshot.capabilities.productionIdentityProvider, false);
    assert.equal(snapshot.authorization.assurance.level, "step_up");
    assert.equal(snapshot.authorization.assurance.fresh, true);
    assert.equal(snapshot.authorization.changeApprovalEnabled, true);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
