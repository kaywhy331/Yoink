import { nowIso } from "../../domain/src/ids.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

export const USER_DATA_EXPORT_FORMAT = "yoink-user-data-json-v1";

export const USER_DATA_OWNERSHIP_TABLE_DISPOSITIONS = Object.freeze({
  action_jobs: "safe_metadata_only",
  admin_change_decisions: "exported",
  admin_change_requests: "exported",
  app_settings: "exported",
  attribution_policies: "exported",
  attribution_receipts: "exported",
  audit_events: "exported",
  authorization_memberships: "exported",
  background_task_events: "operational_metadata_excluded",
  background_task_schedules: "operational_metadata_excluded",
  background_tasks: "credential_material_excluded",
  background_worker_heartbeats: "operational_metadata_excluded",
  catalog_change_proposals: "exported",
  catalog_identity_operations: "exported",
  community_contribution_consents: "exported",
  community_contribution_nonces: "credential_material_excluded",
  community_contribution_receipts: "exported",
  community_inventory_assertions: "exported",
  device_pairing_codes: "safe_metadata_only",
  drop_window_items: "exported",
  drop_windows: "exported",
  extension_devices: "safe_metadata_only",
  hosted_delivery_receipts: "exported",
  hosted_request_nonces: "credential_material_excluded",
  identity_claim_reviews: "exported",
  identity_equivalence_claims: "exported",
  inbox_messages: "safe_metadata_only",
  mission_intent_revisions: "exported",
  missions: "exported",
  notification_deliveries: "safe_metadata_only",
  order_confirmation_observations: "safe_metadata_only",
  observer_recipe_candidates: "exported",
  observer_recipe_contributor_eligibility_states: "exported",
  observer_recipe_lifecycle_events: "exported",
  observer_recipe_recovery_evidence: "exported",
  observer_recipe_recovery_retention_receipts: "exported",
  observer_recipe_recovery_reviews: "exported",
  observer_recipe_trials: "exported",
  offer_snapshots: "exported",
  operator_alert_incidents: "safe_metadata_only",
  retailer_adapter_diagnostics: "exported",
  retailer_adapter_qualifications: "exported",
  retailer_adapter_trials: "exported",
  retailer_session_readiness: "safe_metadata_only",
  retailer_shadow_observations: "exported",
  signal_events: "exported",
  signal_provider_channels: "exported",
  signal_incidents: "exported",
  source_connections: "exported",
  source_sync_runs: "exported",
  spend_ledger_entries: "exported",
  spend_reservations: "exported",
  strategies: "exported",
  privacy_notice_receipts: "exported",
  restock_pattern_profiles: "exported",
  user_action_connector_deliveries: "safe_metadata_only",
  user_action_connectors: "exported",
  user_bot_credentials: "credential_material_excluded",
  user_bot_pairings: "credential_material_excluded",
  user_spend_policies: "exported",
  users: "exported",
  watch_queue_items: "exported",
  walmart_draw_items: "exported",
  walmart_draw_scans: "exported"
} as const);

type ExportRow = Record<string, unknown>;

export interface UserDataCategoryInventory {
  id: string;
  label: string;
  description: string;
  recordCount: number;
}

export interface UserDataInventory {
  format: typeof USER_DATA_EXPORT_FORMAT;
  privacyClassification: "restricted_user";
  generatedAt: string;
  categories: UserDataCategoryInventory[];
  totalRecords: number;
  credentialMaterialsExcluded: true;
  exclusions: string[];
  accountDeletion: {
    available: false;
    state: "infrastructure_gated";
    reason: string;
  };
}

export interface UserDataExport {
  format: typeof USER_DATA_EXPORT_FORMAT;
  formatVersion: 1;
  generatedAt: string;
  privacyClassification: "restricted_user";
  scope: {
    tenantId: string;
    userId: string;
  };
  inventory: Omit<UserDataInventory, "generatedAt">;
  data: Record<string, Record<string, unknown>>;
}

const CATEGORY_METADATA = Object.freeze([
  {
    id: "account_and_access",
    label: "Account and access",
    description: "Your profile and role memberships. Authentication and pairing secrets are never exported."
  },
  {
    id: "preferences",
    label: "Preferences and consent",
    description: "Action, spend, attribution, strategy, and other choices you saved."
  },
  {
    id: "catalog_and_plans",
    label: "Products and purchase plans",
    description: "Your product suggestions, exact plan targets, policy revisions, and plan decisions."
  },
  {
    id: "sources_and_signals",
    label: "Sources and signals",
    description: "Your connected-source state, sync history, and normalized signal records."
  },
  {
    id: "actions_and_spending",
    label: "Actions and spending",
    description: "Your bounded action history, offer snapshots, notifications, reservations, and spend ledger."
  },
  {
    id: "devices_and_retailer_evidence",
    label: "Devices and retailer evidence",
    description: "Safe device metadata plus observations, adapter trials, qualifications, and Walmart Draw scans."
  },
  {
    id: "community_and_maintenance",
    label: "Community and maintenance",
    description: "Your explicit sharing consent, contributed assertions, identity claims, and observer-recipe work."
  },
  {
    id: "activity_and_delivery",
    label: "Activity and delivery",
    description: "Your audit history, hosted delivery records, user-scoped alerts, and change requests."
  }
] as const);

