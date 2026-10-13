import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { DomainConflictError } from "../../domain/src/domain-request-error.js";
import { nowIso } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import type { YoinkDatabase } from "./database.js";
import { AuditRepository } from "./audit-repository.js";
import { AuthorizationRepository } from "./authorization-repository.js";
import {
  currentRequestScope,
  normalizedRequestScope,
  ownedIdForUser
} from "./request-scope.js";

export const HOSTED_PRINCIPAL_CONFIRMATION = "PROVISION_HOSTED_PRINCIPAL";

export interface HostedPrincipalInput {
  tenantId: string;
  userId: string;
  tenantName: string;
  displayName: string;
  confirmation: typeof HOSTED_PRINCIPAL_CONFIRMATION;
}

const ATTRIBUTION_DEFAULTS = [
  ["target", "howl", "collectwithdodo", "", ""],
  ["walmart", "howl", "collectwithdodo", "", ""],
  ["amazon", "amazon_associates", "", "", ""],
  ["bestbuy", "canonical", "", "", ""],
  ["disney", "canonical", "", "", ""],
  ["ravensburger", "canonical", "", "", ""],
  ["riot", "canonical", "", "", ""],
  ["booksamillion", "canonical", "", "", ""],
  ["fanatics", "howl", "collectwithdodo", "", ""],
  ["kohls", "howl", "collectwithdodo", "", ""],
  ["macys", "howl", "collectwithdodo", "", ""],
  ["pbandai", "canonical", "", "", ""],
  ["pokemoncenter", "canonical", "", "", ""],
  ["asus", "canonical", "", "", ""],
  ["audioadvice", "howl", "collectwithdodo", "", ""],
  ["bananarepublic", "howl", "collectwithdodo", "", ""],
  ["bananarepublicfactory", "howl", "collectwithdodo", "", ""],
  ["athleta", "howl", "collectwithdodo", "", ""],
  ["americaneagle", "howl", "collectwithdodo", "", ""],
  ["aninebing", "howl", "collectwithdodo", "", ""]
] as const;

const SOURCE_DEFAULTS = [
  ["trackalacker", "TrackaLacker", "trusted_exact", 1],
  ["browser", "Browser observations", "trusted_exact", 1],
  ["discord", "Discord", "informational", 0]
] as const;

