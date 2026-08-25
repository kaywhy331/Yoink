import { nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope, isExactLocalRequestScope } from "./request-scope.js";

export const AUTHORIZATION_PERMISSIONS = Object.freeze([
  "user.read",
  "user.intent.manage",
  "user.settings.manage",
  "user.device.manage",
  "user.community.manage",
  "user.catalog.propose",
  "user.attribution.manage",
  "admin.read",
  "support.read",
  "catalog.review",
  "catalog.identity.propose",
  "catalog.identity.approve",
  "identity.review",
  "affiliate.manage",
  "retailer.manage",
  "recipe.manage",
  "qualification.manage",
  "source.manage",
  "security.manage",
  "user.lifecycle.manage",
  "alert.manage",
  "change.approve",
  "internal.delivery",
  "internal.principal",
  "device.self"
] as const);

export type AuthorizationPermission = typeof AUTHORIZATION_PERMISSIONS[number];

const PERMISSION_SET = new Set<string>(AUTHORIZATION_PERMISSIONS);
const FIXED_ACTOR_PERMISSIONS = {
  device: ["device.self"],
  service: ["internal.delivery", "internal.principal"]
} as const satisfies Readonly<Record<"device" | "service", readonly AuthorizationPermission[]>>;
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;

export class AuthorizationError extends Error {
  readonly code: "permission_denied" | "authorization_subject_not_found" | "authorization_input_invalid";
  readonly status: 400 | 403 | 404;

  constructor(
    code: AuthorizationError["code"],
    status: AuthorizationError["status"],
    message: string
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export interface AuthorizationMembership {
  tenantId: string;
  userId: string;
  roleId: string;
  roleName: string;
  status: "active" | "revoked";
  grantedByActorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizationRole {
  id: string;
  displayName: string;
  description: string;
  builtIn: boolean;
  permissions: AuthorizationPermission[];
}

function validId(value: unknown, label: string): string {
  const cleaned = cleanText(value, 120);
  if (!ID_PATTERN.test(cleaned)) {
    throw new AuthorizationError("authorization_input_invalid", 400, `The ${label} is invalid.`);
  }
  return cleaned;
}

export class AuthorizationRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  permissions(): AuthorizationPermission[] {
    const scope = currentRequestScope();
    if (isExactLocalRequestScope(scope)) return [...AUTHORIZATION_PERMISSIONS];
    if (scope.actorKind === "device" || scope.actorKind === "service") {
      return [...FIXED_ACTOR_PERMISSIONS[scope.actorKind]];
    }
    return this.db.all<{ permissionId: string }>(
      `SELECT DISTINCT rp.permission_id AS permissionId
       FROM authorization_memberships m
       JOIN authorization_role_permissions rp ON rp.role_id = m.role_id
       WHERE m.tenant_id = ? AND m.user_id = ? AND m.status = 'active'
       ORDER BY rp.permission_id`,
      scope.tenantId,
      scope.userId
    ).map((row) => row.permissionId).filter((permission): permission is AuthorizationPermission => PERMISSION_SET.has(permission));
  }

  has(permission: AuthorizationPermission): boolean {
    return this.permissions().includes(permission);
  }

  require(permission: AuthorizationPermission): void {
    if (!this.has(permission)) {
      throw new AuthorizationError(
        "permission_denied",
        403,
        `Permission ${permission} is required for this operation.`
      );
    }
  }

  memberships(userId = currentRequestScope().userId): AuthorizationMembership[] {
    const scope = currentRequestScope();
    const subjectUserId = validId(userId, "authorization user ID");
    if (subjectUserId !== scope.userId) this.require("security.manage");
    this.requireTenantUser(subjectUserId);
    return this.db.all<{
      tenantId: string;
      userId: string;
      roleId: string;
      roleName: string;
      status: "active" | "revoked";
      grantedByActorId: string;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT m.tenant_id AS tenantId, m.user_id AS userId, m.role_id AS roleId,
              r.display_name AS roleName, m.status,
              m.granted_by_actor_id AS grantedByActorId,
              m.created_at AS createdAt, m.updated_at AS updatedAt
       FROM authorization_memberships m
       JOIN authorization_roles r ON r.id = m.role_id
       WHERE m.tenant_id = ? AND m.user_id = ?
       ORDER BY r.display_name, r.id`,
      scope.tenantId,
      subjectUserId
    );
  }

  roles(): AuthorizationRole[] {
    this.require("security.manage");
    const roles = this.db.all<{
      id: string;
      displayName: string;
      description: string;
      builtIn: number;
    }>(
      `SELECT id, display_name AS displayName, description, built_in AS builtIn
       FROM authorization_roles ORDER BY display_name, id`
    );
    const permissionRows = this.db.all<{ roleId: string; permissionId: string }>(
      `SELECT role_id AS roleId, permission_id AS permissionId
       FROM authorization_role_permissions ORDER BY role_id, permission_id`
    );
    return roles.map((role) => ({
      id: role.id,
      displayName: role.displayName,
      description: role.description,
      builtIn: role.builtIn === 1,
      permissions: permissionRows
        .filter((row) => row.roleId === role.id && PERMISSION_SET.has(row.permissionId))
        .map((row) => row.permissionId as AuthorizationPermission)
    }));
  }

  tenantUsers(): Array<{ id: string; displayName: string; createdAt: string; activeRoles: string[] }> {
    this.require("security.manage");
    const scope = currentRequestScope();
    return this.db.all<{ id: string; displayName: string; createdAt: string; activeRolesJson: string }>(
      `SELECT u.id, u.display_name AS displayName, u.created_at AS createdAt,
              COALESCE(json_group_array(m.role_id) FILTER (WHERE m.status = 'active'), '[]') AS activeRolesJson
       FROM users u
       LEFT JOIN authorization_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
       WHERE u.tenant_id = ?
       GROUP BY u.id, u.display_name, u.created_at
       ORDER BY u.display_name, u.id`,
      scope.tenantId
    ).map((row) => ({
      id: row.id,
      displayName: row.displayName,
      createdAt: row.createdAt,
      activeRoles: (() => {
        try {
          const parsed = JSON.parse(row.activeRolesJson) as unknown;
          return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").sort() : [];
        } catch {
          return [];
        }
      })()
    }));
  }

  grantRole(userId: string, roleId: string, now = Date.now()): AuthorizationMembership[] {
    this.require("security.manage");
    const scope = currentRequestScope();
    const subjectUserId = validId(userId, "authorization user ID");
    const grantedRoleId = validId(roleId, "authorization role ID");
    this.requireTenantUser(subjectUserId);
    this.requireRole(grantedRoleId);
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO authorization_memberships(
           tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'active', ?, ?, ?)
         ON CONFLICT(user_id, role_id) DO UPDATE SET
           status = 'active', granted_by_actor_id = excluded.granted_by_actor_id,
           updated_at = excluded.updated_at`,
        scope.tenantId,
        subjectUserId,
        grantedRoleId,
        scope.actorId,
        timestamp,
        timestamp
      );
      this.audit.record({
        correlationId: subjectUserId,
        aggregateType: "authorization_membership",
        eventType: "authorization_role_granted",
        reasonCode: "administrator_grant",
        message: "An authorization role was granted.",
        data: { subjectUserId, roleId: grantedRoleId, actorId: scope.actorId }
      }, now);
    });
    return this.memberships(subjectUserId);
  }