const EXPORT_EXCLUSIONS = Object.freeze([
  "Device tokens, pairing-code hashes, request nonces, and action, notification, or background-task lease capabilities.",
  "Other users' records and tenant-wide security, alert-routing, telemetry, outbox, and administrator configuration.",
  "Shared catalog and community projections except exact public product or offer references attached to your own records.",
  "Raw DOM, page text, screenshots, cookies, credentials, addresses, and payment data, which Yoink does not accept into this export path."
]);

const ACCOUNT_DELETION_REASON = "Account deletion remains closed until hosted identity revocation and durable cleanup workers can prove complete, recoverable, cross-store cleanup. Existing contribution-specific deletion controls remain available separately.";

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonFields(rows: ExportRow[], fields: readonly string[]): ExportRow[] {
  return rows.map((row) => {
    const output = { ...row };
    for (const field of fields) {
      const target = field.endsWith("_json") ? field.slice(0, -5) : field;
      output[target] = parsedJson(output[field]);
      if (target !== field) delete output[field];
    }
    return output;
  });
}

function categoryRecordCount(section: Record<string, unknown>): number {
  return Object.values(section).reduce<number>((count, value) => {
    if (Array.isArray(value)) return count + value.length;
    return count + (value && typeof value === "object" ? 1 : 0);
  }, 0);
}

function inventoryFromCounts(counts: Readonly<Record<string, number>>, generatedAt: string): UserDataInventory {
  const categories = CATEGORY_METADATA.map((category) => ({
    ...category,
    recordCount: Math.max(0, Number(counts[category.id] ?? 0))
  }));
  return {
    format: USER_DATA_EXPORT_FORMAT,
    privacyClassification: "restricted_user",
    generatedAt,
    categories,
    totalRecords: categories.reduce((sum, category) => sum + category.recordCount, 0),
    credentialMaterialsExcluded: true,
    exclusions: [...EXPORT_EXCLUSIONS],
    accountDeletion: {
      available: false,
      state: "infrastructure_gated",
      reason: ACCOUNT_DELETION_REASON
    }
  };
}

export class UserPrivacyRepository {
  constructor(private readonly db: YoinkDatabase) {}