export class PrincipalRepository {
  private readonly audit: AuditRepository;
  private readonly authorization: AuthorizationRepository;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
    this.authorization = new AuthorizationRepository(db);
  }

  provision(input: HostedPrincipalInput, now = Date.now()): Record<string, unknown> {
    const actor = currentRequestScope();
    if (actor.actorKind !== "service") throw new Error("A trusted hosted identity service scope is required.");
    this.authorization.require("internal.principal");
    if (input?.confirmation !== HOSTED_PRINCIPAL_CONFIRMATION) throw new InputValidationError("Explicit hosted principal provisioning confirmation is required.");
    const principal = normalizedRequestScope({
      tenantId: input.tenantId,
      userId: input.userId,
      actorKind: "user",
      actorId: input.userId
    });
    const tenantName = cleanText(input.tenantName, 120);
    const displayName = cleanText(input.displayName, 120);
    if (!tenantName || !displayName) throw new InputValidationError("Tenant and user display names are required.");
    const timestamp = nowIso(now);
    const existingUser = this.db.get<{ tenantId: string }>(
      "SELECT tenant_id AS tenantId FROM users WHERE id = ?",
      principal.userId
    );
    if (existingUser && existingUser.tenantId !== principal.tenantId) {
      throw new DomainConflictError("hosted_user_tenant_conflict", "The hosted user ID already belongs to another tenant.");
    }

    const created = !existingUser;
    this.db.transaction(() => {
      this.db.run(
        "INSERT OR IGNORE INTO tenants(id, name, created_at) VALUES (?, ?, ?)",
        principal.tenantId,
        tenantName,
        timestamp
      );
      this.db.run(
        "INSERT OR IGNORE INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
        principal.userId,
        principal.tenantId,
        displayName,
        timestamp
      );
      this.db.run(
        `INSERT OR IGNORE INTO authorization_memberships(
           tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
         ) VALUES (?, ?, 'yoink_user', 'active', ?, ?, ?)`,
        principal.tenantId,
        principal.userId,
        actor.actorId,
        timestamp,
        timestamp
      );
      this.db.run(
        `INSERT OR IGNORE INTO app_settings(
           user_id, actions_paused, pause_reason, execution_mode,
           dedupe_window_seconds, affiliate_mode, tax_bps,
           store_allowances_json, updated_at
         ) VALUES (?, 1, 'Hosted first-run safety pause', 'shadow', 300,
           'prefer_fallback', 1200,
           '{"target":3000,"walmart":3000,"amazon":3000,"bestbuy":3000}', ?)`,
        principal.userId,
        timestamp
      );
      this.db.run(
        `INSERT OR IGNORE INTO user_spend_policies(
           user_id, tenant_id, revision, currency, per_order_cap_cents,
           daily_cap_cents, monthly_cap_cents, order_submission_enabled,
           created_at, updated_at
         ) VALUES (?, ?, 1, 'USD', NULL, NULL, NULL, 0, ?, ?)`,
        principal.userId,
        principal.tenantId,
        timestamp,
        timestamp
      );
      this.db.run(
        `INSERT OR IGNORE INTO operator_alert_rules(
           id, tenant_id, event_family, name, enabled, severity,
           minimum_occurrences, dedupe_window_seconds, escalation_after_seconds,
           retailer_scope, operation_scope, routes_json, privacy_classification,
           created_by_actor_id, updated_by_actor_id, created_at, updated_at
         ) VALUES (?, ?, 'adapter_repair', 'All adapter repair failures', 1, 'warning',
                   1, 900, 3600, '*', '*', '["dashboard","audit_outbox"]',
                   'operational_configuration', ?, ?, ?, ?)`,
        ownedIdForUser("alert_rule_adapter_repair", principal.userId, "alert_rule_adapter_repair_local"),
        principal.tenantId,
        actor.actorId,
        actor.actorId,
        timestamp,
        timestamp
      );
      for (const [source, name, trust, autoCreate] of SOURCE_DEFAULTS) {
        this.db.run(
          `INSERT OR IGNORE INTO source_connections(
             id, tenant_id, user_id, source, name, status, trust_level,
             auto_create_missions, is_private, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'disconnected', ?, ?, 1, ?, ?)`,
          ownedIdForUser(`source_${source}`, principal.userId, `source_${source}_local`),
          principal.tenantId,
          principal.userId,
          source,
          name,
          trust,
          autoCreate,
          timestamp,
          timestamp
        );
      }
      for (const [retailerId, provider, publisherSlug, articleBaseUrl, associateTag] of ATTRIBUTION_DEFAULTS) {
        this.db.run(
          `INSERT OR IGNORE INTO attribution_policies(
             id, tenant_id, user_id, retailer_id, enabled, provider,
             publisher_slug, article_base_url, associate_tag, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ownedIdForUser(`attribution_${retailerId}`, principal.userId, `attribution_${retailerId}_local`),
          principal.tenantId,
          principal.userId,
          retailerId,
          provider === "howl" ? 1 : 0,
          provider,
          publisherSlug,
          articleBaseUrl,
          associateTag,
          timestamp,
          timestamp
        );
      }
      const defaultStrategy = {
        id: ownedIdForUser("strategy_default_notify", principal.userId, "strategy_default_notify"),
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
      this.db.run(
        `INSERT OR IGNORE INTO strategies(
           id, tenant_id, user_id, name, enabled, position, revision,
           definition_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, ?)`,
        defaultStrategy.id,
        principal.tenantId,
        principal.userId,
        defaultStrategy.name,
        defaultStrategy.position,
        JSON.stringify(defaultStrategy),
        timestamp,
        timestamp
      );
      this.audit.record({
        correlationId: principal.userId,
        aggregateType: "hosted_principal",
        eventType: "hosted_principal_provisioned",
        reasonCode: created ? "created" : "idempotent",
        message: created ? "A hosted tenant/user principal was provisioned." : "Hosted principal provisioning was replayed idempotently.",
        data: { tenantId: principal.tenantId, userId: principal.userId, created }
      }, now);
    });
    return {
      tenantId: principal.tenantId,
      userId: principal.userId,
      created,
      settingsInitialized: true,
      privateSourceConnections: SOURCE_DEFAULTS.length,
      privateAttributionPolicies: ATTRIBUTION_DEFAULTS.length,
      defaultStrategies: 1,
      operatorAlertRulesInitialized: 1,
      roles: ["yoink_user"]
    };
  }
}