  revokeRole(userId: string, roleId: string, now = Date.now()): AuthorizationMembership[] {
    this.require("security.manage");
    const scope = currentRequestScope();
    const subjectUserId = validId(userId, "authorization user ID");
    const revokedRoleId = validId(roleId, "authorization role ID");
    this.requireTenantUser(subjectUserId);
    this.requireRole(revokedRoleId);
    if (revokedRoleId === "yoink_user") {
      throw new AuthorizationError(
        "permission_denied",
        403,
        "The baseline Yoink user role cannot be revoked through role administration."
      );
    }
    const result = this.db.run(
      `UPDATE authorization_memberships
       SET status = 'revoked', updated_at = ?
       WHERE tenant_id = ? AND user_id = ? AND role_id = ? AND status = 'active'`,
      nowIso(now),
      scope.tenantId,
      subjectUserId,
      revokedRoleId
    );
    if (Number(result.changes) > 0) {
      this.audit.record({
        correlationId: subjectUserId,
        aggregateType: "authorization_membership",
        eventType: "authorization_role_revoked",
        reasonCode: "administrator_revoke",
        message: "An authorization role was revoked.",
        data: { subjectUserId, roleId: revokedRoleId, actorId: scope.actorId }
      }, now);
    }
    return this.memberships(subjectUserId);
  }

  private requireTenantUser(userId: string): void {
    const scope = currentRequestScope();
    const found = this.db.get<{ present: number }>(
      "SELECT 1 AS present FROM users WHERE tenant_id = ? AND id = ?",
      scope.tenantId,
      userId
    );
    if (!found) {
      throw new AuthorizationError(
        "authorization_subject_not_found",
        404,
        "The authorization subject does not exist in the authenticated tenant."
      );
    }
  }

  private requireRole(roleId: string): void {
    const found = this.db.get<{ present: number }>(
      "SELECT 1 AS present FROM authorization_roles WHERE id = ?",
      roleId
    );
    if (!found) {
      throw new AuthorizationError("authorization_subject_not_found", 404, "The authorization role does not exist.");
    }
  }
}
