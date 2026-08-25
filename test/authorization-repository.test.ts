import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORIZATION_PERMISSIONS,
  AuthorizationError,
  AuthorizationRepository
} from "../packages/database/src/authorization-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import {
  HOSTED_PRINCIPAL_CONFIRMATION,
  PrincipalRepository
} from "../packages/database/src/principal-repository.js";
import {
  LOCAL_REQUEST_SCOPE,
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-24T12:00:00.000Z").getTime();
const SERVICE_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "identity_sync"
};
const SECOND_SCOPE: RequestScope = {
  tenantId: "tenant_second",
  userId: "user_second",
  actorKind: "user",
  actorId: "user_second"
};

function provisionSecond(db: YoinkDatabase): void {
  runWithRequestScope(SERVICE_SCOPE, () => new PrincipalRepository(db).provision({
    tenantId: SECOND_SCOPE.tenantId,
    userId: SECOND_SCOPE.userId,
    tenantName: "Second tenant",
    displayName: "Second user",
    confirmation: HOSTED_PRINCIPAL_CONFIRMATION
  }, NOW));
}

test("authorization is persisted, tenant-scoped, and deny-by-default outside the exact local bootstrap", () => {
  const db = new YoinkDatabase();
  try {
    provisionSecond(db);
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
      const authorization = new AuthorizationRepository(db);
      assert.deepEqual(authorization.permissions(), [...AUTHORIZATION_PERMISSIONS]);
      assert.equal(authorization.has("security.manage"), true);
    });

    runWithRequestScope(SECOND_SCOPE, () => {
      const authorization = new AuthorizationRepository(db);
      assert.equal(authorization.has("user.read"), true);
      assert.equal(authorization.has("user.intent.manage"), true);
      assert.equal(authorization.has("user.privacy.export"), true);
      assert.equal(authorization.has("admin.read"), false);
      assert.equal(authorization.has("security.manage"), false);
      assert.deepEqual(authorization.memberships().map((membership) => membership.roleId), ["yoink_user"]);
      assert.throws(
        () => authorization.require("catalog.review"),
        (error) => error instanceof AuthorizationError && error.code === "permission_denied" && error.status === 403
      );
    });

    const forgedMaintainer = { ...SECOND_SCOPE, actorKind: "maintainer" as const, actorId: "forged_maintainer" };
    runWithRequestScope(forgedMaintainer, () => {
      assert.equal(new AuthorizationRepository(db).has("security.manage"), false);
    });

    const hostedLocalImpersonation: RequestScope = {
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID,
      actorKind: "maintainer",
      actorId: "local_control_center"
    };
    runWithRequestScope(hostedLocalImpersonation, () => {
      assert.equal(new AuthorizationRepository(db).has("security.manage"), false);
    });
  } finally {
    db.close();
  }
});

test("role grants and revocations take effect while cross-tenant identifiers remain hidden", () => {
  const db = new YoinkDatabase();
  try {
    provisionSecond(db);
    runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
      const authorization = new AuthorizationRepository(db);
      authorization.grantRole(LOCAL_USER_ID, "catalog_curator", NOW + 1);
      assert.equal(authorization.memberships().some((membership) => membership.roleId === "catalog_curator" && membership.status === "active"), true);
      assert.throws(
        () => authorization.grantRole(SECOND_SCOPE.userId, "catalog_curator", NOW + 2),
        (error) => error instanceof AuthorizationError && error.code === "authorization_subject_not_found" && error.status === 404
      );
      authorization.revokeRole(LOCAL_USER_ID, "catalog_curator", NOW + 3);
      assert.equal(authorization.memberships().find((membership) => membership.roleId === "catalog_curator")?.status, "revoked");
      assert.throws(() => authorization.revokeRole(LOCAL_USER_ID, "yoink_user"), /baseline Yoink user role/);
    });
  } finally {
    db.close();
  }
});

test("device and service actors receive only their fixed capabilities", () => {
  const db = new YoinkDatabase();
  try {
    const deviceScope: RequestScope = {
      tenantId: LOCAL_TENANT_ID,
      userId: LOCAL_USER_ID,
      actorKind: "device",
      actorId: "device_companion"
    };
    runWithRequestScope(deviceScope, () => {
      const authorization = new AuthorizationRepository(db);
      assert.deepEqual(authorization.permissions(), ["device.self"]);
      assert.equal(authorization.has("user.read"), false);
    });
    runWithRequestScope(SERVICE_SCOPE, () => {
      const authorization = new AuthorizationRepository(db);
      assert.deepEqual(authorization.permissions(), ["internal.delivery", "internal.principal"]);
      assert.equal(authorization.has("admin.read"), false);
    });
  } finally {
    db.close();
  }
});
