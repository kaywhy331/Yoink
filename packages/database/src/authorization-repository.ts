import { newId, nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope, isExactLocalRequestScope, ownedIdForUser } from "./request-scope.js";

export const AUTHORIZATION_PERMISSIONS = Object.freeze([
  "user.read",
  "user.intent.manage",
  "user.settings.manage",
  "user.device.manage",
  "user.community.manage",
  "user.catalog.propose",
  "user.attribution.manage",
  "user.privacy.export",
  "admin.read",
  "admin.users.read",
  "admin.users.support",
  "admin.users.manage",
  "admin.maintainer",
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
  "worker.manage",
  "change.approve",
  "internal.delivery",
  "internal.eligibility",
  "internal.principal",
  "device.self"
] as const);

export type AuthorizationPermission = typeof AUTHORIZATION_PERMISSIONS[number];

const PERMISSION_SET = new Set<string>(AUTHORIZATION_PERMISSIONS);
const FIXED_ACTOR_PERMISSIONS = {
  device: ["device.self"]
} as const satisfies Readonly<Record<"device", readonly AuthorizationPermission[]>>;
const ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const USER_ONLINE_WINDOW_MS = 2 * 60_000;

const USER_SOURCE_DEFAULTS = [
  ["trackalacker", "TrackaLacker", "trusted_exact", 1],
  ["browser", "Browser observations", "trusted_exact", 1],
  ["discord", "Discord", "informational", 0]
] as const;

const USER_ATTRIBUTION_DEFAULTS = [
  ["target", "howl", "collectwithdodo", "", ""],
  ["walmart", "howl", "collectwithdodo", "", ""],
  ["amazon", "amazon_associates", "", "", "pokemon-restocks-20"],
  ["bestbuy", "canonical", "", "", ""],
  ["disney", "canonical", "", "", ""],
  ["ravensburger", "canonical", "", "", ""],
  ["riot", "canonical", "", "", ""],
  ["booksamillion", "canonical", "", "", ""],
  ["fanatics", "canonical", "", "", ""],
  ["kohls", "canonical", "", "", ""],
  ["macys", "canonical", "", "", ""],
  ["pbandai", "canonical", "", "", ""],
  ["pokemoncenter", "canonical", "", "", ""],
  ["asus", "canonical", "", "", ""],
  ["audioadvice", "canonical", "", "", ""],
  ["bananarepublic", "canonical", "", "", ""],
  ["bananarepublicfactory", "canonical", "", "", ""],
  ["athleta", "canonical", "", "", ""],
  ["americaneagle", "canonical", "", "", ""],
  ["aninebing", "canonical", "", "", ""]
] as const;