  inventory(now = Date.now()): UserDataInventory {
    const scope = currentRequestScope();
    const userId = scope.userId;
    const tenantId = scope.tenantId;
    const count = (sql: string, ...params: string[]): number => Number(
      this.db.get<{ count: number }>(sql, ...params)?.count ?? 0
    );
    const counts: Record<string, number> = {
      account_and_access: count(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE tenant_id = ? AND id = ?)
           + (SELECT COUNT(*) FROM authorization_memberships WHERE tenant_id = ? AND user_id = ?) AS count`,
        tenantId, userId, tenantId, userId
      ),
      preferences: count(
        `SELECT
           (SELECT COUNT(*) FROM app_settings WHERE user_id = ?)
           + (SELECT COUNT(*) FROM user_spend_policies WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM attribution_policies WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM strategies WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM user_action_connectors WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM privacy_notice_receipts WHERE tenant_id = ? AND user_id = ?) AS count`,
        userId, tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId
      ),
      catalog_and_plans: count(
        `SELECT
           (SELECT COUNT(*) FROM catalog_change_proposals WHERE tenant_id = ? AND proposer_user_id = ?)
           + (SELECT COUNT(*) FROM missions WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM mission_targets WHERE mission_id IN (
               SELECT id FROM missions WHERE tenant_id = ? AND user_id = ?))
           + (SELECT COUNT(*) FROM mission_intent_revisions WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM mission_decisions WHERE mission_id IN (
               SELECT id FROM missions WHERE tenant_id = ? AND user_id = ?)) AS count`,
        tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId
      ),
      sources_and_signals: count(
        `SELECT
           (SELECT COUNT(*) FROM source_connections WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM source_device_states WHERE source_connection_id IN (
               SELECT id FROM source_connections WHERE tenant_id = ? AND user_id = ?))
           + (SELECT COUNT(*) FROM source_sync_runs WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM source_sync_run_items WHERE run_id IN (
               SELECT id FROM source_sync_runs WHERE tenant_id = ? AND user_id = ?))
           + (SELECT COUNT(*) FROM signal_events WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM signal_incidents WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM signal_occurrences WHERE event_id IN (
               SELECT id FROM signal_events WHERE tenant_id = ? AND user_id = ?))
           + (SELECT COUNT(*) FROM resolution_decisions WHERE event_id IN (
               SELECT id FROM signal_events WHERE tenant_id = ? AND user_id = ?))
           + (SELECT COUNT(*) FROM signal_provider_channels WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM drop_windows WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM drop_window_items WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM watch_queue_items WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM restock_pattern_profiles WHERE tenant_id = ? AND user_id = ?) AS count`,
        tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId
      ),
      actions_and_spending: count(
        `SELECT
           (SELECT COUNT(*) FROM offer_snapshots WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM exact_offer_keys eok
               WHERE eok.tenant_id = ? AND eok.id IN (
                 SELECT exact_offer_key_id FROM offer_snapshots
                   WHERE tenant_id = ? AND user_id = ? AND exact_offer_key_id IS NOT NULL
                 UNION
                 SELECT exact_offer_key_id FROM action_jobs
                   WHERE tenant_id = ? AND user_id = ? AND exact_offer_key_id IS NOT NULL
                 UNION
                 SELECT exact_offer_key_id FROM spend_reservations
                   WHERE tenant_id = ? AND user_id = ? AND exact_offer_key_id IS NOT NULL
               ))
           + (SELECT COUNT(*) FROM action_jobs WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM action_events WHERE job_id IN (
               SELECT id FROM action_jobs WHERE tenant_id = ? AND user_id = ?))
           + (SELECT COUNT(*) FROM notification_deliveries WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM spend_reservations WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM spend_ledger_entries WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM attribution_receipts WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM user_action_connector_deliveries WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM order_confirmation_observations WHERE tenant_id = ? AND user_id = ?) AS count`,
        tenantId, userId,
        tenantId, tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId
      ),
      devices_and_retailer_evidence: count(
        `SELECT
           (SELECT COUNT(*) FROM extension_devices WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM device_pairing_codes WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM retailer_shadow_observations WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM retailer_adapter_diagnostics WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM retailer_adapter_trials WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM retailer_adapter_qualifications WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM walmart_draw_scans WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM walmart_draw_items WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM retailer_session_readiness WHERE tenant_id = ? AND user_id = ?) AS count`,
        tenantId, userId, tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId
      ),
      community_and_maintenance: count(
        `SELECT
           (SELECT COUNT(*) FROM community_contribution_consents WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM community_inventory_assertions WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM community_contribution_receipts WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM identity_equivalence_claims WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM identity_claim_reviews WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM observer_recipe_candidates WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM observer_recipe_contributor_eligibility_states
               WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM observer_recipe_lifecycle_events WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM observer_recipe_trials WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM observer_recipe_recovery_evidence WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM observer_recipe_recovery_reviews WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM observer_recipe_recovery_retention_receipts
               WHERE tenant_id = ? AND user_id = ?) AS count`,
        tenantId, userId, tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId, tenantId, userId
      ),
      activity_and_delivery: count(
        `SELECT
           (SELECT COUNT(*) FROM audit_events WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM inbox_messages WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM hosted_delivery_receipts WHERE tenant_id = ? AND user_id = ?)
           + (SELECT COUNT(*) FROM operator_alert_incidents WHERE tenant_id = ? AND subject_user_id = ?)
           + (SELECT COUNT(*) FROM admin_change_requests WHERE tenant_id = ? AND requested_by_user_id = ?)
           + (SELECT COUNT(*) FROM admin_change_decisions WHERE tenant_id = ? AND reviewer_user_id = ?)
           + (SELECT COUNT(*) FROM catalog_identity_operations WHERE tenant_id = ? AND requested_by_user_id = ?) AS count`,
        tenantId, userId, tenantId, userId, tenantId, userId, tenantId, userId,
        tenantId, userId, tenantId, userId, tenantId, userId
      )
    };
    return inventoryFromCounts(counts, nowIso(now));
  }

  export(now = Date.now()): UserDataExport {
    const scope = currentRequestScope();
    const generatedAt = nowIso(now);
    return this.db.readTransaction(() => {
      const data: Record<string, Record<string, unknown>> = {
        account_and_access: this.accountAndAccess(),
        preferences: this.preferences(),
        catalog_and_plans: this.catalogAndPlans(),
        sources_and_signals: this.sourcesAndSignals(),
        actions_and_spending: this.actionsAndSpending(),
        devices_and_retailer_evidence: this.devicesAndRetailerEvidence(),
        community_and_maintenance: this.communityAndMaintenance(),
        activity_and_delivery: this.activityAndDelivery()
      };
      const counts = Object.fromEntries(
        Object.entries(data).map(([category, section]) => [category, categoryRecordCount(section)])
      );
      const inventory = inventoryFromCounts(counts, generatedAt);
      const { generatedAt: _inventoryGeneratedAt, ...embeddedInventory } = inventory;
      return {
        format: USER_DATA_EXPORT_FORMAT,
        formatVersion: 1,
        generatedAt,
        privacyClassification: "restricted_user",
        scope: { tenantId: scope.tenantId, userId: scope.userId },
        inventory: embeddedInventory,
        data
      };
    });
  }

  private rows(sql: string, ...params: string[]): ExportRow[] {
    return this.db.all<ExportRow>(sql, ...params);
  }

  private accountAndAccess(): Record<string, unknown> {
    const { tenantId, userId } = currentRequestScope();
    return {
      profile: this.db.get<ExportRow>(
        `SELECT id, display_name, created_at FROM users
         WHERE tenant_id = ? AND id = ?`,
        tenantId, userId
      ) ?? null,
      memberships: this.rows(
        `SELECT m.role_id, r.display_name AS role_name, m.status,
                m.granted_by_actor_id, m.created_at, m.updated_at
         FROM authorization_memberships m
         JOIN authorization_roles r ON r.id = m.role_id
         WHERE m.tenant_id = ? AND m.user_id = ?
         ORDER BY r.display_name, m.role_id`,
        tenantId, userId
      )
    };
  }

  private preferences(): Record<string, unknown> {
    const { tenantId, userId } = currentRequestScope();
    const settings = this.db.get<ExportRow>(
      `SELECT actions_paused, pause_reason, execution_mode, dedupe_window_seconds,
              affiliate_mode, tax_bps, store_allowances_json, watch_queue_mode,
              privacy_notice_version, plans_from_calls, collection_wants_json, test_items_json,
              discord_notifications_json, updated_at
       FROM app_settings WHERE user_id = ?`,
      userId
    );
    return {
      app_settings: settings ? parseJsonFields([settings], ["store_allowances_json", "collection_wants_json", "test_items_json",
        "discord_notifications_json"])[0] : null,
      spend_policy: this.db.get<ExportRow>(
        `SELECT revision, currency, per_order_cap_cents, daily_cap_cents,
                monthly_cap_cents, order_submission_enabled, timezone,
                period_reset_hour, created_at, updated_at
         FROM user_spend_policies WHERE tenant_id = ? AND user_id = ?`,
        tenantId, userId
      ) ?? null,
      attribution_policies: this.rows(
        `SELECT id, retailer_id, enabled, provider, publisher_slug,
                article_base_url, associate_tag, created_at, updated_at
         FROM attribution_policies WHERE tenant_id = ? AND user_id = ?
         ORDER BY retailer_id, id`,
        tenantId, userId
      ),
      strategies: parseJsonFields(this.rows(
        `SELECT id, name, enabled, position, revision, definition_json,
                created_at, updated_at
         FROM strategies WHERE tenant_id = ? AND user_id = ?
         ORDER BY position, id`,
        tenantId, userId
      ), ["definition_json"]),
      action_connectors: parseJsonFields(this.rows(
        `SELECT id, kind, name, enabled, endpoint_reference,
                endpoint_binding_fingerprint, events_json, last_delivery_at,
                last_error_code, created_at, updated_at
         FROM user_action_connectors WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["events_json"]),
      privacy_notice_receipts: this.rows(
        `SELECT id, policy_version, change_version, notice_kind, action,
                evidence_hash, created_at
         FROM privacy_notice_receipts WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      )
    };
  }

  private catalogAndPlans(): Record<string, unknown> {
    const { tenantId, userId } = currentRequestScope();
    return {
      product_suggestions: parseJsonFields(this.rows(
        `SELECT id, proposal_kind, retailer_id, retailer_sku, payload_json,
                payload_hash, status, review_note, reviewed_by_actor_id,
                decided_at, applied_listing_id, created_at, updated_at
         FROM catalog_change_proposals
         WHERE tenant_id = ? AND proposer_user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["payload_json"]),
      purchase_plans: parseJsonFields(this.rows(
        `SELECT m.id, m.variant_id, v.title AS variant_title,
                v.attributes_json AS variant_attributes_json,
                pf.title AS product_title, pf.brand, m.status, m.origin,
                m.target_quantity, m.fulfilled_quantity, m.created_at, m.updated_at
         FROM missions m
         JOIN variants v ON v.id = m.variant_id
         JOIN product_families pf ON pf.id = v.family_id
         WHERE m.tenant_id = ? AND m.user_id = ?
         ORDER BY m.created_at, m.id`,
        tenantId, userId
      ), ["variant_attributes_json"]),
      plan_targets: this.rows(
        `SELECT mt.id, mt.mission_id, mt.listing_id, r.id AS retailer_id,
                r.display_name AS retailer_name, l.retailer_sku, l.canonical_url,
                mt.enabled, mt.max_unit_price_cents, mt.currency,
                mt.seller_policy, mt.fulfillment, mt.created_at, mt.updated_at
         FROM mission_targets mt
         JOIN missions m ON m.id = mt.mission_id
         JOIN listings l ON l.id = mt.listing_id
         JOIN retailers r ON r.id = l.retailer_id
         WHERE m.tenant_id = ? AND m.user_id = ?
         ORDER BY mt.mission_id, mt.created_at, mt.id`,
        tenantId, userId
      ),
      intent_revisions: parseJsonFields(this.rows(
        `SELECT id, mission_id, revision, quantity, currency, max_all_in_cents,
                action_ceiling, substitution_policy, expires_at, cooldown_seconds,
                target_policy_json, policy_hash, change_reason, created_by_actor_id,
                created_at, decision_mode, max_signal_age_seconds
         FROM mission_intent_revisions
         WHERE tenant_id = ? AND user_id = ?
         ORDER BY mission_id, revision, id`,
        tenantId, userId
      ), ["target_policy_json"]),
      plan_decisions: this.rows(
        `SELECT md.id, md.event_id, md.incident_id, md.mission_id,
                md.strategy_id, md.strategy_revision, md.outcome, md.reason,
                md.effective_action, md.effective_quantity,
                md.effective_unit_cap_cents, md.decision_source, md.created_at
         FROM mission_decisions md
         JOIN missions m ON m.id = md.mission_id
         WHERE m.tenant_id = ? AND m.user_id = ?
         ORDER BY md.created_at, md.id`,
        tenantId, userId
      )
    };
  }

  private sourcesAndSignals(): Record<string, unknown> {
    const { tenantId, userId } = currentRequestScope();
    return {
      connections: this.rows(
        `SELECT id, source, name, status, trust_level, auto_create_missions,
                is_private, last_event_at, created_at, updated_at
         FROM source_connections WHERE tenant_id = ? AND user_id = ?
         ORDER BY source, name, id`,
        tenantId, userId
      ),
      device_states: this.rows(
        `SELECT sds.device_id, sds.source_connection_id, sds.state, sds.ready,
                sds.subscription_present, sds.pending_signals, sds.last_http_status,
                sds.error_code, sds.last_registration_at, sds.last_notification_at,
                sds.last_delivery_at, sds.updated_at
         FROM source_device_states sds
         JOIN source_connections sc ON sc.id = sds.source_connection_id
         JOIN extension_devices d ON d.id = sds.device_id
         WHERE sc.tenant_id = ? AND sc.user_id = ? AND d.tenant_id = ? AND d.user_id = ?
         ORDER BY sds.source_connection_id, sds.device_id`,
        tenantId, userId, tenantId, userId
      ),
      sync_runs: this.rows(
        `SELECT id, source_connection_id, device_id, phase, page, pages,
                discovered, processed, imported, failed, message,
                started_at, updated_at, completed_at
         FROM source_sync_runs WHERE tenant_id = ? AND user_id = ?
         ORDER BY started_at, id`,
        tenantId, userId
      ),
      sync_run_items: this.rows(
        `SELECT sri.id, sri.run_id, sri.external_product_id, sri.outcome,
                sri.candidates_accepted, sri.listings_mapped, sri.listings_created,
                sri.error_code, sri.created_at, sri.updated_at
         FROM source_sync_run_items sri
         JOIN source_sync_runs sr ON sr.id = sri.run_id
         WHERE sr.tenant_id = ? AND sr.user_id = ?
         ORDER BY sri.run_id, sri.created_at, sri.id`,
        tenantId, userId
      ),
      signal_events: parseJsonFields(this.rows(
        `SELECT id, source_connection_id, signal_id, external_event_id,
                transport_hash, schema_version, source, event_type, test,
                observed_at, received_at, identity_json, offer_json, evidence_json,
                parser_version, resolution_status, created_at
         FROM signal_events WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["identity_json", "offer_json", "evidence_json"]),
      signal_incidents: this.rows(
        `SELECT id, listing_id, event_type, semantic_key, status,
                unit_price_cents, currency, seller_name, seller_type,
                offer_fingerprint, first_observed_at, last_observed_at,
                occurrence_count, closed_reason, created_at, updated_at
         FROM signal_incidents WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      signal_occurrences: this.rows(
        `SELECT occurrence.id, occurrence.event_id, occurrence.incident_id,
                occurrence.source_connection_id, occurrence.observed_at,
                occurrence.received_at, occurrence.created_at
         FROM signal_occurrences occurrence
         JOIN signal_events event ON event.id = occurrence.event_id
         WHERE event.tenant_id = ? AND event.user_id = ?
         ORDER BY occurrence.created_at, occurrence.id`,
        tenantId, userId
      ),
      resolution_decisions: this.rows(
        `SELECT rd.id, rd.event_id, rd.status, rd.method, rd.variant_id,
                rd.listing_id, rd.reason, rd.resolver_version, rd.created_at
         FROM resolution_decisions rd
         JOIN signal_events se ON se.id = rd.event_id
         WHERE se.tenant_id = ? AND se.user_id = ?
         ORDER BY rd.created_at, rd.id`,
        tenantId, userId
      ),
      provider_channels: this.rows(
        `SELECT id, source_connection_id, provider, name, external_ref_hash,
                trust_level, status, replay_window_seconds, accepted_event_count,
                rejected_event_count, false_positive_count, last_event_at,
                last_error_code, created_at, updated_at
         FROM signal_provider_channels WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      drop_windows: this.rows(
        `SELECT id, source_channel_id, retailer_id, kind, title, starts_at,
                closes_at, spread_seconds, confidence_bps, timezone, status,
                supersedes_id, superseded_by_id, author_note,
                created_by_actor_id, created_at, updated_at
         FROM drop_windows WHERE tenant_id = ? AND user_id = ?
         ORDER BY starts_at, id`,
        tenantId, userId
      ),
      drop_window_items: parseJsonFields(this.rows(
        `SELECT id, drop_window_id, listing_id, ordinal, expected_at,
                early_access_json, created_at
         FROM drop_window_items WHERE tenant_id = ? AND user_id = ?
         ORDER BY expected_at, id`,
        tenantId, userId
      ), ["early_access_json"]),
      watch_queue: parseJsonFields(this.rows(
        `SELECT id, drop_window_id, drop_window_item_id, listing_id, mission_id,
                assigned_device_id, enrollment, state, observation_starts_at,
                observation_closes_at, next_observation_at, jitter_seconds,
                observation_count, last_observed_at, last_availability,
                readiness_json, extension_version, lease_expires_at,
                closed_reason, created_at, updated_at
         FROM watch_queue_items WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["readiness_json"]),
      restock_patterns: parseJsonFields(this.rows(
        `SELECT id, retailer_id, listing_id, timezone, sample_count,
                likely_local_hour, median_interval_minutes, confidence_bps,
                pattern_json, computed_through_at, created_at, updated_at
         FROM restock_pattern_profiles WHERE tenant_id = ? AND user_id = ?
         ORDER BY retailer_id, listing_id, timezone, id`,
        tenantId, userId
      ), ["pattern_json"])
    };
  }

  private actionsAndSpending(): Record<string, unknown> {
    const { tenantId, userId } = currentRequestScope();
    return {
      offer_snapshots: this.rows(
        `SELECT id, mission_id, intent_revision_id, exact_offer_key_id, listing_id,
                source_observation_id, incident_id, availability, unit_price_cents,
                quantity, item_subtotal_cents, maximum_all_in_cents, currency,
                seller_name, seller_type, fulfillment, offer_fingerprint,
                evidence_hash, observed_at, expires_at, created_at
         FROM offer_snapshots WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      exact_offer_references: parseJsonFields(this.rows(
        `SELECT eok.id, eok.listing_id, eok.retailer_id, eok.retailer_sku,
                eok.child_offer_key, eok.attributes_json, eok.condition_code,
                eok.seller_name, eok.seller_key, eok.seller_type, eok.fulfillment,
                eok.region_scope, eok.store_scope, eok.identity_hash, eok.created_at
         FROM exact_offer_keys eok
         WHERE eok.tenant_id = ? AND eok.id IN (
           SELECT exact_offer_key_id FROM offer_snapshots
           WHERE tenant_id = ? AND user_id = ? AND exact_offer_key_id IS NOT NULL
           UNION
           SELECT exact_offer_key_id FROM action_jobs
           WHERE tenant_id = ? AND user_id = ? AND exact_offer_key_id IS NOT NULL
           UNION
           SELECT exact_offer_key_id FROM spend_reservations
           WHERE tenant_id = ? AND user_id = ? AND exact_offer_key_id IS NOT NULL
         )
         ORDER BY eok.created_at, eok.id`,
        tenantId, tenantId, userId, tenantId, userId, tenantId, userId
      ), ["attributes_json"]),
      jobs: parseJsonFields(this.rows(
        `SELECT id, mission_id, mission_target_id, incident_id, strategy_id,
                strategy_revision, assigned_device_id, state, action, quantity,
                max_unit_price_cents, max_order_total_cents, currency, seller_policy,
                fulfillment, expected_seller, listing_id, canonical_url,
                attribution_url, affiliate_mode, offer_fingerprint, idempotency_key,
                expires_at, leased_at, lease_expires_at, created_at, updated_at,
                attribution_provider, attribution_metadata_json, intent_revision_id,
                exact_offer_key_id, offer_snapshot_id, spend_reservation_id,
                decision_source
         FROM action_jobs WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["attribution_metadata_json"]),
      job_events: parseJsonFields(this.rows(
        `SELECT ae.id, ae.job_id, ae.state, ae.reason_code, ae.message,
                ae.evidence_json, ae.created_at
         FROM action_events ae
         JOIN action_jobs aj ON aj.id = ae.job_id
         WHERE aj.tenant_id = ? AND aj.user_id = ?
         ORDER BY ae.created_at, ae.id`,
        tenantId, userId
      ), ["evidence_json"]),
      notifications: this.rows(
        `SELECT id, job_id, assigned_device_id, state, attempts,
                lease_expires_at, delivered_at, interaction_at, failure_code,
                created_at, updated_at
         FROM notification_deliveries WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      spend_reservations: this.rows(
        `SELECT id, mission_id, intent_revision_id, exact_offer_key_id,
                offer_snapshot_id, action_job_id, idempotency_key, action,
                quantity, reserved_amount_cents, committed_amount_cents, currency,
                status, release_reason, expires_at, created_at, updated_at
         FROM spend_reservations WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      spend_ledger: parseJsonFields(this.rows(
        `SELECT id, reservation_id, action_job_id, entry_type,
                reserved_delta_cents, spent_delta_cents, quantity_delta, currency,
                reason_code, correlation_id, metadata_json, created_at
         FROM spend_ledger_entries WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["metadata_json"]),
      attribution_receipts: this.rows(
        `SELECT id, job_id, policy_id, retailer_id, provider, outcome,
                reason_code, route_url, canonical_url_hash, created_at
         FROM attribution_receipts WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      action_connector_deliveries: this.rows(
        `SELECT id, connector_id, action_job_id, event_type, state,
                attempt_count, lease_expires_at, next_attempt_at,
                last_error_code, delivered_at, created_at, updated_at
         FROM user_action_connector_deliveries
         WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      order_confirmations: this.rows(
        `SELECT id, device_id, action_job_id, retailer_id, page_class,
                observed_at, received_at, acknowledged, created_at
         FROM order_confirmation_observations
         WHERE tenant_id = ? AND user_id = ?
         ORDER BY observed_at, id`,
        tenantId, userId
      )
    };
  }

  private devicesAndRetailerEvidence(): Record<string, unknown> {
    const { tenantId, userId } = currentRequestScope();
    return {
      devices: parseJsonFields(this.rows(
        `SELECT id, name, extension_version, status, capabilities_json,
                credential_generation, credential_issued_at,
                CASE WHEN pending_token_hash <> '' THEN 1 ELSE 0 END AS credential_rotation_pending,
                last_seen_at, created_at, updated_at
         FROM extension_devices WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["capabilities_json"]),
      pairing_code_history: this.rows(
        `SELECT id, expires_at, used_at, created_at
         FROM device_pairing_codes WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      shadow_observations: parseJsonFields(this.rows(
        `SELECT id, device_id, retailer_id, adapter_version, contract_version,
                page_kind, retailer_sku, canonical_url, availability,
                unit_price_cents, currency, seller_name, seller_type, fulfillment,
                add_control_actionable, security_challenge, interactive_block,
                observation_state, evidence_hash, observed_at, received_at,
                purchase_route_kind, purchase_route_ready, route_reason_code,
                selected_offer_schema_version, selected_offer_state, child_offer_key,
                variant_attributes_json, selected_offer_fingerprint
         FROM retailer_shadow_observations WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ), ["variant_attributes_json"]),
      adapter_diagnostics: parseJsonFields(this.rows(
        `SELECT id, device_id, retailer_id, retailer_sku, adapter_version,
                contract_version, operation, outcome, failure_stage, reason_code,
                attempt_count, dom_changed, layout_fingerprint, layout_json,
                observed_at, received_at
         FROM retailer_adapter_diagnostics WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ), ["layout_json"]),
      adapter_trials: this.rows(
        `SELECT id, device_id, retailer_id, adapter_version, observer_version,
                contract_version, trial_kind, shadow_observation_id, retailer_sku,
                outcome, reason_code, evidence_hash, observed_at, received_at
         FROM retailer_adapter_trials WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ),
      adapter_qualifications: this.rows(
        `SELECT retailer_id, adapter_version, highest_action, status,
                evidence_hash, qualified_at, updated_at
         FROM retailer_adapter_qualifications WHERE tenant_id = ? AND user_id = ?
         ORDER BY retailer_id, adapter_version`,
        tenantId, userId
      ),
      walmart_draw_scans: this.rows(
        `SELECT id, device_id, adapter_version, contract_version, outcome,
                reason_code, expected_card_count, observed_card_count,
                security_challenge, interactive_block, evidence_hash,
                observed_at, received_at
         FROM walmart_draw_scans WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ),
      walmart_draw_items: this.rows(
        `SELECT id, scan_id, retailer_sku, title, canonical_url,
                unit_price_cents, currency, seller_name, seller_type, draw_state,
                closes_at, condition_code, condition_group_code, order_min_limit,
                order_max_limit, draw_control_present, add_control_suppressed,
                evidence_hash, observed_at, received_at
         FROM walmart_draw_items WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ),
      retailer_session_readiness: this.rows(
        `SELECT device_id, retailer_id, signed_in_state, cart_baseline_state,
                baseline_observed_at, expires_at, adapter_version,
                last_error_code, updated_at
         FROM retailer_session_readiness WHERE tenant_id = ? AND user_id = ?
         ORDER BY retailer_id, device_id`,
        tenantId, userId
      )
    };
  }

  private communityAndMaintenance(): Record<string, unknown> {
    const { tenantId, userId } = currentRequestScope();
    return {
      contribution_consents: this.rows(
        `SELECT retailer_id, enabled, location_scope, privacy_version,
                consented_at, revoked_at, updated_at
         FROM community_contribution_consents WHERE tenant_id = ? AND user_id = ?
         ORDER BY retailer_id`,
        tenantId, userId
      ),
      inventory_assertions: parseJsonFields(this.rows(
        `SELECT id, device_id, shadow_observation_id, adapter_diagnostic_id,
                retailer_id, retailer_sku, variant_fingerprint, observation_key,
                availability, unit_price_cents, currency, seller_name, seller_type,
                fulfillment, location_scope, observer_version, layout_fingerprint,
                assertion_state, quarantine_reason, evidence_hash, observed_at,
                received_at, expires_at, deleted_at, selected_offer_state,
                child_offer_key, variant_attributes_json, selected_offer_fingerprint
         FROM community_inventory_assertions WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ), ["variant_attributes_json"]),
      contribution_receipts: this.rows(
        `SELECT id, device_id, assertion_id, disposition, receipt_hash, created_at
         FROM community_contribution_receipts WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      identity_claims: parseJsonFields(this.rows(
        `SELECT id, proposer_device_id, listing_id, reference_listing_id,
                current_variant_id, claimed_variant_id, identifier_kind,
                normalized_identifier, identifier_hash, variant_fingerprint,
                attributes_json, provenance_kind, provenance_note, claim_state,
                conflict_reason, claim_hash, reviewed_at, updated_at, created_at
         FROM identity_equivalence_claims WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["attributes_json"]),
      identity_claim_reviews: this.rows(
        `SELECT id, claim_id, outcome, note, review_hash, created_at
         FROM identity_claim_reviews WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      observer_recipe_candidates: parseJsonFields(this.rows(
        `SELECT id, retailer_id, recipe_version, minimum_extension_version,
                recipe_json, recipe_fingerprint, lifecycle_state, rollback_recipe_id,
                kill_switch, provenance_code, signature_key_id, signature, signed_at,
                expires_at, disabled_reason, trust_manifest_generation,
                trust_manifest_hash, created_at, updated_at
         FROM observer_recipe_candidates WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["recipe_json"]),
      observer_recipe_lifecycle_events: this.rows(
        `SELECT id, recipe_id, from_state, to_state, reason_code,
                event_hash, created_at
         FROM observer_recipe_lifecycle_events WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      observer_recipe_trials: parseJsonFields(this.rows(
        `SELECT id, device_id, recipe_id, retailer_id, retailer_sku,
                observer_version, layout_fingerprint, outcome,
                evaluated_field_count, agreed_field_count, ambiguous_field_count,
                validation_profile, oracle_evaluated_field_count,
                oracle_agreed_field_count, oracle_conflict_field_count,
                packaged_missing_field_count, packaged_conflict_field_count,
                insufficient_field_count, field_outcomes_json,
                recipe_state_at_trial, eligibility_policy_version,
                eligibility_state, contributor_ref_hash,
                eligibility_proof_hash, region_scope, observed_at, received_at
         FROM observer_recipe_trials WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ), ["field_outcomes_json"]),
      observer_recipe_contributor_eligibility_states: this.rows(
        `SELECT device_id, policy_version, contributor_ref_hash, region_scope,
                account_eligible, device_eligible, region_eligible, proof_hash,
                source, attested_at, expires_at, created_at, updated_at
         FROM observer_recipe_contributor_eligibility_states
         WHERE tenant_id = ? AND user_id = ?
         ORDER BY updated_at, device_id`,
        tenantId, userId
      ),
      observer_recipe_recovery_evidence: this.rows(
        `SELECT id, device_id, trial_id, recipe_id, retailer_id, retailer_sku,
                layout_fingerprint, field_name, value_kind, normalized_value,
                provenance_code, recipe_state_at_trial, evidence_state,
                application_state, observed_at, received_at
         FROM observer_recipe_recovery_evidence WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ),
      observer_recipe_recovery_reviews: this.rows(
        `SELECT id, evidence_id, sequence, decision, confirmation_code,
                evidence_hash, actor_kind, actor_id, created_at
         FROM observer_recipe_recovery_reviews WHERE tenant_id = ? AND user_id = ?
         ORDER BY evidence_id, sequence`,
        tenantId, userId
      ),
      observer_recipe_recovery_retention_receipts: this.rows(
        `SELECT id, policy_version, retention_days, cutoff_at,
                deleted_evidence_count, deleted_review_event_count,
                application_affected, field_fill_applied,
                privacy_classification, created_at
         FROM observer_recipe_recovery_retention_receipts
         WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      )
    };
  }

  private activityAndDelivery(): Record<string, unknown> {
    const { tenantId, userId } = currentRequestScope();
    return {
      audit_events: parseJsonFields(this.rows(
        `SELECT id, correlation_id, event_type, reason_code, message,
                data_json, created_at
         FROM audit_events WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["data_json"]),
      inbox_messages: parseJsonFields(this.rows(
        `SELECT id, source, message_key, event_type, payload_hash, payload_json,
                state, delivery_attempts, lease_expires_at, next_attempt_at,
                last_error_code, received_at, processed_at, updated_at
         FROM inbox_messages WHERE tenant_id = ? AND user_id = ?
         ORDER BY received_at, id`,
        tenantId, userId
      ), ["payload_json"]),
      hosted_delivery_receipts: this.rows(
        `SELECT id, direction, message_id, disposition, attempt,
                reason_code, receipt_hash, created_at
         FROM hosted_delivery_receipts WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      operator_alert_incidents: this.rows(
        `SELECT id, rule_id, event_family, severity, status, privacy_classification,
                title, summary, retailer_id, operation, failure_stage, reason_code,
                layout_fingerprint, occurrence_count, affected_entity_count,
                first_seen_at, last_seen_at, last_failure_at, escalated_at,
                acknowledged_at, resolved_at, resolution_code, created_at, updated_at
         FROM operator_alert_incidents
         WHERE tenant_id = ? AND subject_user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      admin_change_requests: parseJsonFields(this.rows(
        `SELECT id, operation_type, target_key, payload_hash, summary_json,
                control_level, status, requested_by_actor_kind,
                requested_by_actor_id, requested_assurance, correlation_id,
                expires_at, approved_at, consumed_at, created_at, updated_at
         FROM admin_change_requests
         WHERE tenant_id = ? AND requested_by_user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["summary_json"]),
      admin_change_decisions: this.rows(
        `SELECT id, request_id, decision, reviewer_actor_kind,
                reviewer_actor_id, reviewer_assurance, correlation_id, created_at
         FROM admin_change_decisions
         WHERE tenant_id = ? AND reviewer_user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ),
      catalog_identity_operations: parseJsonFields(this.rows(
        `SELECT id, operation_kind, requested_by_actor_kind,
                requested_by_actor_id, payload_json, payload_hash, base_state_hash,
                status, requires_distinct_approver, review_note,
                reviewed_by_actor_id, decided_at, applied_at,
                reversed_operation_id, reverted_by_operation_id, result_json,
                created_at, updated_at
         FROM catalog_identity_operations
         WHERE tenant_id = ? AND requested_by_user_id = ?
         ORDER BY created_at, id`,
        tenantId, userId
      ), ["payload_json", "result_json"])
    };
  }
}
