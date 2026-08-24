export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    version: 1,
    name: "initial_commerce_control_plane",
    sql: `
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE retailers (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        execution_supported INTEGER NOT NULL DEFAULT 0 CHECK (execution_supported IN (0, 1)),
        domains_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE source_connections (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'disconnected',
        trust_level TEXT NOT NULL DEFAULT 'informational',
        auto_create_missions INTEGER NOT NULL DEFAULT 0 CHECK (auto_create_missions IN (0, 1)),
        is_private INTEGER NOT NULL DEFAULT 1 CHECK (is_private IN (0, 1)),
        last_event_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, source, name)
      ) STRICT;

      CREATE TABLE product_families (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        brand TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE variants (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES product_families(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        attributes_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE identifiers (
        id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        retailer_id TEXT REFERENCES retailers(id) ON DELETE RESTRICT,
        verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0, 1)),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX identifiers_unique_global
        ON identifiers(kind, value) WHERE retailer_id IS NULL;
      CREATE UNIQUE INDEX identifiers_unique_retailer
        ON identifiers(kind, value, retailer_id) WHERE retailer_id IS NOT NULL;

      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        retailer_sku TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        execution_supported INTEGER NOT NULL DEFAULT 0 CHECK (execution_supported IN (0, 1)),
        msrp_cents INTEGER CHECK (msrp_cents IS NULL OR msrp_cents > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(retailer_id, retailer_sku)
      ) STRICT;
      CREATE INDEX listings_variant_idx ON listings(variant_id);

      CREATE TABLE listing_urls (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        observed_at TEXT NOT NULL,
        UNIQUE(listing_id, kind, url)
      ) STRICT;

      CREATE TABLE source_product_refs (
        id TEXT PRIMARY KEY,
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        external_product_id TEXT NOT NULL,
        variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
        source_url TEXT NOT NULL DEFAULT '',
        source_title TEXT NOT NULL DEFAULT '',
        observed_at TEXT NOT NULL,
        UNIQUE(source_connection_id, external_product_id)
      ) STRICT;
      CREATE INDEX source_product_refs_variant_idx ON source_product_refs(variant_id);

      CREATE TABLE source_listing_refs (
        id TEXT PRIMARY KEY,
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        external_listing_id TEXT NOT NULL,
        external_product_id TEXT NOT NULL DEFAULT '',
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        source_url TEXT NOT NULL DEFAULT '',
        observed_at TEXT NOT NULL,
        UNIQUE(source_connection_id, external_listing_id)
      ) STRICT;
      CREATE INDEX source_listing_refs_listing_idx ON source_listing_refs(listing_id);

      CREATE TABLE offer_observations (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        source_connection_id TEXT REFERENCES source_connections(id) ON DELETE SET NULL,
        availability TEXT NOT NULL,
        unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        seller_name TEXT NOT NULL DEFAULT '',
        seller_type TEXT NOT NULL DEFAULT 'unknown',
        order_limit INTEGER CHECK (order_limit IS NULL OR (order_limit >= 1 AND order_limit <= 99)),
        offer_fingerprint TEXT NOT NULL DEFAULT '',
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX offer_observations_listing_time_idx ON offer_observations(listing_id, observed_at DESC);

      CREATE TABLE strategies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        position INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, position)
      ) STRICT;

      CREATE TABLE missions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'active',
        origin TEXT NOT NULL DEFAULT 'manual',
        target_quantity INTEGER NOT NULL DEFAULT 1 CHECK (target_quantity >= 1 AND target_quantity <= 99),
        fulfilled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, variant_id)
      ) STRICT;

      CREATE TABLE mission_targets (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        max_unit_price_cents INTEGER CHECK (max_unit_price_cents IS NULL OR max_unit_price_cents > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        seller_policy TEXT NOT NULL DEFAULT 'inherit',
        fulfillment TEXT NOT NULL DEFAULT 'inherit',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(mission_id, listing_id)
      ) STRICT;

      CREATE TABLE signal_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        signal_id TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        transport_hash TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        test INTEGER NOT NULL DEFAULT 0 CHECK (test IN (0, 1)),
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        identity_json TEXT NOT NULL,
        offer_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        resolution_status TEXT NOT NULL DEFAULT 'unresolved',
        created_at TEXT NOT NULL,
        UNIQUE(source_connection_id, external_event_id),
        UNIQUE(source_connection_id, signal_id),
        UNIQUE(transport_hash)
      ) STRICT;
      CREATE INDEX signal_events_observed_idx ON signal_events(observed_at DESC);

      CREATE TABLE signal_incidents (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        event_type TEXT NOT NULL,
        semantic_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        seller_name TEXT NOT NULL DEFAULT '',
        seller_type TEXT NOT NULL DEFAULT 'unknown',
        offer_fingerprint TEXT NOT NULL DEFAULT '',
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
        closed_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX signal_incidents_dedupe_idx
        ON signal_incidents(semantic_key, status, last_observed_at DESC);

      CREATE TABLE signal_occurrences (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE,
        incident_id TEXT REFERENCES signal_incidents(id) ON DELETE SET NULL,
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(event_id)
      ) STRICT;

      CREATE TABLE resolution_decisions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        method TEXT NOT NULL,
        variant_id TEXT REFERENCES variants(id) ON DELETE SET NULL,
        listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        resolver_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(event_id)
      ) STRICT;

      CREATE TABLE mission_decisions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE,
        incident_id TEXT REFERENCES signal_incidents(id) ON DELETE SET NULL,
        mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL,
        strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL,
        strategy_revision INTEGER,
        outcome TEXT NOT NULL,
        reason TEXT NOT NULL,
        effective_action TEXT NOT NULL DEFAULT 'notify',
        effective_quantity INTEGER NOT NULL DEFAULT 1,
        effective_unit_cap_cents INTEGER CHECK (effective_unit_cap_cents IS NULL OR effective_unit_cap_cents > 0),
        created_at TEXT NOT NULL,
        UNIQUE(event_id, mission_id)
      ) STRICT;

      CREATE TABLE action_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
        mission_target_id TEXT NOT NULL REFERENCES mission_targets(id) ON DELETE RESTRICT,
        incident_id TEXT NOT NULL REFERENCES signal_incidents(id) ON DELETE RESTRICT,
        strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL,
        strategy_revision INTEGER,
        assigned_device_id TEXT,
        state TEXT NOT NULL,
        action TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 99),
        max_unit_price_cents INTEGER CHECK (max_unit_price_cents IS NULL OR max_unit_price_cents > 0),
        max_order_total_cents INTEGER CHECK (max_order_total_cents IS NULL OR max_order_total_cents > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        seller_policy TEXT NOT NULL,
        fulfillment TEXT NOT NULL,
        expected_seller TEXT NOT NULL DEFAULT '',
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        canonical_url TEXT NOT NULL,
        attribution_url TEXT NOT NULL DEFAULT '',
        affiliate_mode TEXT NOT NULL DEFAULT 'prefer_fallback',
        offer_fingerprint TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT NOT NULL UNIQUE,
        capability_nonce_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        leased_at TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX action_jobs_dispatch_idx ON action_jobs(state, expires_at, created_at);
      CREATE INDEX action_jobs_mission_idx ON action_jobs(mission_id, created_at DESC);

      CREATE TABLE action_events (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES action_jobs(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        message TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX action_events_job_idx ON action_events(job_id, created_at);

      CREATE TABLE extension_devices (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        extension_version TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        last_seen_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE app_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        actions_paused INTEGER NOT NULL DEFAULT 1 CHECK (actions_paused IN (0, 1)),
        pause_reason TEXT NOT NULL DEFAULT 'First-run safety pause',
        execution_mode TEXT NOT NULL DEFAULT 'shadow',
        dedupe_window_seconds INTEGER NOT NULL DEFAULT 300 CHECK (dedupe_window_seconds BETWEEN 30 AND 3600),
        affiliate_mode TEXT NOT NULL DEFAULT 'prefer_fallback',
        tax_bps INTEGER NOT NULL DEFAULT 1200 CHECK (tax_bps BETWEEN 0 AND 10000),
        store_allowances_json TEXT NOT NULL DEFAULT '{"target":3000,"walmart":3000,"amazon":3000,"bestbuy":3000}',
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        correlation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        message TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX audit_events_correlation_idx ON audit_events(correlation_id, created_at);

      CREATE TABLE outbox_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE INDEX outbox_pending_idx ON outbox_events(delivered_at, created_at);
    `
  },
  {
    version: 2,
    name: "secure_extension_device_pairing",
    sql: `
      CREATE TABLE device_pairing_codes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX device_pairing_codes_valid_idx
        ON device_pairing_codes(user_id, used_at, expires_at);
      CREATE INDEX extension_devices_user_status_idx
        ON extension_devices(user_id, status, last_seen_at DESC);

      CREATE TABLE retailer_adapter_qualifications (
        retailer_id TEXT PRIMARY KEY REFERENCES retailers(id) ON DELETE CASCADE,
        adapter_version TEXT NOT NULL,
        highest_action TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('qualified', 'suspended', 'retired')),
        evidence_hash TEXT NOT NULL,
        qualified_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `
  },
  {
    version: 3,
    name: "read_only_retailer_shadow_observations",
    sql: `
      CREATE TABLE retailer_shadow_observations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE RESTRICT,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        adapter_version TEXT NOT NULL,
        contract_version INTEGER NOT NULL,
        page_kind TEXT NOT NULL,
        retailer_sku TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        availability TEXT NOT NULL,
        unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
        currency TEXT NOT NULL,
        seller_name TEXT NOT NULL,
        seller_type TEXT NOT NULL,
        fulfillment TEXT NOT NULL,
        add_control_actionable INTEGER NOT NULL CHECK (add_control_actionable IN (0, 1)),
        security_challenge INTEGER NOT NULL CHECK (security_challenge IN (0, 1)),
        interactive_block TEXT NOT NULL,
        observation_state TEXT NOT NULL CHECK (observation_state IN ('actionable_candidate', 'not_actionable', 'manual_block')),
        evidence_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX retailer_shadow_observations_recent_idx
        ON retailer_shadow_observations(user_id, retailer_id, received_at DESC);
      CREATE INDEX retailer_shadow_observations_device_idx
        ON retailer_shadow_observations(device_id, received_at DESC);
    `
  },
  {
    version: 4,
    name: "target_add_rehearsal_receipts",
    sql: `
      CREATE TABLE retailer_adapter_trials (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE RESTRICT,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        adapter_version TEXT NOT NULL,
        observer_version TEXT NOT NULL,
        contract_version INTEGER NOT NULL,
        trial_kind TEXT NOT NULL CHECK (trial_kind IN ('pre_click_rehearsal')),
        shadow_observation_id TEXT NOT NULL REFERENCES retailer_shadow_observations(id) ON DELETE RESTRICT,
        retailer_sku TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'rejected')),
        reason_code TEXT NOT NULL,
        evidence_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        UNIQUE(device_id, adapter_version, trial_kind, shadow_observation_id)
      ) STRICT;
      CREATE INDEX retailer_adapter_trials_readiness_idx
        ON retailer_adapter_trials(user_id, retailer_id, adapter_version, outcome, received_at DESC);
    `
  },
  {
    version: 5,
    name: "trackalacker_source_bridge_and_catalog_candidates",
    sql: `
      CREATE TABLE source_product_aliases (
        id TEXT PRIMARY KEY,
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        alias_kind TEXT NOT NULL,
        alias_value TEXT NOT NULL,
        variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
        observed_at TEXT NOT NULL,
        UNIQUE(source_connection_id, alias_kind, alias_value)
      ) STRICT;
      CREATE INDEX source_product_aliases_variant_idx
        ON source_product_aliases(variant_id);

      CREATE TABLE source_variant_retailer_refs (
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        observed_at TEXT NOT NULL,
        PRIMARY KEY(source_connection_id, variant_id, retailer_id)
      ) STRICT;
      CREATE INDEX source_variant_retailer_refs_listing_idx
        ON source_variant_retailer_refs(listing_id);

      CREATE TABLE source_listing_candidates (
        id TEXT PRIMARY KEY,
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        external_product_id TEXT NOT NULL,
        external_listing_id TEXT NOT NULL,
        variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
        store_name TEXT NOT NULL,
        retailer_id TEXT NOT NULL DEFAULT '',
        retailer_sku TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL,
        outbound_url TEXT NOT NULL DEFAULT '',
        availability TEXT NOT NULL DEFAULT 'unknown',
        unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
        observed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_connection_id, external_listing_id)
      ) STRICT;
      CREATE INDEX source_listing_candidates_product_idx
        ON source_listing_candidates(source_connection_id, external_product_id);

      CREATE TABLE source_device_states (
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        ready INTEGER NOT NULL CHECK (ready IN (0, 1)),
        subscription_present INTEGER NOT NULL CHECK (subscription_present IN (0, 1)),
        pending_signals INTEGER NOT NULL DEFAULT 0 CHECK (pending_signals BETWEEN 0 AND 50),
        last_http_status INTEGER NOT NULL DEFAULT 0 CHECK (last_http_status BETWEEN 0 AND 599),
        error_code TEXT NOT NULL DEFAULT '',
        last_registration_at TEXT NOT NULL DEFAULT '',
        last_notification_at TEXT NOT NULL DEFAULT '',
        last_delivery_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(device_id, source_connection_id)
      ) STRICT;

      UPDATE retailers SET execution_supported = 0 WHERE id IN ('amazon', 'walmart', 'bestbuy');
      UPDATE retailers SET execution_supported = 1 WHERE id = 'target';
    `
  },
  {
    version: 6,
    name: "durable_chrome_notification_delivery",
    sql: `
      CREATE TABLE notification_deliveries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES action_jobs(id) ON DELETE CASCADE,
        assigned_device_id TEXT REFERENCES extension_devices(id) ON DELETE SET NULL,
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK (state IN ('pending', 'leased', 'delivered', 'clicked', 'dismissed', 'failed', 'expired')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
        capability_hash TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT NOT NULL DEFAULT '',
        delivered_at TEXT NOT NULL DEFAULT '',
        interaction_at TEXT NOT NULL DEFAULT '',
        failure_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(job_id)
      ) STRICT;
      CREATE INDEX notification_deliveries_dispatch_idx
        ON notification_deliveries(user_id, state, lease_expires_at, created_at);
      CREATE INDEX notification_deliveries_device_idx
        ON notification_deliveries(assigned_device_id, state, updated_at DESC);

      INSERT INTO notification_deliveries(
        id, tenant_id, user_id, job_id, state, created_at, updated_at
      )
      SELECT 'notification_' || id, tenant_id, user_id, id, 'pending', created_at, updated_at
      FROM action_jobs WHERE action = 'notify';
    `
  },
  {
    version: 7,
    name: "tenant_attribution_policies_and_receipts",
    sql: `
      CREATE TABLE attribution_policies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        provider TEXT NOT NULL CHECK (provider IN ('canonical', 'howl', 'amazon_associates')),
        publisher_slug TEXT NOT NULL DEFAULT '',
        article_base_url TEXT NOT NULL DEFAULT '',
        associate_tag TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, retailer_id)
      ) STRICT;

      ALTER TABLE action_jobs ADD COLUMN attribution_provider TEXT NOT NULL DEFAULT 'canonical';
      ALTER TABLE action_jobs ADD COLUMN attribution_metadata_json TEXT NOT NULL DEFAULT '{}';

      CREATE TABLE attribution_receipts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES action_jobs(id) ON DELETE CASCADE,
        policy_id TEXT REFERENCES attribution_policies(id) ON DELETE SET NULL,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        provider TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('affiliate_route', 'canonical_disabled', 'canonical_fallback', 'required_route_unavailable')),
        reason_code TEXT NOT NULL,
        route_url TEXT NOT NULL,
        canonical_url_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(job_id)
      ) STRICT;
      CREATE INDEX attribution_receipts_user_time_idx
        ON attribution_receipts(user_id, created_at DESC);
    `
  },
  {
    version: 8,
    name: "durable_source_sync_runs",
    sql: `
      CREATE TABLE source_sync_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
        device_id TEXT REFERENCES extension_devices(id) ON DELETE SET NULL,
        phase TEXT NOT NULL CHECK (phase IN ('starting', 'discovering', 'importing', 'complete', 'error')),
        page INTEGER NOT NULL DEFAULT 0 CHECK (page >= 0),
        pages INTEGER NOT NULL DEFAULT 0 CHECK (pages >= 0),
        discovered INTEGER NOT NULL DEFAULT 0 CHECK (discovered >= 0),
        processed INTEGER NOT NULL DEFAULT 0 CHECK (processed >= 0),
        imported INTEGER NOT NULL DEFAULT 0 CHECK (imported >= 0),
        failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
        message TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE INDEX source_sync_runs_user_time_idx
        ON source_sync_runs(user_id, updated_at DESC);
      CREATE INDEX source_sync_runs_active_idx
        ON source_sync_runs(device_id, phase, updated_at DESC);

      CREATE TABLE source_sync_run_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES source_sync_runs(id) ON DELETE CASCADE,
        external_product_id TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('imported', 'failed')),
        candidates_accepted INTEGER NOT NULL DEFAULT 0 CHECK (candidates_accepted >= 0),
        listings_mapped INTEGER NOT NULL DEFAULT 0 CHECK (listings_mapped >= 0),
        listings_created INTEGER NOT NULL DEFAULT 0 CHECK (listings_created >= 0),
        error_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, external_product_id)
      ) STRICT;
      CREATE INDEX source_sync_run_items_run_idx
        ON source_sync_run_items(run_id, outcome, updated_at DESC);

      CREATE INDEX audit_events_user_time_idx
        ON audit_events(user_id, created_at DESC);
      CREATE INDEX outbox_tenant_time_idx
        ON outbox_events(tenant_id, created_at DESC);
    `
  },
  {
    version: 9,
    name: "ephemeral_retailer_route_evidence",
    sql: `
      ALTER TABLE retailer_shadow_observations ADD COLUMN purchase_route_kind TEXT NOT NULL DEFAULT 'none'
        CHECK (purchase_route_kind IN ('none', 'amazon_buy_now'));
      ALTER TABLE retailer_shadow_observations ADD COLUMN purchase_route_ready INTEGER NOT NULL DEFAULT 0
        CHECK (purchase_route_ready IN (0, 1));
      ALTER TABLE retailer_shadow_observations ADD COLUMN route_reason_code TEXT NOT NULL DEFAULT 'not_applicable';
      CREATE INDEX retailer_shadow_observations_route_idx
        ON retailer_shadow_observations(user_id, retailer_id, purchase_route_ready, received_at DESC);
    `
  },
  {
    version: 10,
    name: "sanitized_retailer_adapter_diagnostics",
    sql: `
      CREATE TABLE retailer_adapter_diagnostics (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        retailer_sku TEXT NOT NULL,
        adapter_version TEXT NOT NULL,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        operation TEXT NOT NULL CHECK (operation IN ('observe', 'rehearse_add', 'live_add')),
        outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed', 'rejected', 'recovered')),
        failure_stage TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 1 AND 3),
        dom_changed INTEGER NOT NULL CHECK (dom_changed IN (0, 1)),
        layout_fingerprint TEXT NOT NULL,
        layout_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX retailer_adapter_diagnostics_recent_idx
        ON retailer_adapter_diagnostics(user_id, received_at DESC);
      CREATE INDEX retailer_adapter_diagnostics_repair_idx
        ON retailer_adapter_diagnostics(user_id, retailer_id, operation, layout_fingerprint, received_at DESC);
      CREATE INDEX retailer_adapter_diagnostics_device_idx
        ON retailer_adapter_diagnostics(device_id, received_at DESC);
    `
  },
  {
    version: 11,
    name: "bestbuy_guarded_add_baseline",
    sql: `
      UPDATE retailers SET execution_supported = 0 WHERE id = 'bestbuy';
      UPDATE listings SET execution_supported = 0 WHERE retailer_id = 'bestbuy';
      UPDATE retailer_adapter_qualifications
        SET status = 'retired'
        WHERE retailer_id = 'bestbuy';

      CREATE INDEX retailer_shadow_observations_bestbuy_gate_idx
        ON retailer_shadow_observations(user_id, adapter_version, observation_state, received_at DESC)
        WHERE retailer_id = 'bestbuy';
      CREATE INDEX retailer_adapter_trials_bestbuy_gate_idx
        ON retailer_adapter_trials(user_id, adapter_version, outcome, received_at DESC)
        WHERE retailer_id = 'bestbuy';
    `
  },
  {
    version: 12,
    name: "seven_read_only_retailers",
    sql: `
      INSERT OR IGNORE INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at) VALUES
        ('disney', 'Disney Store', 0, '["disneystore.com"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('ravensburger', 'Ravensburger', 0, '["ravensburger.us"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('riot', 'Riot Games Merch', 0, '["merch.riotgames.com"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('booksamillion', 'Books-A-Million', 0, '["booksamillion.com"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('fanatics', 'Fanatics', 0, '["fanatics.com"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('kohls', 'Kohl''s', 0, '["kohls.com"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('macys', 'Macy''s', 0, '["macys.com"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      UPDATE retailers SET execution_supported = 0
        WHERE id IN ('disney', 'ravensburger', 'riot', 'booksamillion', 'fanatics', 'kohls', 'macys');
      UPDATE listings SET execution_supported = 0
        WHERE retailer_id IN ('disney', 'ravensburger', 'riot', 'booksamillion', 'fanatics', 'kohls', 'macys');
    `
  },
  {
    version: 13,
    name: "opt_in_community_inventory_evidence",
    sql: `
      CREATE TABLE community_contribution_consents (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        location_scope TEXT NOT NULL DEFAULT '',
        privacy_version TEXT NOT NULL DEFAULT '',
        consented_at TEXT NOT NULL DEFAULT '',
        revoked_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, retailer_id)
      ) STRICT;

      CREATE TABLE community_contribution_nonces (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        nonce_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX community_contribution_nonces_device_idx
        ON community_contribution_nonces(device_id, retailer_id, expires_at DESC);

      CREATE TABLE community_inventory_assertions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
        shadow_observation_id TEXT NOT NULL,
        adapter_diagnostic_id TEXT NOT NULL DEFAULT '',
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        retailer_sku TEXT NOT NULL,
        variant_fingerprint TEXT NOT NULL,
        observation_key TEXT NOT NULL,
        availability TEXT NOT NULL CHECK (availability IN ('in_stock', 'preorder', 'out_of_stock')),
        unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
        currency TEXT NOT NULL CHECK (currency = 'USD'),
        seller_name TEXT NOT NULL DEFAULT '',
        seller_type TEXT NOT NULL CHECK (seller_type IN ('first_party', 'third_party', 'unknown')),
        fulfillment TEXT NOT NULL CHECK (fulfillment IN ('shipping', 'pickup', 'unknown')),
        location_scope TEXT NOT NULL,
        observer_version TEXT NOT NULL,
        layout_fingerprint TEXT NOT NULL,
        assertion_state TEXT NOT NULL CHECK (assertion_state IN ('accepted', 'quarantined')),
        quarantine_reason TEXT NOT NULL DEFAULT '',
        evidence_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE INDEX community_inventory_assertions_key_idx
        ON community_inventory_assertions(observation_key, expires_at DESC, received_at DESC);
      CREATE INDEX community_inventory_assertions_user_idx
        ON community_inventory_assertions(user_id, received_at DESC);
      CREATE INDEX community_inventory_assertions_device_rate_idx
        ON community_inventory_assertions(device_id, received_at DESC);

      CREATE TABLE community_contribution_receipts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
        assertion_id TEXT NOT NULL REFERENCES community_inventory_assertions(id) ON DELETE CASCADE,
        disposition TEXT NOT NULL CHECK (disposition IN ('accepted', 'deduped', 'quarantined')),
        receipt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX community_contribution_receipts_user_idx
        ON community_contribution_receipts(user_id, created_at DESC);
    `
  },
  {
    version: 14,
    name: "provenance_identity_equivalence_claims",
    sql: `
      CREATE TABLE identity_equivalence_claims (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        proposer_device_id TEXT NOT NULL DEFAULT '',
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        reference_listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        current_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
        claimed_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
        identifier_kind TEXT NOT NULL CHECK (identifier_kind IN ('gtin', 'upc', 'ean', 'isbn', 'brand_mpn')),
        normalized_identifier TEXT NOT NULL,
        identifier_hash TEXT NOT NULL,
        variant_fingerprint TEXT NOT NULL,
        attributes_json TEXT NOT NULL DEFAULT '{}',
        provenance_kind TEXT NOT NULL CHECK (provenance_kind IN ('manual_exact_identifier', 'paired_device_exact_identifier', 'trusted_source_exact_identifier')),
        provenance_note TEXT NOT NULL DEFAULT '',
        claim_state TEXT NOT NULL CHECK (claim_state IN ('pending_review', 'quarantined', 'reviewed', 'rejected')),
        conflict_reason TEXT NOT NULL DEFAULT '',
        claim_hash TEXT NOT NULL,
        reviewed_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, listing_id, reference_listing_id, identifier_hash, variant_fingerprint)
      ) STRICT;
      CREATE INDEX identity_equivalence_claims_projection_idx
        ON identity_equivalence_claims(tenant_id, listing_id, claimed_variant_id, identifier_hash, variant_fingerprint, created_at DESC);
      CREATE INDEX identity_equivalence_claims_review_idx
        ON identity_equivalence_claims(user_id, claim_state, created_at DESC);

      CREATE TABLE identity_claim_reviews (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        claim_id TEXT NOT NULL REFERENCES identity_equivalence_claims(id) ON DELETE CASCADE,
        outcome TEXT NOT NULL CHECK (outcome IN ('reviewed', 'rejected')),
        note TEXT NOT NULL DEFAULT '',
        review_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX identity_claim_reviews_claim_idx
        ON identity_claim_reviews(claim_id, created_at DESC);
    `
  },
  {
    version: 15,
    name: "signed_declarative_observer_registry",
    sql: `
      CREATE TABLE observer_recipe_candidates (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        recipe_version TEXT NOT NULL,
        minimum_extension_version TEXT NOT NULL,
        recipe_json TEXT NOT NULL,
        recipe_fingerprint TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('quarantined', 'shadow', 'canary', 'trusted_read_only', 'disabled')),
        rollback_recipe_id TEXT NOT NULL DEFAULT '',
        kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch IN (0, 1)),
        provenance_code TEXT NOT NULL,
        signature_key_id TEXT NOT NULL DEFAULT '',
        signature TEXT NOT NULL DEFAULT '',
        signed_at TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        disabled_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(retailer_id, recipe_version)
      ) STRICT;
      CREATE INDEX observer_recipe_candidates_active_idx
        ON observer_recipe_candidates(retailer_id, lifecycle_state, kill_switch, expires_at DESC, updated_at DESC);

      CREATE TABLE observer_recipe_trials (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
        recipe_id TEXT NOT NULL REFERENCES observer_recipe_candidates(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        retailer_sku TEXT NOT NULL,
        observer_version TEXT NOT NULL,
        layout_fingerprint TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
        evaluated_field_count INTEGER NOT NULL CHECK (evaluated_field_count BETWEEN 1 AND 5),
        agreed_field_count INTEGER NOT NULL CHECK (agreed_field_count BETWEEN 0 AND 5),
        ambiguous_field_count INTEGER NOT NULL CHECK (ambiguous_field_count BETWEEN 0 AND 5),
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        UNIQUE(device_id, recipe_id, retailer_sku, observed_at)
      ) STRICT;
      CREATE INDEX observer_recipe_trials_gate_idx
        ON observer_recipe_trials(recipe_id, outcome, received_at DESC);

      CREATE TABLE observer_recipe_lifecycle_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipe_id TEXT NOT NULL REFERENCES observer_recipe_candidates(id) ON DELETE CASCADE,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX observer_recipe_lifecycle_events_recipe_idx
        ON observer_recipe_lifecycle_events(recipe_id, created_at DESC);
    `
  },
  {
    version: 16,
    name: "hosted_idempotent_inbox_outbox_delivery",
    sql: `
      ALTER TABLE outbox_events ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (delivery_attempts BETWEEN 0 AND 20);
      ALTER TABLE outbox_events ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (delivery_state IN ('pending', 'delivered', 'dead_letter'));
      ALTER TABLE outbox_events ADD COLUMN lease_capability_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE outbox_events ADD COLUMN lease_expires_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE outbox_events ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE outbox_events ADD COLUMN last_error_code TEXT NOT NULL DEFAULT '';
      ALTER TABLE outbox_events ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE outbox_events SET updated_at = created_at WHERE updated_at = '';
      UPDATE outbox_events SET delivery_state = 'delivered' WHERE delivered_at != '';
      CREATE INDEX outbox_delivery_dispatch_idx
        ON outbox_events(tenant_id, delivered_at, next_attempt_at, lease_expires_at, created_at);

      CREATE TABLE inbox_messages (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        message_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'accepted'
          CHECK (state IN ('accepted', 'processing', 'processed', 'failed', 'dead_letter')),
        delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 20),
        lease_capability_hash TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT NOT NULL DEFAULT '',
        next_attempt_at TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '',
        received_at TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, user_id, source, message_key)
      ) STRICT;
      CREATE INDEX inbox_delivery_dispatch_idx
        ON inbox_messages(tenant_id, user_id, state, next_attempt_at, lease_expires_at, received_at);

      CREATE TABLE hosted_delivery_receipts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        direction TEXT NOT NULL CHECK (direction IN ('inbox', 'outbox')),
        message_id TEXT NOT NULL,
        disposition TEXT NOT NULL CHECK (disposition IN ('accepted', 'deduped', 'leased', 'processed', 'delivered', 'retry', 'dead_letter')),
        attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 20),
        reason_code TEXT NOT NULL DEFAULT '',
        receipt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX hosted_delivery_receipts_message_idx
        ON hosted_delivery_receipts(tenant_id, direction, message_id, created_at DESC);

      CREATE TABLE hosted_request_nonces (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        nonce_hash TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id, nonce_hash)
      ) STRICT;
      CREATE INDEX hosted_request_nonces_expiry_idx
        ON hosted_request_nonces(expires_at);
    `
  },
  {
    version: 17,
    name: "user_scoped_retailer_mutation_qualifications",
    sql: `
      ALTER TABLE retailer_adapter_qualifications RENAME TO retailer_adapter_qualifications_legacy;
      CREATE TABLE retailer_adapter_qualifications (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
        adapter_version TEXT NOT NULL,
        highest_action TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('qualified', 'suspended', 'retired')),
        evidence_hash TEXT NOT NULL,
        qualified_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, retailer_id)
      ) STRICT;
      INSERT OR IGNORE INTO tenants(id, name, created_at)
        VALUES ('tenant_local', 'Local', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      INSERT OR IGNORE INTO users(id, tenant_id, display_name, created_at)
        VALUES ('user_local', 'tenant_local', 'Local user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      INSERT INTO retailer_adapter_qualifications(
        tenant_id, user_id, retailer_id, adapter_version, highest_action,
        status, evidence_hash, qualified_at, updated_at
      )
      SELECT 'tenant_local', 'user_local', retailer_id, adapter_version,
             highest_action, status, evidence_hash, qualified_at, updated_at
      FROM retailer_adapter_qualifications_legacy;
      DROP TABLE retailer_adapter_qualifications_legacy;
      CREATE INDEX retailer_adapter_qualifications_tenant_idx
        ON retailer_adapter_qualifications(tenant_id, retailer_id, status);
    `
  },
  {
    version: 18,
    name: "premium_bandai_and_pokemon_center_read_only",
    sql: `
      INSERT OR IGNORE INTO retailers(id, display_name, execution_supported, domains_json, created_at, updated_at) VALUES
        ('pbandai', 'Premium Bandai', 0, '["p-bandai.com"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('pokemoncenter', 'Pokémon Center', 0, '["pokemoncenter.com"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      UPDATE retailers SET execution_supported = 0 WHERE id IN ('pbandai', 'pokemoncenter');
      UPDATE listings SET execution_supported = 0 WHERE retailer_id IN ('pbandai', 'pokemoncenter');

      INSERT OR IGNORE INTO attribution_policies(
        id, tenant_id, user_id, retailer_id, enabled, provider,
        publisher_slug, article_base_url, associate_tag, created_at, updated_at
      )
      SELECT 'attribution_pbandai_' || lower(hex(randomblob(12))), tenant_id, id,
             'pbandai', 0, 'canonical', '', '', '',
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM users;

      INSERT OR IGNORE INTO attribution_policies(
        id, tenant_id, user_id, retailer_id, enabled, provider,
        publisher_slug, article_base_url, associate_tag, created_at, updated_at
      )
      SELECT 'attribution_pokemoncenter_' || lower(hex(randomblob(12))), tenant_id, id,
             'pokemoncenter', 0, 'canonical', '', '', '',
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM users;
    `
  },
  {
    version: 19,
    name: "bestbuy_v4_v3_requalification_boundary",
    sql: `
      UPDATE retailers SET execution_supported = 0 WHERE id = 'bestbuy';
      UPDATE listings SET execution_supported = 0 WHERE retailer_id = 'bestbuy';
      UPDATE retailer_adapter_qualifications
        SET status = 'retired', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE retailer_id = 'bestbuy';
    `
  },
  {
    version: 20,
    name: "persisted_role_permissions_and_memberships",
    sql: `
      CREATE TABLE authorization_permissions (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE authorization_roles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 1 CHECK (built_in IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE authorization_role_permissions (
        role_id TEXT NOT NULL REFERENCES authorization_roles(id) ON DELETE CASCADE,
        permission_id TEXT NOT NULL REFERENCES authorization_permissions(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(role_id, permission_id)
      ) STRICT;
      CREATE INDEX authorization_role_permissions_permission_idx
        ON authorization_role_permissions(permission_id, role_id);

      CREATE UNIQUE INDEX users_tenant_id_id_unique ON users(tenant_id, id);
      CREATE TABLE authorization_memberships (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL REFERENCES authorization_roles(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
        granted_by_actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, role_id),
        FOREIGN KEY(tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX authorization_memberships_tenant_status_idx
        ON authorization_memberships(tenant_id, status, role_id);

      INSERT INTO authorization_permissions(id, description, created_at) VALUES
        ('user.read', 'Read the authenticated user workspace.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('user.intent.manage', 'Create and update the authenticated user purchase intents.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('user.settings.manage', 'Update the authenticated user preferences and safety controls.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('user.device.manage', 'Pair and revoke devices belonging to the authenticated user.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('user.community.manage', 'Manage the authenticated user community contribution consent and claims.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('user.catalog.propose', 'Propose catalog changes for governed review.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('user.attribution.manage', 'Manage the authenticated user affiliate attribution preferences.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('admin.read', 'Read tenant administration state.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('support.read', 'Read redacted support and diagnostic state.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('catalog.review', 'Review and decide governed catalog proposals.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('identity.review', 'Review product identity equivalence claims.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('affiliate.manage', 'Manage tenant affiliate provider configuration.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('retailer.manage', 'Manage tenant retailer configuration.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('recipe.manage', 'Promote, disable, and roll back observer recipes.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('qualification.manage', 'Activate or retire guarded retailer mutation qualifications.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('source.manage', 'Manage tenant signal-source configuration.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('security.manage', 'Manage persisted roles and role memberships.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('user.lifecycle.manage', 'Manage tenant user lifecycle state.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('alert.manage', 'Manage tenant alert routing and escalation configuration.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('internal.delivery', 'Process trusted hosted inbox and outbox delivery.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('internal.principal', 'Provision hosted tenant and user principals.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('device.self', 'Use authenticated device-scoped companion endpoints.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      INSERT INTO authorization_roles(id, display_name, description, built_in, created_at, updated_at) VALUES
        ('yoink_user', 'Yoink user', 'Standard access to a private Yoink workspace.', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('support_readonly', 'Support read-only', 'Redacted administration and diagnostic read access.', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('catalog_curator', 'Catalog curator', 'Review catalog proposals and product identity claims.', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('affiliate_manager', 'Affiliate manager', 'Manage affiliate provider configuration.', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('retailer_maintainer', 'Retailer maintainer', 'Manage retailers, sources, recipes, and qualification gates.', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('security_admin', 'Security administrator', 'Manage roles, users, and alert configuration.', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('tenant_admin', 'Tenant administrator', 'Full tenant administration access.', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      INSERT INTO authorization_role_permissions(role_id, permission_id, created_at) VALUES
        ('yoink_user', 'user.read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('yoink_user', 'user.intent.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('yoink_user', 'user.settings.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('yoink_user', 'user.device.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('yoink_user', 'user.community.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('yoink_user', 'user.catalog.propose', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('yoink_user', 'user.attribution.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('support_readonly', 'admin.read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('support_readonly', 'support.read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('catalog_curator', 'admin.read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('catalog_curator', 'catalog.review', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('catalog_curator', 'identity.review', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('affiliate_manager', 'admin.read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('affiliate_manager', 'affiliate.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('retailer_maintainer', 'admin.read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('retailer_maintainer', 'retailer.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('retailer_maintainer', 'recipe.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('retailer_maintainer', 'qualification.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('retailer_maintainer', 'source.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('security_admin', 'admin.read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('security_admin', 'security.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('security_admin', 'user.lifecycle.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('security_admin', 'alert.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      INSERT INTO authorization_role_permissions(role_id, permission_id, created_at)
      SELECT 'tenant_admin', id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM authorization_permissions
      WHERE id LIKE 'admin.%'
         OR id IN (
           'support.read', 'catalog.review', 'identity.review', 'affiliate.manage',
           'retailer.manage', 'recipe.manage', 'qualification.manage', 'source.manage',
           'security.manage', 'user.lifecycle.manage', 'alert.manage'
         );

      INSERT INTO authorization_memberships(
        tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
      )
      SELECT tenant_id, id, 'yoink_user', 'active', 'migration_20',
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM users;
    `
  },
  {
    version: 21,
    name: "governed_catalog_change_proposals",
    sql: `
      CREATE TABLE catalog_change_proposals (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        proposer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        proposer_actor_kind TEXT NOT NULL CHECK (proposer_actor_kind IN ('maintainer', 'user', 'device', 'service')),
        proposer_actor_id TEXT NOT NULL,
        proposal_kind TEXT NOT NULL CHECK (proposal_kind = 'listing_upsert'),
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        retailer_sku TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
        review_note TEXT NOT NULL DEFAULT '',
        reviewed_by_actor_id TEXT NOT NULL DEFAULT '',
        decided_at TEXT NOT NULL DEFAULT '',
        applied_listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX catalog_change_proposals_review_queue_idx
        ON catalog_change_proposals(tenant_id, status, created_at, id);
      CREATE INDEX catalog_change_proposals_proposer_idx
        ON catalog_change_proposals(proposer_user_id, created_at DESC, id DESC);
      CREATE UNIQUE INDEX catalog_change_proposals_pending_payload_unique
        ON catalog_change_proposals(tenant_id, payload_hash) WHERE status = 'pending';
    `
  },
  {
    version: 22,
    name: "exact_offer_intent_and_spend_safety",
    sql: `
      CREATE TABLE exact_offer_keys (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        retailer_sku TEXT NOT NULL,
        child_offer_key TEXT NOT NULL DEFAULT '',
        attributes_json TEXT NOT NULL DEFAULT '{}',
        condition_code TEXT NOT NULL DEFAULT 'new',
        seller_name TEXT NOT NULL DEFAULT '',
        seller_key TEXT NOT NULL DEFAULT '',
        seller_type TEXT NOT NULL CHECK (seller_type IN ('first_party', 'third_party', 'unknown')),
        fulfillment TEXT NOT NULL CHECK (fulfillment IN ('shipping', 'pickup', 'either', 'manual', 'unknown')),
        region_scope TEXT NOT NULL DEFAULT '',
        store_scope TEXT NOT NULL DEFAULT '',
        identity_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(tenant_id, identity_hash)
      ) STRICT;
      CREATE INDEX exact_offer_keys_listing_idx
        ON exact_offer_keys(tenant_id, listing_id, created_at DESC);

      CREATE TABLE mission_intent_revisions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
        currency TEXT NOT NULL DEFAULT 'USD',
        max_all_in_cents INTEGER CHECK (max_all_in_cents IS NULL OR max_all_in_cents > 0),
        action_ceiling TEXT NOT NULL CHECK (action_ceiling IN ('notify', 'add_to_cart', 'prepare_checkout', 'submit_order')),
        substitution_policy TEXT NOT NULL CHECK (substitution_policy IN ('exact_only', 'verified_equivalent')),
        expires_at TEXT NOT NULL DEFAULT '',
        cooldown_seconds INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_seconds BETWEEN 0 AND 2592000),
        target_policy_json TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        change_reason TEXT NOT NULL DEFAULT '',
        created_by_actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(mission_id, revision),
        UNIQUE(mission_id, policy_hash)
      ) STRICT;
      CREATE INDEX mission_intent_revisions_current_idx
        ON mission_intent_revisions(mission_id, revision DESC);

      CREATE TABLE offer_snapshots (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
        intent_revision_id TEXT NOT NULL REFERENCES mission_intent_revisions(id) ON DELETE RESTRICT,
        exact_offer_key_id TEXT NOT NULL REFERENCES exact_offer_keys(id) ON DELETE RESTRICT,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        source_observation_id TEXT REFERENCES offer_observations(id) ON DELETE RESTRICT,
        incident_id TEXT REFERENCES signal_incidents(id) ON DELETE RESTRICT,
        availability TEXT NOT NULL CHECK (availability IN ('in_stock', 'preorder', 'out_of_stock', 'unknown')),
        unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
        item_subtotal_cents INTEGER CHECK (item_subtotal_cents IS NULL OR item_subtotal_cents > 0),
        maximum_all_in_cents INTEGER CHECK (maximum_all_in_cents IS NULL OR maximum_all_in_cents > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        seller_name TEXT NOT NULL DEFAULT '',
        seller_type TEXT NOT NULL CHECK (seller_type IN ('first_party', 'third_party', 'unknown')),
        fulfillment TEXT NOT NULL CHECK (fulfillment IN ('shipping', 'pickup', 'either', 'manual', 'unknown')),
        offer_fingerprint TEXT NOT NULL DEFAULT '',
        evidence_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, evidence_hash)
      ) STRICT;
      CREATE INDEX offer_snapshots_mission_idx
        ON offer_snapshots(mission_id, observed_at DESC);

      CREATE TABLE user_spend_policies (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        currency TEXT NOT NULL DEFAULT 'USD',
        per_order_cap_cents INTEGER CHECK (per_order_cap_cents IS NULL OR per_order_cap_cents > 0),
        daily_cap_cents INTEGER CHECK (daily_cap_cents IS NULL OR daily_cap_cents > 0),
        monthly_cap_cents INTEGER CHECK (monthly_cap_cents IS NULL OR monthly_cap_cents > 0),
        order_submission_enabled INTEGER NOT NULL DEFAULT 0 CHECK (order_submission_enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE spend_reservations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
        intent_revision_id TEXT NOT NULL REFERENCES mission_intent_revisions(id) ON DELETE RESTRICT,
        exact_offer_key_id TEXT NOT NULL REFERENCES exact_offer_keys(id) ON DELETE RESTRICT,
        offer_snapshot_id TEXT NOT NULL REFERENCES offer_snapshots(id) ON DELETE RESTRICT,
        action_job_id TEXT NOT NULL REFERENCES action_jobs(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('add_to_cart', 'prepare_checkout', 'submit_order')),
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
        reserved_amount_cents INTEGER NOT NULL CHECK (reserved_amount_cents > 0),
        committed_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (committed_amount_cents >= 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'committed', 'released')),
        release_reason TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, idempotency_key),
        UNIQUE(action_job_id)
      ) STRICT;
      CREATE INDEX spend_reservations_active_user_idx
        ON spend_reservations(user_id, status, expires_at, created_at);
      CREATE INDEX spend_reservations_active_mission_idx
        ON spend_reservations(mission_id, status, created_at);

      CREATE TABLE spend_ledger_entries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reservation_id TEXT NOT NULL REFERENCES spend_reservations(id) ON DELETE RESTRICT,
        action_job_id TEXT NOT NULL REFERENCES action_jobs(id) ON DELETE RESTRICT,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('reserved', 'released', 'committed', 'refunded', 'adjusted')),
        reserved_delta_cents INTEGER NOT NULL,
        spent_delta_cents INTEGER NOT NULL,
        quantity_delta INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        reason_code TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX spend_ledger_user_time_idx
        ON spend_ledger_entries(user_id, created_at DESC, id DESC);
      CREATE INDEX spend_ledger_reservation_idx
        ON spend_ledger_entries(reservation_id, created_at, id);

      ALTER TABLE action_jobs ADD COLUMN intent_revision_id TEXT REFERENCES mission_intent_revisions(id) ON DELETE RESTRICT;
      ALTER TABLE action_jobs ADD COLUMN exact_offer_key_id TEXT REFERENCES exact_offer_keys(id) ON DELETE RESTRICT;
      ALTER TABLE action_jobs ADD COLUMN offer_snapshot_id TEXT REFERENCES offer_snapshots(id) ON DELETE RESTRICT;
      ALTER TABLE action_jobs ADD COLUMN spend_reservation_id TEXT REFERENCES spend_reservations(id) ON DELETE RESTRICT;

      CREATE TRIGGER mission_intent_revisions_no_update
      BEFORE UPDATE ON mission_intent_revisions
      BEGIN SELECT RAISE(ABORT, 'mission intent revisions are append-only'); END;
      CREATE TRIGGER mission_intent_revisions_no_delete
      BEFORE DELETE ON mission_intent_revisions
      BEGIN SELECT RAISE(ABORT, 'mission intent revisions are append-only'); END;
      CREATE TRIGGER exact_offer_keys_no_update
      BEFORE UPDATE ON exact_offer_keys
      BEGIN SELECT RAISE(ABORT, 'exact offer keys are immutable'); END;
      CREATE TRIGGER exact_offer_keys_no_delete
      BEFORE DELETE ON exact_offer_keys
      BEGIN SELECT RAISE(ABORT, 'exact offer keys are immutable'); END;
      CREATE TRIGGER offer_snapshots_no_update
      BEFORE UPDATE ON offer_snapshots
      BEGIN SELECT RAISE(ABORT, 'offer snapshots are immutable'); END;
      CREATE TRIGGER offer_snapshots_no_delete
      BEFORE DELETE ON offer_snapshots
      BEGIN SELECT RAISE(ABORT, 'offer snapshots are immutable'); END;
      CREATE TRIGGER spend_ledger_entries_no_update
      BEFORE UPDATE ON spend_ledger_entries
      BEGIN SELECT RAISE(ABORT, 'spend ledger entries are append-only'); END;
      CREATE TRIGGER spend_ledger_entries_no_delete
      BEFORE DELETE ON spend_ledger_entries
      BEGIN SELECT RAISE(ABORT, 'spend ledger entries are append-only'); END;

      INSERT INTO user_spend_policies(
        user_id, tenant_id, revision, currency, per_order_cap_cents,
        daily_cap_cents, monthly_cap_cents, order_submission_enabled,
        created_at, updated_at
      )
      SELECT id, tenant_id, 1, 'USD', NULL, NULL, NULL, 0,
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM users;

      INSERT INTO mission_intent_revisions(
        id, tenant_id, user_id, mission_id, revision, quantity, currency,
        max_all_in_cents, action_ceiling, substitution_policy, expires_at,
        cooldown_seconds, target_policy_json, policy_hash, change_reason,
        created_by_actor_id, created_at
      )
      SELECT 'intent_revision_m22_' || m.id, m.tenant_id, m.user_id, m.id, 1,
             m.target_quantity,
             COALESCE((SELECT mt.currency FROM mission_targets mt WHERE mt.mission_id = m.id ORDER BY mt.id LIMIT 1), 'USD'),
             NULL, 'add_to_cart', 'exact_only', '', 0,
             COALESCE((
               SELECT json_group_array(json(target_json)) FROM (
                 SELECT json_object(
                   'targetId', mt.id,
                   'listingId', mt.listing_id,
                   'retailerId', l.retailer_id,
                   'enabled', json(CASE WHEN mt.enabled = 1 THEN 'true' ELSE 'false' END),
                   'maxUnitPriceCents', mt.max_unit_price_cents,
                   'sellerPolicy', mt.seller_policy,
                   'fulfillment', mt.fulfillment
                 ) AS target_json
                 FROM mission_targets mt JOIN listings l ON l.id = mt.listing_id
                 WHERE mt.mission_id = m.id ORDER BY mt.id
               )
             ), '[]'),
             'migration22:' || m.id, 'Backfilled from the current mission preferences.',
             'migration_22', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM missions m;
    `
  }
]);