export function initializeTenantUserWorkspace(
  db: YoinkDatabase,
  input: { tenantId: string; userId: string; actorId: string; pauseReason: string },
  now = Date.now()
): void {
  const timestamp = nowIso(now);
  db.run(
    `INSERT OR IGNORE INTO authorization_memberships(
       tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
     ) VALUES (?, ?, 'yoink_user', 'active', ?, ?, ?)`,
    input.tenantId, input.userId, input.actorId, timestamp, timestamp
  );
  db.run(
    `INSERT OR IGNORE INTO app_settings(
       user_id, actions_paused, pause_reason, execution_mode,
       dedupe_window_seconds, affiliate_mode, tax_bps,
       store_allowances_json, updated_at
     ) VALUES (?, 1, ?, 'shadow', 300, 'prefer_fallback', 1200,
       '{"target":3000,"walmart":3000,"amazon":3000,"bestbuy":3000}', ?)`,
    input.userId, cleanText(input.pauseReason, 240) || "First-run safety pause", timestamp
  );
  db.run(
    `INSERT OR IGNORE INTO user_spend_policies(
       user_id, tenant_id, revision, currency, per_order_cap_cents,
       daily_cap_cents, monthly_cap_cents, order_submission_enabled,
       created_at, updated_at
     ) VALUES (?, ?, 1, 'USD', NULL, NULL, NULL, 0, ?, ?)`,
    input.userId, input.tenantId, timestamp, timestamp
  );
  db.run(
    `INSERT OR IGNORE INTO operator_alert_rules(
       id, tenant_id, event_family, name, enabled, severity,
       minimum_occurrences, dedupe_window_seconds, escalation_after_seconds,
       retailer_scope, operation_scope, routes_json, privacy_classification,
       created_by_actor_id, updated_by_actor_id, created_at, updated_at
     ) VALUES (?, ?, 'adapter_repair', 'All adapter repair failures', 1, 'warning',
               1, 900, 3600, '*', '*', '["dashboard","audit_outbox"]',
               'operational_configuration', ?, ?, ?, ?)`,
    ownedIdForUser("alert_rule_adapter_repair", input.userId, "alert_rule_adapter_repair_local"),
    input.tenantId, input.actorId, input.actorId, timestamp, timestamp
  );
  for (const [source, name, trust, autoCreate] of USER_SOURCE_DEFAULTS) {
    db.run(
      `INSERT OR IGNORE INTO source_connections(
         id, tenant_id, user_id, source, name, status, trust_level,
         auto_create_missions, is_private, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'disconnected', ?, ?, 1, ?, ?)`,
      ownedIdForUser(`source_${source}`, input.userId, `source_${source}_local`),
      input.tenantId, input.userId, source, name, trust, autoCreate, timestamp, timestamp
    );
  }
  for (const [retailerId, provider, publisherSlug, articleBaseUrl, associateTag] of USER_ATTRIBUTION_DEFAULTS) {
    db.run(
      `INSERT OR IGNORE INTO attribution_policies(
         id, tenant_id, user_id, retailer_id, enabled, provider,
         publisher_slug, article_base_url, associate_tag, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      ownedIdForUser(`attribution_${retailerId}`, input.userId, `attribution_${retailerId}_local`),
      input.tenantId, input.userId, retailerId, provider, publisherSlug,
      articleBaseUrl, associateTag, timestamp, timestamp
    );
  }
  const defaultStrategy = {
    id: ownedIdForUser("strategy_default_notify", input.userId, "strategy_default_notify"),
    name: "Default catchall",
    enabled: true,
    position: 1_000,
    revision: 1,
    sources: [],
    retailers: [],
    pricePolicy: { kind: "any" },
    sellerPolicy: "first_party_only",
    allowedSellers: [],
    includeKeywords: "",
    excludeKeywords: "",
    action: "notify",
    quantity: 1,
    fulfillment: "shipping",
    maxSignalAgeSeconds: 120
  };
  db.run(
    `INSERT OR IGNORE INTO strategies(
       id, tenant_id, user_id, name, enabled, position, revision,
       definition_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, ?)`,
    defaultStrategy.id, input.tenantId, input.userId, defaultStrategy.name,
    defaultStrategy.position, JSON.stringify(defaultStrategy), timestamp, timestamp
  );
}

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

export interface TenantUserSummary {
  id: string;
  displayName: string;
  status: "active" | "disabled";
  createdAt: string;
  lastActivityAt: string;
  planCount: number;
  onlineDevices: number;
  activeRoles: string[];
}

export interface TenantUserDetail {
  user: TenantUserSummary;
  actionSettings: {
    paused: boolean;
    pauseReason: string;
    executionMode: "shadow" | "live";
  };
  plans: Array<{
    id: string;
    title: string;
    status: string;
    targetQuantity: number;
    fulfilledQuantity: number;
    updatedAt: string;
  }>;
  actions: Array<{
    id: string;
    title: string;
    retailerId: string;
    state: string;
    action: string;
    maximumCents: number | null;
    currency: string;
    updatedAt: string;
  }>;
  devices: Array<{
    id: string;
    name: string;
    status: string;
    extensionVersion: string;
    lastSeenAt: string;
    online: boolean;
  }>;
  reviews: Array<{
    id: string;
    kind: string;
    title: string;
    retailerId: string;
    retailerSku: string;
    status: string;
    createdAt: string;
  }>;
  spend: {
    currency: string;
    perOrderCapCents: number | null;
    dailyCapCents: number | null;
    monthlyCapCents: number | null;
    committedCents: number;
    activeReservedCents: number;
  };
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
    if (scope.actorKind === "device") return [...FIXED_ACTOR_PERMISSIONS.device];
    if (scope.actorKind === "service") {
      return scope.internalServiceCapability ? [scope.internalServiceCapability] : [];
    }
    return this.db.all<{ permissionId: string }>(
      `SELECT DISTINCT rp.permission_id AS permissionId
       FROM authorization_memberships m
       JOIN authorization_role_permissions rp ON rp.role_id = m.role_id
       JOIN users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
       WHERE m.tenant_id = ? AND m.user_id = ? AND m.status = 'active'
         AND u.status = 'active'
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

  tenantUsers(query = "", now = Date.now()): TenantUserSummary[] {
    this.require("admin.users.read");
    const scope = currentRequestScope();
    const search = cleanText(query, 120);
    return this.db.all<{
      id: string;
      displayName: string;
      status: "active" | "disabled";
      createdAt: string;
      lastActivityAt: string;
      planCount: number;
      onlineDevices: number;
      activeRolesJson: string;
    }>(
      `SELECT u.id, u.display_name AS displayName, u.status, u.created_at AS createdAt,
              MAX(
                u.created_at,
                COALESCE((SELECT MAX(job.updated_at) FROM action_jobs job
                          WHERE job.tenant_id = u.tenant_id AND job.user_id = u.id), ''),
                COALESCE((SELECT MAX(device.last_seen_at) FROM extension_devices device
                          WHERE device.tenant_id = u.tenant_id AND device.user_id = u.id), '')
              ) AS lastActivityAt,
              (SELECT COUNT(*) FROM missions mission
               WHERE mission.tenant_id = u.tenant_id AND mission.user_id = u.id
                 AND mission.status <> 'deleted') AS planCount,
              (SELECT COUNT(*) FROM extension_devices device
               WHERE device.tenant_id = u.tenant_id AND device.user_id = u.id
                 AND device.status = 'active' AND device.last_seen_at >= ?) AS onlineDevices,
              COALESCE(json_group_array(m.role_id) FILTER (WHERE m.status = 'active'), '[]') AS activeRolesJson
       FROM users u
       LEFT JOIN authorization_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
       WHERE u.tenant_id = ? AND (? = '' OR lower(u.display_name) LIKE '%' || lower(?) || '%'
         OR lower(u.id) LIKE '%' || lower(?) || '%')
       GROUP BY u.id, u.display_name, u.status, u.created_at
       ORDER BY CASE u.status WHEN 'active' THEN 0 ELSE 1 END, u.display_name, u.id
       LIMIT 100`,
      nowIso(now - USER_ONLINE_WINDOW_MS), scope.tenantId, search, search, search
    ).map((row) => ({
      id: row.id,
      displayName: row.displayName,
      status: row.status,
      createdAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
      planCount: Number(row.planCount),
      onlineDevices: Number(row.onlineDevices),
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

  tenantUserDetail(userId: string, now = Date.now()): TenantUserDetail {
    this.require("admin.users.read");
    const subjectUserId = validId(userId, "tenant user ID");
    this.requireTenantUser(subjectUserId);
    const user = this.tenantUsers("", now).find((candidate) => candidate.id === subjectUserId);
    if (!user) throw new AuthorizationError("authorization_subject_not_found", 404, "The tenant user does not exist.");
    const scope = currentRequestScope();
    const actionSettings = this.db.get<{
      paused: number;
      pauseReason: string;
      executionMode: string;
    }>(
      `SELECT actions_paused AS paused, pause_reason AS pauseReason,
              execution_mode AS executionMode
       FROM app_settings WHERE user_id = ?`,
      subjectUserId
    ) ?? { paused: 1, pauseReason: "First-run safety pause", executionMode: "shadow" };
    const plans = this.db.all<TenantUserDetail["plans"][number]>(
      `SELECT mission.id, variant.title, mission.status,
              mission.target_quantity AS targetQuantity,
              mission.fulfilled_quantity AS fulfilledQuantity,
              mission.updated_at AS updatedAt
       FROM missions mission
       JOIN variants variant ON variant.id = mission.variant_id
       WHERE mission.tenant_id = ? AND mission.user_id = ? AND mission.status <> 'deleted'
       ORDER BY mission.updated_at DESC, mission.id DESC LIMIT 100`,
      scope.tenantId, subjectUserId
    ).map((plan) => ({
      ...plan,
      targetQuantity: Number(plan.targetQuantity),
      fulfilledQuantity: Number(plan.fulfilledQuantity)
    }));
    const actions = this.db.all<TenantUserDetail["actions"][number]>(
      `SELECT job.id, variant.title, listing.retailer_id AS retailerId,
              job.state, job.action, job.max_order_total_cents AS maximumCents,
              job.currency, job.updated_at AS updatedAt
       FROM action_jobs job
       JOIN listings listing ON listing.id = job.listing_id
       JOIN variants variant ON variant.id = listing.variant_id
       WHERE job.tenant_id = ? AND job.user_id = ?
       ORDER BY job.updated_at DESC, job.id DESC LIMIT 100`,
      scope.tenantId, subjectUserId
    ).map((action) => ({
      ...action,
      maximumCents: action.maximumCents === null ? null : Number(action.maximumCents)
    }));
    const devices = this.db.all<{
      id: string;
      name: string;
      status: string;
      extensionVersion: string;
      lastSeenAt: string;
    }>(
      `SELECT id, name, status, extension_version AS extensionVersion,
              last_seen_at AS lastSeenAt
       FROM extension_devices
       WHERE tenant_id = ? AND user_id = ?
       ORDER BY updated_at DESC, id DESC`,
      scope.tenantId, subjectUserId
    ).map((device) => ({
      ...device,
      online: device.status === "active"
        && new Date(device.lastSeenAt).getTime() >= now - USER_ONLINE_WINDOW_MS
    }));
    const reviews = this.db.all<TenantUserDetail["reviews"][number]>(
      `SELECT id, proposal_kind AS kind,
              COALESCE(json_extract(payload_json, '$.title'), 'Catalog review') AS title,
              retailer_id AS retailerId, retailer_sku AS retailerSku,
              status, created_at AS createdAt
       FROM catalog_change_proposals
       WHERE tenant_id = ? AND proposer_user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      scope.tenantId, subjectUserId
    );
    const spend = this.db.get<{
      currency: string;
      perOrderCapCents: number | null;
      dailyCapCents: number | null;
      monthlyCapCents: number | null;
      committedCents: number;
      activeReservedCents: number;
    }>(
      `SELECT policy.currency,
              policy.per_order_cap_cents AS perOrderCapCents,
              policy.daily_cap_cents AS dailyCapCents,
              policy.monthly_cap_cents AS monthlyCapCents,
              COALESCE((SELECT SUM(entry.spent_delta_cents) FROM spend_ledger_entries entry
                        WHERE entry.tenant_id = policy.tenant_id AND entry.user_id = policy.user_id), 0) AS committedCents,
              COALESCE((SELECT SUM(reservation.reserved_amount_cents) FROM spend_reservations reservation
                        WHERE reservation.tenant_id = policy.tenant_id AND reservation.user_id = policy.user_id
                          AND reservation.status = 'active'), 0) AS activeReservedCents
       FROM user_spend_policies policy
       WHERE policy.tenant_id = ? AND policy.user_id = ?`,
      scope.tenantId, subjectUserId
    ) ?? {
      currency: "USD",
      perOrderCapCents: null,
      dailyCapCents: null,
      monthlyCapCents: null,
      committedCents: 0,
      activeReservedCents: 0
    };
    return {
      user,
      actionSettings: {
        paused: actionSettings.paused === 1,
        pauseReason: actionSettings.pauseReason,
        executionMode: actionSettings.executionMode === "live" ? "live" : "shadow"
      },
      plans,
      actions,
      devices,
      reviews,
      spend: {
        ...spend,
        perOrderCapCents: spend.perOrderCapCents === null ? null : Number(spend.perOrderCapCents),
        dailyCapCents: spend.dailyCapCents === null ? null : Number(spend.dailyCapCents),
        monthlyCapCents: spend.monthlyCapCents === null ? null : Number(spend.monthlyCapCents),
        committedCents: Number(spend.committedCents),
        activeReservedCents: Number(spend.activeReservedCents)
      }
    };
  }

  createTenantUser(input: { displayName: unknown }, now = Date.now()): TenantUserDetail {
    this.require("admin.users.manage");
    const scope = currentRequestScope();
    const displayName = cleanText(input?.displayName, 120);
    if (displayName.length < 2) {
      throw new AuthorizationError("authorization_input_invalid", 400, "A user display name is required.");
    }
    const userId = newId("user");
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO users(id, tenant_id, display_name, created_at, status)
         VALUES (?, ?, ?, ?, 'active')`,
        userId, scope.tenantId, displayName, timestamp
      );
      initializeTenantUserWorkspace(this.db, {
        tenantId: scope.tenantId,
        userId,
        actorId: scope.actorId,
        pauseReason: "Admin-created first-run safety pause"
      }, now);
      this.audit.record({
        correlationId: userId,
        aggregateType: "tenant_user",
        eventType: "tenant_user_created",
        reasonCode: "administrator_created",
        message: "An administrator created a tenant user in a paused first-run state.",
        data: { subjectUserId: userId, displayName, initialRoleId: "yoink_user" }
      }, now);
    });
    return this.tenantUserDetail(userId, now);
  }

  setTenantUserActionsPaused(userId: string, paused: boolean, now = Date.now()): TenantUserDetail {
    this.require("admin.users.support");
    const subjectUserId = validId(userId, "tenant user ID");
    this.requireTenantUser(subjectUserId);
    const scope = currentRequestScope();
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        `UPDATE app_settings SET actions_paused = ?,
           pause_reason = ?, updated_at = ?
         WHERE user_id = ?`,
        paused ? 1 : 0,
        paused ? "Paused by tenant support" : "Resumed by tenant support",
        timestamp,
        subjectUserId
      );
      this.audit.record({
        correlationId: subjectUserId,
        aggregateType: "tenant_user",
        eventType: paused ? "tenant_user_actions_paused" : "tenant_user_actions_resumed",
        reasonCode: paused ? "administrator_support_pause" : "administrator_support_resume",
        message: paused
          ? "Tenant support paused a user's store actions."
          : "Tenant support resumed a user's eligible store actions.",
        data: { subjectUserId, actorId: scope.actorId, paused }
      }, now);
    });
    return this.tenantUserDetail(subjectUserId, now);
  }

  pauseTenantUserActions(userId: string, now = Date.now()): TenantUserDetail {
    return this.setTenantUserActionsPaused(userId, true, now);
  }

  setTenantUserStatus(userId: string, status: "active" | "disabled", now = Date.now()): TenantUserDetail {
    this.require("admin.users.manage");
    if (!(status === "active" || status === "disabled")) {
      throw new AuthorizationError("authorization_input_invalid", 400, "Choose active or disabled user status.");
    }
    const subjectUserId = validId(userId, "tenant user ID");
    const scope = currentRequestScope();
    this.requireTenantUser(subjectUserId);
    if (status === "disabled" && subjectUserId === scope.userId) {
      throw new AuthorizationError("permission_denied", 403, "You cannot disable your own signed-in user.");
    }
    const timestamp = nowIso(now);
    this.db.transaction(() => {
      this.db.run(
        "UPDATE users SET status = ? WHERE tenant_id = ? AND id = ?",
        status, scope.tenantId, subjectUserId
      );
      if (status === "disabled") {
        this.db.run(
          `UPDATE app_settings SET actions_paused = 1,
             pause_reason = 'User disabled by tenant administrator', updated_at = ?
           WHERE user_id = ?`,
          timestamp, subjectUserId
        );
        this.db.run(
          `UPDATE extension_devices SET status = 'revoked',
             token_hash = 'revoked:' || id || ':' || ?,
             pending_token_hash = '', pending_token_generation = 0, pending_token_expires_at = '',
             previous_token_hash = '', previous_token_expires_at = '', updated_at = ?
           WHERE tenant_id = ? AND user_id = ? AND status <> 'revoked'`,
          timestamp, timestamp, scope.tenantId, subjectUserId
        );
        this.db.run(
          "UPDATE device_pairing_codes SET used_at = ? WHERE tenant_id = ? AND user_id = ? AND used_at = ''",
          timestamp, scope.tenantId, subjectUserId
        );
      }
      this.audit.record({
        correlationId: subjectUserId,
        aggregateType: "tenant_user",
        eventType: status === "disabled" ? "tenant_user_disabled" : "tenant_user_enabled",
        reasonCode: status === "disabled" ? "administrator_disabled" : "administrator_enabled",
        message: status === "disabled"
          ? "A tenant user was disabled and their Chrome credentials were revoked."
          : "A tenant user was enabled; prior Chrome credentials remain revoked.",
        data: { subjectUserId, status, actorId: scope.actorId }
      }, now);
    });
    return this.tenantUserDetail(subjectUserId, now);
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
