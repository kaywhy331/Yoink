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
  },
  {
    version: 23,
    name: "reversible_catalog_identity_governance",
    sql: `
      INSERT INTO authorization_permissions(id, description, created_at) VALUES
        ('catalog.identity.propose', 'Propose governed catalog merge, split, and compensating rollback operations.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('catalog.identity.approve', 'Approve or reject governed catalog identity operations.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      INSERT INTO authorization_role_permissions(role_id, permission_id, created_at) VALUES
        ('catalog_curator', 'catalog.identity.propose', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('catalog_curator', 'catalog.identity.approve', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('tenant_admin', 'catalog.identity.propose', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('tenant_admin', 'catalog.identity.approve', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      CREATE TABLE catalog_identity_operations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        operation_kind TEXT NOT NULL CHECK (operation_kind IN ('merge_variants', 'split_variant', 'rollback')),
        requested_by_user_id TEXT NOT NULL,
        requested_by_actor_kind TEXT NOT NULL,
        requested_by_actor_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        base_state_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
        requires_distinct_approver INTEGER NOT NULL DEFAULT 0 CHECK (requires_distinct_approver IN (0, 1)),
        review_note TEXT NOT NULL DEFAULT '',
        reviewed_by_actor_id TEXT NOT NULL DEFAULT '',
        decided_at TEXT NOT NULL DEFAULT '',
        applied_at TEXT NOT NULL DEFAULT '',
        reversed_operation_id TEXT REFERENCES catalog_identity_operations(id) ON DELETE CASCADE,
        reverted_by_operation_id TEXT REFERENCES catalog_identity_operations(id) ON DELETE CASCADE,
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX catalog_identity_operations_pending_payload_idx
        ON catalog_identity_operations(tenant_id, payload_hash) WHERE status = 'pending';
      CREATE UNIQUE INDEX catalog_identity_operations_one_rollback_idx
        ON catalog_identity_operations(reversed_operation_id)
        WHERE reversed_operation_id IS NOT NULL AND status = 'applied';
      CREATE INDEX catalog_identity_operations_review_idx
        ON catalog_identity_operations(tenant_id, status, created_at, id);

      CREATE TABLE catalog_identity_operation_snapshots (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL REFERENCES catalog_identity_operations(id) ON DELETE CASCADE,
        phase TEXT NOT NULL CHECK (phase IN ('before', 'after')),
        snapshot_json TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(operation_id, phase)
      ) STRICT;

      CREATE TABLE catalog_identity_operation_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL REFERENCES catalog_identity_operations(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN ('proposed', 'approved', 'rejected', 'applied', 'compensated')),
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(operation_id, sequence)
      ) STRICT;
      CREATE INDEX catalog_identity_operation_events_history_idx
        ON catalog_identity_operation_events(operation_id, sequence);

      CREATE TRIGGER catalog_identity_operation_snapshots_no_update
      BEFORE UPDATE ON catalog_identity_operation_snapshots
      BEGIN SELECT RAISE(ABORT, 'catalog identity snapshots are immutable'); END;
      CREATE TRIGGER catalog_identity_operation_snapshots_no_delete
      BEFORE DELETE ON catalog_identity_operation_snapshots
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'catalog identity snapshots are immutable'); END;
      CREATE TRIGGER catalog_identity_operation_events_no_update
      BEFORE UPDATE ON catalog_identity_operation_events
      BEGIN SELECT RAISE(ABORT, 'catalog identity events are append-only'); END;
      CREATE TRIGGER catalog_identity_operation_events_no_delete
      BEFORE DELETE ON catalog_identity_operation_events
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'catalog identity events are append-only'); END;
    `
  },
  {
    version: 24,
    name: "walmart_draw_observation_ledger",
    sql: `
      CREATE TABLE walmart_draw_scans (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
        adapter_version TEXT NOT NULL,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'partial', 'failed', 'manual')),
        reason_code TEXT NOT NULL,
        expected_card_count INTEGER NOT NULL CHECK (expected_card_count BETWEEN 0 AND 24),
        observed_card_count INTEGER NOT NULL CHECK (observed_card_count BETWEEN 0 AND 24),
        security_challenge INTEGER NOT NULL CHECK (security_challenge IN (0, 1)),
        interactive_block TEXT NOT NULL CHECK (interactive_block IN ('', 'auth', 'mfa', 'location', 'membership', 'queue', 'unknown')),
        evidence_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        UNIQUE(device_id, evidence_hash)
      ) STRICT;
      CREATE INDEX walmart_draw_scans_user_time_idx
        ON walmart_draw_scans(user_id, observed_at DESC, id DESC);
      CREATE INDEX walmart_draw_scans_failure_idx
        ON walmart_draw_scans(tenant_id, outcome, reason_code, observed_at DESC);

      CREATE TABLE walmart_draw_items (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scan_id TEXT NOT NULL REFERENCES walmart_draw_scans(id) ON DELETE CASCADE,
        retailer_sku TEXT NOT NULL,
        title TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
        currency TEXT NOT NULL CHECK (currency = 'USD'),
        seller_name TEXT NOT NULL DEFAULT '',
        seller_type TEXT NOT NULL CHECK (seller_type IN ('first_party', 'third_party', 'unknown')),
        draw_state TEXT NOT NULL CHECK (draw_state IN ('active', 'upcoming', 'closed', 'unknown')),
        closes_at TEXT NOT NULL DEFAULT '',
        condition_code INTEGER,
        condition_group_code INTEGER,
        order_min_limit INTEGER CHECK (order_min_limit IS NULL OR order_min_limit BETWEEN 1 AND 99),
        order_max_limit INTEGER CHECK (order_max_limit IS NULL OR order_max_limit BETWEEN 1 AND 99),
        draw_control_present INTEGER NOT NULL CHECK (draw_control_present IN (0, 1)),
        add_control_suppressed INTEGER NOT NULL CHECK (add_control_suppressed IN (0, 1)),
        evidence_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        UNIQUE(scan_id, retailer_sku)
      ) STRICT;
      CREATE INDEX walmart_draw_items_current_idx
        ON walmart_draw_items(user_id, retailer_sku, observed_at DESC, id DESC);
      CREATE INDEX walmart_draw_items_close_idx
        ON walmart_draw_items(user_id, draw_state, closes_at, observed_at DESC);
    `
  },
  {
    version: 25,
    name: "privacy_classified_operator_alerts",
    sql: `
      CREATE TABLE operator_alert_rules (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_family TEXT NOT NULL CHECK (event_family = 'adapter_repair'),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
        minimum_occurrences INTEGER NOT NULL CHECK (minimum_occurrences BETWEEN 1 AND 100),
        dedupe_window_seconds INTEGER NOT NULL CHECK (dedupe_window_seconds BETWEEN 60 AND 86400),
        escalation_after_seconds INTEGER NOT NULL CHECK (
          escalation_after_seconds = 0 OR escalation_after_seconds BETWEEN 300 AND 604800
        ),
        retailer_scope TEXT NOT NULL DEFAULT '*',
        operation_scope TEXT NOT NULL DEFAULT '*',
        routes_json TEXT NOT NULL,
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        created_by_actor_id TEXT NOT NULL,
        updated_by_actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, event_family, name)
      ) STRICT;
      CREATE INDEX operator_alert_rules_tenant_enabled_idx
        ON operator_alert_rules(tenant_id, enabled, event_family, updated_at DESC);

      CREATE TABLE operator_alert_incidents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL REFERENCES operator_alert_rules(id) ON DELETE RESTRICT,
        event_family TEXT NOT NULL CHECK (event_family = 'adapter_repair'),
        incident_key_hash TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
        status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        operation TEXT NOT NULL CHECK (operation IN ('observe', 'rehearse_add', 'live_add')),
        failure_stage TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        layout_fingerprint TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL CHECK (occurrence_count >= 1),
        affected_entity_count INTEGER NOT NULL CHECK (affected_entity_count >= 1),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_failure_at TEXT NOT NULL,
        last_routed_at TEXT NOT NULL DEFAULT '',
        escalated_at TEXT NOT NULL DEFAULT '',
        acknowledged_by_actor_id TEXT NOT NULL DEFAULT '',
        acknowledged_at TEXT NOT NULL DEFAULT '',
        resolved_by_actor_id TEXT NOT NULL DEFAULT '',
        resolved_at TEXT NOT NULL DEFAULT '',
        resolution_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX operator_alert_incidents_active_unique
        ON operator_alert_incidents(tenant_id, subject_user_id, rule_id, incident_key_hash)
        WHERE status IN ('open', 'acknowledged');
      CREATE INDEX operator_alert_incidents_queue_idx
        ON operator_alert_incidents(tenant_id, status, severity, last_seen_at DESC, id DESC);

      CREATE TABLE operator_alert_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        incident_id TEXT NOT NULL REFERENCES operator_alert_incidents(id) ON DELETE RESTRICT,
        rule_id TEXT NOT NULL REFERENCES operator_alert_rules(id) ON DELETE RESTRICT,
        event_type TEXT NOT NULL CHECK (event_type IN (
          'opened', 'repeated', 'escalated', 'acknowledged', 'resolved', 'auto_resolved'
        )),
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
        reason_code TEXT NOT NULL,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('maintainer', 'user', 'device', 'service')),
        actor_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX operator_alert_events_incident_idx
        ON operator_alert_events(incident_id, created_at DESC, id DESC);

      CREATE TABLE operator_alert_deliveries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        incident_id TEXT NOT NULL REFERENCES operator_alert_incidents(id) ON DELETE RESTRICT,
        event_id TEXT NOT NULL REFERENCES operator_alert_events(id) ON DELETE RESTRICT,
        route_kind TEXT NOT NULL CHECK (route_kind IN ('dashboard', 'audit_outbox')),
        delivery_state TEXT NOT NULL CHECK (delivery_state IN ('delivered', 'queued')),
        outbox_event_id TEXT REFERENCES outbox_events(id) ON DELETE RESTRICT,
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX operator_alert_deliveries_incident_idx
        ON operator_alert_deliveries(incident_id, created_at DESC, id DESC);

      CREATE TRIGGER operator_alert_events_no_update
      BEFORE UPDATE ON operator_alert_events
      BEGIN SELECT RAISE(ABORT, 'operator alert events are append-only'); END;
      CREATE TRIGGER operator_alert_events_no_delete
      BEFORE DELETE ON operator_alert_events
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'operator alert events are append-only'); END;
      CREATE TRIGGER operator_alert_deliveries_no_update
      BEFORE UPDATE ON operator_alert_deliveries
      BEGIN SELECT RAISE(ABORT, 'operator alert deliveries are append-only'); END;
      CREATE TRIGGER operator_alert_deliveries_no_delete
      BEFORE DELETE ON operator_alert_deliveries
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'operator alert deliveries are append-only'); END;

      INSERT INTO operator_alert_rules(
        id, tenant_id, event_family, name, enabled, severity,
        minimum_occurrences, dedupe_window_seconds, escalation_after_seconds,
        retailer_scope, operation_scope, routes_json, privacy_classification,
        created_by_actor_id, updated_by_actor_id, created_at, updated_at
      )
      SELECT 'alert_rule_' || lower(hex(randomblob(16))), id, 'adapter_repair',
             'All adapter repair failures', 1, 'warning', 1, 900, 3600,
             '*', '*', '["dashboard","audit_outbox"]', 'operational_configuration',
             'migration_25', 'migration_25',
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM tenants;
    `
  },
  {
    version: 26,
    name: "rooted_observer_recipe_trust",
    sql: `
      ALTER TABLE observer_recipe_candidates
        ADD COLUMN trust_manifest_generation INTEGER NOT NULL DEFAULT 0 CHECK (trust_manifest_generation >= 0);
      ALTER TABLE observer_recipe_candidates
        ADD COLUMN trust_manifest_hash TEXT NOT NULL DEFAULT '';

      INSERT INTO observer_recipe_lifecycle_events(
        id, tenant_id, user_id, recipe_id, from_state, to_state,
        reason_code, event_hash, created_at
      )
      SELECT 'observer_recipe_event_' || lower(hex(randomblob(16))), tenant_id, user_id, id,
             lifecycle_state, 'disabled', 'rooted_trust_upgrade_required', lower(hex(randomblob(32))),
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM observer_recipe_candidates
      WHERE lifecycle_state IN ('shadow', 'canary', 'trusted_read_only')
         OR (kill_switch = 0 AND signature != '');

      UPDATE observer_recipe_candidates
      SET lifecycle_state = 'disabled', kill_switch = 1,
          disabled_reason = 'rooted_trust_upgrade_required',
          signature_key_id = '', signature = '', signed_at = '',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE lifecycle_state IN ('shadow', 'canary', 'trusted_read_only')
         OR (kill_switch = 0 AND signature != '');

      CREATE TABLE observer_recipe_trust_manifests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL CHECK (generation > 0),
        root_key_id TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        previous_manifest_hash TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        signature TEXT NOT NULL,
        active_intermediate_key_id TEXT NOT NULL DEFAULT '',
        revoked_key_ids_json TEXT NOT NULL DEFAULT '[]',
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        installed_by_actor_id TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        UNIQUE(tenant_id, generation),
        UNIQUE(tenant_id, manifest_hash)
      ) STRICT;
      CREATE INDEX observer_recipe_trust_manifest_current_idx
        ON observer_recipe_trust_manifests(tenant_id, generation DESC, installed_at DESC);

      CREATE TABLE observer_recipe_transparency_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        event_type TEXT NOT NULL CHECK (event_type IN ('manifest_installed', 'recipe_signed')),
        manifest_generation INTEGER NOT NULL CHECK (manifest_generation > 0),
        manifest_hash TEXT NOT NULL,
        signing_key_id TEXT NOT NULL DEFAULT '',
        subject_hash TEXT NOT NULL,
        previous_event_hash TEXT NOT NULL DEFAULT '',
        event_hash TEXT NOT NULL,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('maintainer', 'user', 'device', 'service')),
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(tenant_id, sequence),
        UNIQUE(tenant_id, event_hash)
      ) STRICT;
      CREATE INDEX observer_recipe_transparency_recent_idx
        ON observer_recipe_transparency_events(tenant_id, sequence DESC);

      CREATE TRIGGER observer_recipe_trust_manifests_no_update
      BEFORE UPDATE ON observer_recipe_trust_manifests
      BEGIN SELECT RAISE(ABORT, 'observer recipe trust manifests are append-only'); END;
      CREATE TRIGGER observer_recipe_trust_manifests_no_delete
      BEFORE DELETE ON observer_recipe_trust_manifests
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'observer recipe trust manifests are append-only'); END;
      CREATE TRIGGER observer_recipe_transparency_no_update
      BEFORE UPDATE ON observer_recipe_transparency_events
      BEGIN SELECT RAISE(ABORT, 'observer recipe transparency is append-only'); END;
      CREATE TRIGGER observer_recipe_transparency_no_delete
      BEFORE DELETE ON observer_recipe_transparency_events
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'observer recipe transparency is append-only'); END;
    `
  },
  {
    version: 27,
    name: "exact_selected_offer_community_scope",
    sql: `
      ALTER TABLE retailer_shadow_observations
        ADD COLUMN selected_offer_schema_version INTEGER NOT NULL DEFAULT 0
          CHECK (selected_offer_schema_version IN (0, 1));
      ALTER TABLE retailer_shadow_observations
        ADD COLUMN selected_offer_state TEXT NOT NULL DEFAULT 'unresolved'
          CHECK (selected_offer_state IN ('exact', 'listing_only', 'unresolved'));
      ALTER TABLE retailer_shadow_observations
        ADD COLUMN child_offer_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE retailer_shadow_observations
        ADD COLUMN variant_attributes_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE retailer_shadow_observations
        ADD COLUMN selected_offer_fingerprint TEXT NOT NULL DEFAULT '';
      CREATE INDEX retailer_shadow_observations_selected_offer_idx
        ON retailer_shadow_observations(
          user_id, retailer_id, selected_offer_fingerprint, received_at DESC
        );

      ALTER TABLE community_inventory_assertions
        ADD COLUMN selected_offer_state TEXT NOT NULL DEFAULT 'unresolved'
          CHECK (selected_offer_state IN ('exact', 'listing_only', 'unresolved'));
      ALTER TABLE community_inventory_assertions
        ADD COLUMN child_offer_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE community_inventory_assertions
        ADD COLUMN variant_attributes_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE community_inventory_assertions
        ADD COLUMN selected_offer_fingerprint TEXT NOT NULL DEFAULT '';
      CREATE INDEX community_inventory_assertions_selected_offer_idx
        ON community_inventory_assertions(
          selected_offer_fingerprint, location_scope, expires_at DESC, received_at DESC
        );
    `
  },
  {
    version: 28,
    name: "bestbuy_v5_requalification_boundary",
    sql: `
      UPDATE retailers SET execution_supported = 0 WHERE id = 'bestbuy';
      UPDATE listings SET execution_supported = 0 WHERE retailer_id = 'bestbuy';
      UPDATE retailer_adapter_qualifications
        SET status = 'retired', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE retailer_id = 'bestbuy';
    `
  },
  {
    version: 29,
    name: "externally_witnessed_observer_recipe_checkpoints",
    sql: `
      CREATE TABLE observer_recipe_witness_receipts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        log_id TEXT NOT NULL,
        witness_key_id TEXT NOT NULL,
        witness_sequence INTEGER NOT NULL CHECK (witness_sequence > 0),
        checkpoint_hash TEXT NOT NULL,
        manifest_generation INTEGER NOT NULL CHECK (manifest_generation > 0),
        manifest_hash TEXT NOT NULL,
        transparency_sequence INTEGER NOT NULL CHECK (transparency_sequence > 0),
        transparency_event_hash TEXT NOT NULL,
        previous_receipt_hash TEXT NOT NULL DEFAULT '',
        receipt_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        signature TEXT NOT NULL,
        witnessed_at TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        received_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id, transparency_event_hash)
          REFERENCES observer_recipe_transparency_events(tenant_id, event_hash) ON DELETE RESTRICT,
        UNIQUE(tenant_id, log_id, witness_sequence),
        UNIQUE(tenant_id, receipt_hash)
      ) STRICT;
      CREATE INDEX observer_recipe_witness_receipts_current_idx
        ON observer_recipe_witness_receipts(tenant_id, log_id, witness_sequence DESC);
      CREATE INDEX observer_recipe_witness_receipts_checkpoint_idx
        ON observer_recipe_witness_receipts(
          tenant_id, log_id, transparency_event_hash, valid_until DESC
        );

      CREATE TABLE observer_recipe_witness_checks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        log_id TEXT NOT NULL,
        checkpoint_hash TEXT NOT NULL DEFAULT '',
        transparency_event_hash TEXT NOT NULL DEFAULT '',
        outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'unavailable', 'invalid', 'conflict', 'stale')),
        reason_code TEXT NOT NULL,
        receipt_hash TEXT NOT NULL DEFAULT '',
        checked_by_actor_id TEXT NOT NULL,
        checked_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX observer_recipe_witness_checks_recent_idx
        ON observer_recipe_witness_checks(tenant_id, log_id, checked_at DESC, id DESC);

      CREATE TRIGGER observer_recipe_witness_receipts_no_update
      BEFORE UPDATE ON observer_recipe_witness_receipts
      BEGIN SELECT RAISE(ABORT, 'observer recipe witness receipts are append-only'); END;
      CREATE TRIGGER observer_recipe_witness_receipts_no_delete
      BEFORE DELETE ON observer_recipe_witness_receipts
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'observer recipe witness receipts are append-only'); END;
      CREATE TRIGGER observer_recipe_witness_checks_no_update
      BEFORE UPDATE ON observer_recipe_witness_checks
      BEGIN SELECT RAISE(ABORT, 'observer recipe witness checks are append-only'); END;
      CREATE TRIGGER observer_recipe_witness_checks_no_delete
      BEFORE DELETE ON observer_recipe_witness_checks
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'observer recipe witness checks are append-only'); END;
    `
  },
  {
    version: 30,
    name: "mission_owned_purchase_decisions",
    sql: `
      ALTER TABLE mission_intent_revisions
        ADD COLUMN decision_mode TEXT NOT NULL DEFAULT 'strategy'
          CHECK (decision_mode IN ('strategy', 'purchase_intent'));
      ALTER TABLE mission_intent_revisions
        ADD COLUMN max_signal_age_seconds INTEGER NOT NULL DEFAULT 120
          CHECK (max_signal_age_seconds BETWEEN 10 AND 3600);

      ALTER TABLE mission_decisions
        ADD COLUMN decision_source TEXT NOT NULL DEFAULT 'strategy'
          CHECK (decision_source IN ('strategy', 'purchase_intent'));
      ALTER TABLE action_jobs
        ADD COLUMN decision_source TEXT NOT NULL DEFAULT 'strategy'
          CHECK (decision_source IN ('strategy', 'purchase_intent'));

      INSERT INTO mission_intent_revisions(
        id, tenant_id, user_id, mission_id, revision, quantity, currency,
        max_all_in_cents, action_ceiling, decision_mode,
        max_signal_age_seconds, substitution_policy, expires_at,
        cooldown_seconds, target_policy_json, policy_hash, change_reason,
        created_by_actor_id, created_at
      )
      SELECT 'intent_revision_m30_' || lower(hex(randomblob(16))),
             ir.tenant_id, ir.user_id, ir.mission_id, ir.revision + 1,
             ir.quantity, ir.currency, ir.max_all_in_cents, ir.action_ceiling,
             'purchase_intent', 120, ir.substitution_policy, ir.expires_at,
             ir.cooldown_seconds, ir.target_policy_json,
             'migration30:user-intent:' || ir.policy_hash,
             'Upgraded the reviewed user plan to direct purchase-intent decisions.',
             'migration_30', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM mission_intent_revisions ir
      JOIN missions m ON m.id = ir.mission_id
      WHERE m.origin IN ('user_guided', 'user_selected_legacy')
        AND ir.revision = (
          SELECT MAX(current_ir.revision)
          FROM mission_intent_revisions current_ir
          WHERE current_ir.mission_id = ir.mission_id
        )
        AND (
          ir.action_ceiling = 'notify'
          OR (
            ir.action_ceiling = 'add_to_cart'
            AND ir.max_all_in_cents IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM mission_targets enabled_mt
              WHERE enabled_mt.mission_id = m.id AND enabled_mt.enabled = 1
            )
            AND NOT EXISTS (
              SELECT 1
              FROM mission_targets unsafe_mt
              JOIN listings unsafe_l ON unsafe_l.id = unsafe_mt.listing_id
              WHERE unsafe_mt.mission_id = m.id AND unsafe_mt.enabled = 1
                AND (
                  unsafe_l.execution_supported <> 1
                  OR unsafe_mt.max_unit_price_cents IS NULL
                  OR unsafe_mt.seller_policy <> 'first_party_only'
                  OR unsafe_mt.fulfillment <> 'shipping'
                )
            )
            AND ir.max_all_in_cents >= COALESCE((
              SELECT MAX(
                CAST((safe_mt.max_unit_price_cents * m.target_quantity * (10000 + settings.tax_bps) + 9999) / 10000 AS INTEGER)
                + CASE
                    WHEN COALESCE(json_extract(settings.store_allowances_json, '$.' || safe_l.retailer_id), 0) > 0
                    THEN json_extract(settings.store_allowances_json, '$.' || safe_l.retailer_id)
                    ELSE 0
                  END
              )
              FROM mission_targets safe_mt
              JOIN listings safe_l ON safe_l.id = safe_mt.listing_id
              JOIN app_settings settings ON settings.user_id = ir.user_id
              WHERE safe_mt.mission_id = m.id AND safe_mt.enabled = 1
            ), 100000001)
          )
        );
    `
  },
  {
    version: 31,
    name: "privacy_bounded_operational_telemetry",
    sql: `
      CREATE TABLE operational_request_rollups (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        bucket_start TEXT NOT NULL,
        route_key TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD')),
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('maintainer', 'user', 'device', 'service')),
        status_class TEXT NOT NULL CHECK (status_class IN ('success', 'redirect', 'client_error', 'server_error')),
        latency_bucket TEXT NOT NULL CHECK (latency_bucket IN ('lt_100', 'lt_500', 'lt_2000', 'gte_2000')),
        request_count INTEGER NOT NULL CHECK (request_count >= 1),
        total_duration_ms INTEGER NOT NULL CHECK (total_duration_ms >= 0),
        max_duration_ms INTEGER NOT NULL CHECK (max_duration_ms >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (
          tenant_id, bucket_start, route_key, method, actor_kind,
          status_class, latency_bucket
        )
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX operational_request_rollups_recent_idx
        ON operational_request_rollups(tenant_id, bucket_start DESC, route_key);

      CREATE TABLE operational_error_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        correlation_key TEXT NOT NULL,
        route_key TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD')),
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('maintainer', 'user', 'device', 'service')),
        status_code INTEGER NOT NULL CHECK (status_code BETWEEN 400 AND 599),
        error_code TEXT NOT NULL,
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX operational_error_events_recent_idx
        ON operational_error_events(tenant_id, occurred_at DESC, id DESC);
      CREATE INDEX operational_error_events_route_idx
        ON operational_error_events(tenant_id, route_key, occurred_at DESC);

      CREATE TABLE operational_telemetry_retention_receipts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cutoff_at TEXT NOT NULL,
        deleted_rollup_rows INTEGER NOT NULL CHECK (deleted_rollup_rows >= 0),
        deleted_error_events INTEGER NOT NULL CHECK (deleted_error_events >= 0),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX operational_telemetry_retention_recent_idx
        ON operational_telemetry_retention_receipts(tenant_id, created_at DESC, id DESC);

      CREATE TRIGGER operational_telemetry_retention_receipts_no_update
      BEFORE UPDATE ON operational_telemetry_retention_receipts
      BEGIN SELECT RAISE(ABORT, 'operational telemetry retention receipts are append-only'); END;
      CREATE TRIGGER operational_telemetry_retention_receipts_no_delete
      BEFORE DELETE ON operational_telemetry_retention_receipts
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'operational telemetry retention receipts are append-only'); END;
    `
  },
  {
    version: 32,
    name: "high_risk_change_control",
    sql: `
      INSERT INTO authorization_permissions(id, description, created_at)
      VALUES (
        'change.approve',
        'Independently approve or reject a safety-expanding administrative change.',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
      INSERT INTO authorization_role_permissions(role_id, permission_id, created_at)
      VALUES ('security_admin', 'change.approve', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      CREATE TABLE admin_change_requests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL CHECK (operation_type IN (
          'authorization_role_grant', 'authorization_role_revoke',
          'observer_recipe_trust_install',
          'observer_recipe_promote', 'observer_recipe_resign',
          'observer_recipe_disable', 'observer_recipe_rollback',
          'retailer_lane_activate', 'affiliate_policy_replace',
          'global_actions_resume'
        )),
        target_key TEXT NOT NULL CHECK (length(target_key) BETWEEN 1 AND 160),
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        summary_json TEXT NOT NULL CHECK (json_valid(summary_json) AND length(summary_json) <= 2000),
        control_level TEXT NOT NULL CHECK (control_level IN ('step_up', 'two_person')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed', 'rejected', 'expired')),
        requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_by_actor_kind TEXT NOT NULL CHECK (requested_by_actor_kind IN ('maintainer', 'user')),
        requested_by_actor_id TEXT NOT NULL,
        requested_assurance TEXT NOT NULL CHECK (requested_assurance IN ('step_up', 'local_trusted')),
        correlation_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        approved_at TEXT NOT NULL DEFAULT '',
        consumed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX admin_change_requests_active_payload_idx
        ON admin_change_requests(tenant_id, operation_type, target_key, payload_hash)
        WHERE status IN ('pending', 'approved');
      CREATE INDEX admin_change_requests_queue_idx
        ON admin_change_requests(tenant_id, status, created_at DESC, id DESC);

      CREATE TABLE admin_change_decisions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL REFERENCES admin_change_requests(id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
        reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reviewer_actor_kind TEXT NOT NULL CHECK (reviewer_actor_kind IN ('maintainer', 'user')),
        reviewer_actor_id TEXT NOT NULL,
        reviewer_assurance TEXT NOT NULL CHECK (reviewer_assurance IN ('step_up', 'local_trusted')),
        correlation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(request_id, reviewer_user_id)
      ) STRICT;
      CREATE INDEX admin_change_decisions_request_idx
        ON admin_change_decisions(tenant_id, request_id, created_at, id);

      CREATE TABLE admin_change_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL REFERENCES admin_change_requests(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN (
          'requested', 'approved', 'rejected', 'consumed',
          'expired', 'local_trusted_consumed'
        )),
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('maintainer', 'user')),
        actor_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        privacy_classification TEXT NOT NULL DEFAULT 'restricted_admin'
          CHECK (privacy_classification = 'restricted_admin'),
        created_at TEXT NOT NULL,
        UNIQUE(request_id, sequence)
      ) STRICT;
      CREATE INDEX admin_change_events_request_idx
        ON admin_change_events(tenant_id, request_id, sequence);

      CREATE TRIGGER admin_change_decisions_no_update
      BEFORE UPDATE ON admin_change_decisions
      BEGIN SELECT RAISE(ABORT, 'admin change decisions are append-only'); END;
      CREATE TRIGGER admin_change_decisions_no_delete
      BEFORE DELETE ON admin_change_decisions
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'admin change decisions are append-only'); END;
      CREATE TRIGGER admin_change_events_no_update
      BEFORE UPDATE ON admin_change_events
      BEGIN SELECT RAISE(ABORT, 'admin change events are append-only'); END;
      CREATE TRIGGER admin_change_events_no_delete
      BEFORE DELETE ON admin_change_events
      WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'admin change events are append-only'); END;
    `
  },
  {
    version: 33,
    name: "self_service_user_data_export",
    sql: `
      INSERT INTO authorization_permissions(id, description, created_at)
      VALUES (
        'user.privacy.export',
        'Review and export the authenticated user''s privacy-scoped data archive.',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
      INSERT INTO authorization_role_permissions(role_id, permission_id, created_at)
      VALUES ('yoink_user', 'user.privacy.export', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `
  },
  {
    version: 34,
    name: "durable_background_worker_foundation",
    sql: `
      INSERT INTO authorization_permissions(id, description, created_at)
      VALUES (
        'worker.manage',
        'Pause, resume, run, and retry bounded background maintenance work.',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
      INSERT INTO authorization_role_permissions(role_id, permission_id, created_at) VALUES
        ('security_admin', 'worker.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ('tenant_admin', 'worker.manage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      CREATE TABLE background_task_schedules (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_kind TEXT NOT NULL CHECK (task_kind IN (
          'execution_recovery', 'notification_recovery',
          'hosted_delivery_recovery', 'adapter_alert_reconciliation',
          'operational_telemetry_retention'
        )),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
        description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 15 AND 604800),
        next_run_at TEXT NOT NULL,
        last_enqueued_at TEXT NOT NULL DEFAULT '',
        created_by_actor_id TEXT NOT NULL,
        updated_by_actor_id TEXT NOT NULL,
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, subject_user_id, task_kind)
      ) STRICT;
      CREATE INDEX background_task_schedules_due_idx
        ON background_task_schedules(tenant_id, subject_user_id, enabled, next_run_at, id);

      CREATE TABLE background_tasks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        schedule_id TEXT REFERENCES background_task_schedules(id) ON DELETE SET NULL,
        task_kind TEXT NOT NULL CHECK (task_kind IN (
          'execution_recovery', 'notification_recovery',
          'hosted_delivery_recovery', 'adapter_alert_reconciliation',
          'operational_telemetry_retention'
        )),
        dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
        state TEXT NOT NULL CHECK (state IN (
          'pending', 'leased', 'retry_wait', 'succeeded', 'dead_letter', 'cancelled'
        )),
        priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
        maximum_attempts INTEGER NOT NULL CHECK (maximum_attempts BETWEEN 1 AND 20),
        scheduled_for TEXT NOT NULL,
        lease_owner_id TEXT NOT NULL DEFAULT '',
        lease_capability_hash TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '' CHECK (length(last_error_code) <= 80),
        result_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(result_json) AND length(result_json) <= 4000),
        completed_at TEXT NOT NULL DEFAULT '',
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX background_tasks_active_dedupe_idx
        ON background_tasks(tenant_id, subject_user_id, task_kind, dedupe_key)
        WHERE state IN ('pending', 'leased', 'retry_wait');
      CREATE INDEX background_tasks_queue_idx
        ON background_tasks(tenant_id, subject_user_id, state, scheduled_for, priority DESC, created_at, id);
      CREATE INDEX background_tasks_history_idx
        ON background_tasks(tenant_id, subject_user_id, created_at DESC, id DESC);

      CREATE TABLE background_task_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES background_tasks(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN (
          'scheduled', 'leased', 'succeeded', 'retry_scheduled',
          'dead_lettered', 'manually_retried', 'cancelled'
        )),
        attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 20),
        reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 80),
        worker_id TEXT NOT NULL DEFAULT '' CHECK (length(worker_id) <= 120),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL,
        UNIQUE(task_id, sequence)
      ) STRICT;
      CREATE INDEX background_task_events_recent_idx
        ON background_task_events(tenant_id, subject_user_id, created_at DESC, id DESC);

      CREATE TABLE background_worker_heartbeats (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        worker_id TEXT NOT NULL CHECK (length(worker_id) BETWEEN 3 AND 120),
        runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('local_in_process', 'standalone')),
        runtime_version TEXT NOT NULL CHECK (length(runtime_version) BETWEEN 1 AND 40),
        state TEXT NOT NULL CHECK (state IN ('running', 'stopped')),
        started_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        stopped_at TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '' CHECK (length(last_error_code) <= 80),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        PRIMARY KEY (tenant_id, subject_user_id, worker_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX background_worker_heartbeats_recent_idx
        ON background_worker_heartbeats(tenant_id, subject_user_id, heartbeat_at DESC, worker_id);

      CREATE TRIGGER background_task_events_no_update
      BEFORE UPDATE ON background_task_events
      BEGIN SELECT RAISE(ABORT, 'background task events are append-only'); END;
      CREATE TRIGGER background_task_events_no_delete
      BEFORE DELETE ON background_task_events
      WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.subject_user_id)
        AND EXISTS (SELECT 1 FROM background_tasks WHERE id = OLD.task_id)
      BEGIN SELECT RAISE(ABORT, 'background task events are append-only'); END;
      CREATE TRIGGER background_tasks_bounded_delete
      BEFORE DELETE ON background_tasks
      WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.subject_user_id)
        AND NOT (
          OLD.state IN ('succeeded', 'cancelled')
          AND OLD.completed_at <> ''
          AND OLD.completed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
        )
      BEGIN SELECT RAISE(ABORT, 'background tasks are retained until bounded cleanup'); END;
    `
  },
  {
    version: 35,
    name: "durable_signal_ingress",
    sql: `
      UPDATE background_task_schedules
      SET display_name = 'Signal inbox and delivery recovery',
          description = 'Process packaged signal messages, then retire expired inbox and outbox capabilities safely.',
          interval_seconds = 15,
          updated_by_actor_id = 'migration_35',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE task_kind = 'hosted_delivery_recovery'
        AND display_name = 'Inbox and outbox recovery'
        AND description = 'Retire expired hosted delivery capabilities and requeue or dead-letter abandoned work.'
        AND interval_seconds = 60;
    `
  },
  {
    version: 36,
    name: "recoverable_device_credential_rotation",
    sql: `
      ALTER TABLE extension_devices ADD COLUMN credential_generation INTEGER NOT NULL DEFAULT 1
        CHECK (credential_generation >= 1);
      ALTER TABLE extension_devices ADD COLUMN credential_issued_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE extension_devices ADD COLUMN pending_token_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE extension_devices ADD COLUMN pending_token_generation INTEGER NOT NULL DEFAULT 0
        CHECK (pending_token_generation >= 0);
      ALTER TABLE extension_devices ADD COLUMN pending_token_expires_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE extension_devices ADD COLUMN previous_token_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE extension_devices ADD COLUMN previous_token_expires_at TEXT NOT NULL DEFAULT '';

      UPDATE extension_devices SET credential_issued_at = created_at
      WHERE credential_issued_at = '';

      CREATE UNIQUE INDEX extension_devices_pending_token_hash_idx
        ON extension_devices(pending_token_hash) WHERE pending_token_hash <> '';
      CREATE UNIQUE INDEX extension_devices_previous_token_hash_idx
        ON extension_devices(previous_token_hash) WHERE previous_token_hash <> '';

      CREATE TRIGGER extension_devices_credential_insert_backfill
      AFTER INSERT ON extension_devices
      WHEN NEW.credential_issued_at = ''
      BEGIN
        UPDATE extension_devices SET credential_issued_at = NEW.created_at WHERE id = NEW.id;
      END;

      CREATE TRIGGER extension_devices_credential_insert_guard
      BEFORE INSERT ON extension_devices
      WHEN NOT (
          (NEW.pending_token_hash = '' AND NEW.pending_token_generation = 0 AND NEW.pending_token_expires_at = '')
          OR (NEW.pending_token_hash <> '' AND NEW.pending_token_generation = NEW.credential_generation + 1
            AND NEW.pending_token_expires_at <> '')
        )
        OR NOT (
          (NEW.previous_token_hash = '' AND NEW.previous_token_expires_at = '')
          OR (NEW.previous_token_hash <> '' AND NEW.previous_token_expires_at <> '')
        )
      BEGIN SELECT RAISE(ABORT, 'extension device credential state is invalid'); END;

      CREATE TRIGGER extension_devices_credential_update_guard
      BEFORE UPDATE ON extension_devices
      WHEN NEW.credential_issued_at = ''
        OR NOT (
          (NEW.pending_token_hash = '' AND NEW.pending_token_generation = 0 AND NEW.pending_token_expires_at = '')
          OR (NEW.pending_token_hash <> '' AND NEW.pending_token_generation = NEW.credential_generation + 1
            AND NEW.pending_token_expires_at <> '')
        )
        OR NOT (
          (NEW.previous_token_hash = '' AND NEW.previous_token_expires_at = '')
          OR (NEW.previous_token_hash <> '' AND NEW.previous_token_expires_at <> '')
        )
      BEGIN SELECT RAISE(ABORT, 'extension device credential state is invalid'); END;
    `
  },
  {
    version: 37,
    name: "durable_observer_witness_refresh",
    sql: `
      PRAGMA defer_foreign_keys = ON;

      CREATE TABLE background_task_schedules_v37 (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_kind TEXT NOT NULL CHECK (task_kind IN (
          'execution_recovery', 'notification_recovery',
          'hosted_delivery_recovery', 'adapter_alert_reconciliation',
          'observer_recipe_witness_refresh', 'operational_telemetry_retention'
        )),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
        description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 15 AND 604800),
        next_run_at TEXT NOT NULL,
        last_enqueued_at TEXT NOT NULL DEFAULT '',
        created_by_actor_id TEXT NOT NULL,
        updated_by_actor_id TEXT NOT NULL,
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, subject_user_id, task_kind)
      ) STRICT;

      CREATE TABLE background_tasks_v37 (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        schedule_id TEXT REFERENCES background_task_schedules_v37(id) ON DELETE SET NULL,
        task_kind TEXT NOT NULL CHECK (task_kind IN (
          'execution_recovery', 'notification_recovery',
          'hosted_delivery_recovery', 'adapter_alert_reconciliation',
          'observer_recipe_witness_refresh', 'operational_telemetry_retention'
        )),
        dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
        state TEXT NOT NULL CHECK (state IN (
          'pending', 'leased', 'retry_wait', 'succeeded', 'dead_letter', 'cancelled'
        )),
        priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
        maximum_attempts INTEGER NOT NULL CHECK (maximum_attempts BETWEEN 1 AND 20),
        scheduled_for TEXT NOT NULL,
        lease_owner_id TEXT NOT NULL DEFAULT '',
        lease_capability_hash TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '' CHECK (length(last_error_code) <= 80),
        result_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(result_json) AND length(result_json) <= 4000),
        completed_at TEXT NOT NULL DEFAULT '',
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE background_task_events_v37 (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES background_tasks_v37(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN (
          'scheduled', 'leased', 'succeeded', 'retry_scheduled',
          'dead_lettered', 'manually_retried', 'cancelled'
        )),
        attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 20),
        reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 80),
        worker_id TEXT NOT NULL DEFAULT '' CHECK (length(worker_id) <= 120),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL,
        UNIQUE(task_id, sequence)
      ) STRICT;

      INSERT INTO background_task_schedules_v37 SELECT * FROM background_task_schedules;
      INSERT INTO background_tasks_v37 SELECT * FROM background_tasks;
      INSERT INTO background_task_events_v37 SELECT * FROM background_task_events;

      DROP TABLE background_task_events;
      DROP TABLE background_tasks;
      DROP TABLE background_task_schedules;

      ALTER TABLE background_task_schedules_v37 RENAME TO background_task_schedules;
      ALTER TABLE background_tasks_v37 RENAME TO background_tasks;
      ALTER TABLE background_task_events_v37 RENAME TO background_task_events;

      CREATE INDEX background_task_schedules_due_idx
        ON background_task_schedules(tenant_id, subject_user_id, enabled, next_run_at, id);
      CREATE UNIQUE INDEX background_tasks_active_dedupe_idx
        ON background_tasks(tenant_id, subject_user_id, task_kind, dedupe_key)
        WHERE state IN ('pending', 'leased', 'retry_wait');
      CREATE INDEX background_tasks_queue_idx
        ON background_tasks(tenant_id, subject_user_id, state, scheduled_for, priority DESC, created_at, id);
      CREATE INDEX background_tasks_history_idx
        ON background_tasks(tenant_id, subject_user_id, created_at DESC, id DESC);
      CREATE INDEX background_task_events_recent_idx
        ON background_task_events(tenant_id, subject_user_id, created_at DESC, id DESC);

      CREATE TRIGGER background_task_events_no_update
      BEFORE UPDATE ON background_task_events
      BEGIN SELECT RAISE(ABORT, 'background task events are append-only'); END;
      CREATE TRIGGER background_task_events_no_delete
      BEFORE DELETE ON background_task_events
      WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.subject_user_id)
        AND EXISTS (SELECT 1 FROM background_tasks WHERE id = OLD.task_id)
      BEGIN SELECT RAISE(ABORT, 'background task events are append-only'); END;
      CREATE TRIGGER background_tasks_bounded_delete
      BEFORE DELETE ON background_tasks
      WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.subject_user_id)
        AND NOT (
          OLD.state IN ('succeeded', 'cancelled')
          AND OLD.completed_at <> ''
          AND OLD.completed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
        )
      BEGIN SELECT RAISE(ABORT, 'background tasks are retained until bounded cleanup'); END;
    `
  },
  {
    version: 38,
    name: "attested_background_worker_deployment",
    sql: `
      ALTER TABLE background_worker_heartbeats
        ADD COLUMN deployment_fingerprint TEXT NOT NULL DEFAULT ''
          CHECK (
            deployment_fingerprint = '' OR (
              length(deployment_fingerprint) = 64
              AND deployment_fingerprint NOT GLOB '*[^a-f0-9]*'
            )
          );

      CREATE TABLE background_worker_deployment_expectations (
        id TEXT PRIMARY KEY CHECK (id = 'active'),
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        desired_mode TEXT NOT NULL CHECK (desired_mode IN ('embedded', 'external', 'disabled')),
        runtime_version TEXT NOT NULL CHECK (length(runtime_version) BETWEEN 1 AND 40),
        deployment_fingerprint TEXT NOT NULL CHECK (
          length(deployment_fingerprint) = 64
          AND deployment_fingerprint NOT GLOB '*[^a-f0-9]*'
        ),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        updated_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE background_worker_deployment_events (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        from_mode TEXT NOT NULL CHECK (from_mode IN ('', 'embedded', 'external', 'disabled')),
        to_mode TEXT NOT NULL CHECK (to_mode IN ('embedded', 'external', 'disabled')),
        from_deployment_fingerprint TEXT NOT NULL CHECK (
          from_deployment_fingerprint = '' OR (
            length(from_deployment_fingerprint) = 64
            AND from_deployment_fingerprint NOT GLOB '*[^a-f0-9]*'
          )
        ),
        to_deployment_fingerprint TEXT NOT NULL CHECK (
          length(to_deployment_fingerprint) = 64
          AND to_deployment_fingerprint NOT GLOB '*[^a-f0-9]*'
        ),
        runtime_version TEXT NOT NULL CHECK (length(runtime_version) BETWEEN 1 AND 40),
        previous_event_hash TEXT NOT NULL CHECK (
          previous_event_hash = '' OR (
            length(previous_event_hash) = 64
            AND previous_event_hash NOT GLOB '*[^a-f0-9]*'
          )
        ),
        event_hash TEXT NOT NULL UNIQUE CHECK (
          length(event_hash) = 64 AND event_hash NOT GLOB '*[^a-f0-9]*'
        ),
        reason_code TEXT NOT NULL CHECK (reason_code = 'api_startup_contract'),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX background_worker_deployment_events_recent_idx
        ON background_worker_deployment_events(sequence DESC);

      CREATE TRIGGER background_worker_deployment_events_no_update
      BEFORE UPDATE ON background_worker_deployment_events
      BEGIN SELECT RAISE(ABORT, 'background worker deployment events are append-only'); END;
      CREATE TRIGGER background_worker_deployment_events_no_delete
      BEFORE DELETE ON background_worker_deployment_events
      BEGIN SELECT RAISE(ABORT, 'background worker deployment events are append-only'); END;
    `
  },
  {
    version: 39,
    name: "durable_operator_alert_connectors",
    sql: `
      CREATE TABLE operator_alert_connectors (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        kind TEXT NOT NULL CHECK (kind = 'webhook'),
        endpoint_reference TEXT NOT NULL CHECK (
          length(endpoint_reference) BETWEEN 3 AND 120
          AND endpoint_reference GLOB '[A-Za-z]*'
          AND endpoint_reference NOT GLOB '*[^A-Za-z0-9_.:-]*'
        ),
        endpoint_binding_fingerprint TEXT NOT NULL DEFAULT '' CHECK (
          endpoint_binding_fingerprint = '' OR (
            length(endpoint_binding_fingerprint) = 64
            AND endpoint_binding_fingerprint NOT GLOB '*[^a-f0-9]*'
          )
        ),
        minimum_severity TEXT NOT NULL CHECK (minimum_severity IN ('info', 'warning', 'error', 'critical')),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        created_by_actor_id TEXT NOT NULL,
        updated_by_actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, name)
      ) STRICT;
      CREATE INDEX operator_alert_connectors_enabled_idx
        ON operator_alert_connectors(tenant_id, enabled, minimum_severity, updated_at DESC);

      CREATE TABLE operator_alert_connector_deliveries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        connector_id TEXT NOT NULL REFERENCES operator_alert_connectors(id) ON DELETE RESTRICT,
        incident_id TEXT NOT NULL REFERENCES operator_alert_incidents(id) ON DELETE RESTRICT,
        event_id TEXT NOT NULL REFERENCES operator_alert_events(id) ON DELETE RESTRICT,
        endpoint_reference TEXT NOT NULL CHECK (length(endpoint_reference) BETWEEN 3 AND 120),
        endpoint_binding_fingerprint TEXT NOT NULL CHECK (
          endpoint_binding_fingerprint = '' OR (
            length(endpoint_binding_fingerprint) = 64
            AND endpoint_binding_fingerprint NOT GLOB '*[^a-f0-9]*'
          )
        ),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 4000),
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^a-f0-9]*'),
        idempotency_key_hash TEXT NOT NULL UNIQUE
          CHECK (length(idempotency_key_hash) = 64 AND idempotency_key_hash NOT GLOB '*[^a-f0-9]*'),
        state TEXT NOT NULL CHECK (state IN (
          'pending', 'leased', 'retry_wait', 'delivered', 'dead_letter', 'cancelled'
        )),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 12),
        lease_capability_hash TEXT NOT NULL DEFAULT '' CHECK (
          lease_capability_hash = '' OR (
            length(lease_capability_hash) = 64 AND lease_capability_hash NOT GLOB '*[^a-f0-9]*'
          )
        ),
        lease_expires_at TEXT NOT NULL DEFAULT '',
        next_attempt_at TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '' CHECK (length(last_error_code) <= 80),
        last_http_status INTEGER NOT NULL DEFAULT 0 CHECK (
          last_http_status = 0 OR last_http_status BETWEEN 100 AND 599
        ),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        delivered_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connector_id, event_id)
      ) STRICT;
      CREATE INDEX operator_alert_connector_deliveries_queue_idx
        ON operator_alert_connector_deliveries(tenant_id, state, next_attempt_at, created_at, id);
      CREATE INDEX operator_alert_connector_deliveries_connector_idx
        ON operator_alert_connector_deliveries(connector_id, created_at DESC, id DESC);
      CREATE TRIGGER operator_alert_connector_deliveries_insert_guard
      BEFORE INSERT ON operator_alert_connector_deliveries
      WHEN NOT (
        (NEW.state = 'pending' AND NEW.attempt_count = 0
          AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
          AND NEW.next_attempt_at = '' AND NEW.delivered_at = '')
      )
      BEGIN SELECT RAISE(ABORT, 'operator alert connector delivery state is invalid'); END;
      CREATE TRIGGER operator_alert_connector_deliveries_update_guard
      BEFORE UPDATE ON operator_alert_connector_deliveries
      WHEN NOT (
        (NEW.state = 'leased' AND NEW.attempt_count BETWEEN 1 AND 12
          AND NEW.lease_capability_hash <> '' AND NEW.lease_expires_at <> ''
          AND NEW.next_attempt_at = '' AND NEW.delivered_at = '')
        OR (NEW.state = 'retry_wait' AND NEW.attempt_count BETWEEN 1 AND 11
          AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
          AND NEW.next_attempt_at <> '' AND NEW.delivered_at = '')
        OR (NEW.state = 'delivered' AND NEW.attempt_count BETWEEN 1 AND 12
          AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
          AND NEW.next_attempt_at = '' AND NEW.delivered_at <> '')
        OR (NEW.state IN ('dead_letter', 'cancelled')
          AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
          AND NEW.next_attempt_at = '' AND NEW.delivered_at = '')
      )
      BEGIN SELECT RAISE(ABORT, 'operator alert connector delivery state is invalid'); END;

      CREATE TABLE operator_alert_connector_delivery_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        delivery_id TEXT NOT NULL REFERENCES operator_alert_connector_deliveries(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN (
          'queued', 'leased', 'delivered', 'retry_scheduled', 'dead_lettered', 'cancelled'
        )),
        attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 12),
        reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 80),
        http_status INTEGER NOT NULL DEFAULT 0 CHECK (http_status = 0 OR http_status BETWEEN 100 AND 599),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL,
        UNIQUE(delivery_id, sequence)
      ) STRICT;
      CREATE INDEX operator_alert_connector_delivery_events_recent_idx
        ON operator_alert_connector_delivery_events(tenant_id, created_at DESC, id DESC);
      CREATE TRIGGER operator_alert_connector_delivery_events_no_update
      BEFORE UPDATE ON operator_alert_connector_delivery_events
      BEGIN SELECT RAISE(ABORT, 'operator alert connector delivery events are append-only'); END;
      CREATE TRIGGER operator_alert_connector_delivery_events_no_delete
      BEFORE DELETE ON operator_alert_connector_delivery_events
      WHEN EXISTS (SELECT 1 FROM operator_alert_connector_deliveries WHERE id = OLD.delivery_id)
      BEGIN SELECT RAISE(ABORT, 'operator alert connector delivery events are append-only'); END;

      CREATE TABLE background_worker_deployment_expectations_v39 (
        id TEXT PRIMARY KEY CHECK (id = 'active'),
        contract_version INTEGER NOT NULL CHECK (contract_version = 2),
        desired_mode TEXT NOT NULL CHECK (desired_mode IN ('embedded', 'external', 'disabled')),
        runtime_version TEXT NOT NULL CHECK (length(runtime_version) BETWEEN 1 AND 40),
        deployment_fingerprint TEXT NOT NULL CHECK (
          length(deployment_fingerprint) = 64
          AND deployment_fingerprint NOT GLOB '*[^a-f0-9]*'
        ),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        updated_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE background_worker_deployment_events_v39 (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
        contract_version INTEGER NOT NULL CHECK (contract_version IN (1, 2)),
        from_mode TEXT NOT NULL CHECK (from_mode IN ('', 'embedded', 'external', 'disabled')),
        to_mode TEXT NOT NULL CHECK (to_mode IN ('embedded', 'external', 'disabled')),
        from_deployment_fingerprint TEXT NOT NULL CHECK (
          from_deployment_fingerprint = '' OR (
            length(from_deployment_fingerprint) = 64
            AND from_deployment_fingerprint NOT GLOB '*[^a-f0-9]*'
          )
        ),
        to_deployment_fingerprint TEXT NOT NULL CHECK (
          length(to_deployment_fingerprint) = 64
          AND to_deployment_fingerprint NOT GLOB '*[^a-f0-9]*'
        ),
        runtime_version TEXT NOT NULL CHECK (length(runtime_version) BETWEEN 1 AND 40),
        previous_event_hash TEXT NOT NULL CHECK (
          previous_event_hash = '' OR (
            length(previous_event_hash) = 64
            AND previous_event_hash NOT GLOB '*[^a-f0-9]*'
          )
        ),
        event_hash TEXT NOT NULL UNIQUE CHECK (
          length(event_hash) = 64 AND event_hash NOT GLOB '*[^a-f0-9]*'
        ),
        reason_code TEXT NOT NULL CHECK (reason_code = 'api_startup_contract'),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO background_worker_deployment_events_v39
        SELECT * FROM background_worker_deployment_events;

      DROP TABLE background_worker_deployment_expectations;
      DROP TABLE background_worker_deployment_events;
      ALTER TABLE background_worker_deployment_expectations_v39 RENAME TO background_worker_deployment_expectations;
      ALTER TABLE background_worker_deployment_events_v39 RENAME TO background_worker_deployment_events;
      CREATE INDEX background_worker_deployment_events_recent_idx
        ON background_worker_deployment_events(sequence DESC);
      CREATE TRIGGER background_worker_deployment_events_no_update
      BEFORE UPDATE ON background_worker_deployment_events
      BEGIN SELECT RAISE(ABORT, 'background worker deployment events are append-only'); END;
      CREATE TRIGGER background_worker_deployment_events_no_delete
      BEFORE DELETE ON background_worker_deployment_events
      BEGIN SELECT RAISE(ABORT, 'background worker deployment events are append-only'); END;
    `
  },
  {
    version: 40,
    name: "governed_operator_alert_connector_recovery",
    sql: `
      DROP TRIGGER operator_alert_connector_deliveries_update_guard;
      CREATE TRIGGER operator_alert_connector_deliveries_update_guard
      BEFORE UPDATE ON operator_alert_connector_deliveries
      WHEN NOT (
        NEW.id = OLD.id
        AND NEW.tenant_id = OLD.tenant_id
        AND NEW.connector_id = OLD.connector_id
        AND NEW.incident_id = OLD.incident_id
        AND NEW.event_id = OLD.event_id
        AND NEW.endpoint_reference = OLD.endpoint_reference
        AND NEW.endpoint_binding_fingerprint = OLD.endpoint_binding_fingerprint
        AND NEW.payload_json = OLD.payload_json
        AND NEW.payload_hash = OLD.payload_hash
        AND NEW.idempotency_key_hash = OLD.idempotency_key_hash
        AND NEW.privacy_classification = OLD.privacy_classification
        AND NEW.created_at = OLD.created_at
        AND NEW.updated_at >= OLD.updated_at
        AND (
          (NEW.state = 'leased'
            AND OLD.state IN ('pending', 'retry_wait', 'leased')
            AND NEW.attempt_count = OLD.attempt_count + 1
            AND NEW.lease_capability_hash <> '' AND NEW.lease_expires_at <> ''
            AND NEW.next_attempt_at = '' AND NEW.last_error_code = ''
            AND NEW.last_http_status = 0 AND NEW.delivered_at = '')
          OR (NEW.state = 'retry_wait'
            AND OLD.state = 'leased' AND NEW.attempt_count = OLD.attempt_count
            AND NEW.attempt_count BETWEEN 1 AND 11
            AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
            AND NEW.next_attempt_at <> '' AND NEW.last_error_code <> ''
            AND NEW.delivered_at = '')
          OR (NEW.state = 'delivered'
            AND OLD.state = 'leased' AND NEW.attempt_count = OLD.attempt_count
            AND NEW.attempt_count BETWEEN 1 AND 12
            AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
            AND NEW.next_attempt_at = '' AND NEW.last_error_code = ''
            AND NEW.last_http_status BETWEEN 200 AND 299
            AND NEW.delivered_at <> '')
          OR (NEW.state = 'dead_letter'
            AND OLD.state = 'leased' AND NEW.attempt_count = OLD.attempt_count
            AND NEW.attempt_count BETWEEN 1 AND 12
            AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
            AND NEW.next_attempt_at = '' AND NEW.last_error_code <> ''
            AND NEW.delivered_at = '')
          OR (NEW.state = 'cancelled'
            AND OLD.state IN ('pending', 'leased', 'retry_wait')
            AND NEW.attempt_count = OLD.attempt_count
            AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
            AND NEW.next_attempt_at = '' AND NEW.last_error_code <> ''
            AND NEW.delivered_at = '')
          OR (NEW.state = 'pending'
            AND OLD.state = 'dead_letter' AND NEW.attempt_count = 0
            AND NEW.lease_capability_hash = '' AND NEW.lease_expires_at = ''
            AND NEW.next_attempt_at = '' AND NEW.last_error_code = ''
            AND NEW.last_http_status = 0 AND NEW.delivered_at = '')
        )
      )
      BEGIN SELECT RAISE(ABORT, 'operator alert connector delivery transition is invalid'); END;
    `
  },
  {
    version: 41,
    name: "durable_observer_repair_candidate_evaluation",
    sql: `
      PRAGMA defer_foreign_keys = ON;

      CREATE TABLE background_task_schedules_v41 (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_kind TEXT NOT NULL CHECK (task_kind IN (
          'execution_recovery', 'notification_recovery',
          'hosted_delivery_recovery', 'adapter_alert_reconciliation',
          'observer_recipe_candidate_evaluation',
          'observer_recipe_witness_refresh', 'operational_telemetry_retention'
        )),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
        description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 15 AND 604800),
        next_run_at TEXT NOT NULL,
        last_enqueued_at TEXT NOT NULL DEFAULT '',
        created_by_actor_id TEXT NOT NULL,
        updated_by_actor_id TEXT NOT NULL,
        privacy_classification TEXT NOT NULL DEFAULT 'operational_configuration'
          CHECK (privacy_classification = 'operational_configuration'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, subject_user_id, task_kind)
      ) STRICT;

      CREATE TABLE background_tasks_v41 (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        schedule_id TEXT REFERENCES background_task_schedules_v41(id) ON DELETE SET NULL,
        task_kind TEXT NOT NULL CHECK (task_kind IN (
          'execution_recovery', 'notification_recovery',
          'hosted_delivery_recovery', 'adapter_alert_reconciliation',
          'observer_recipe_candidate_evaluation',
          'observer_recipe_witness_refresh', 'operational_telemetry_retention'
        )),
        dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
        state TEXT NOT NULL CHECK (state IN (
          'pending', 'leased', 'retry_wait', 'succeeded', 'dead_letter', 'cancelled'
        )),
        priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
        maximum_attempts INTEGER NOT NULL CHECK (maximum_attempts BETWEEN 1 AND 20),
        scheduled_for TEXT NOT NULL,
        lease_owner_id TEXT NOT NULL DEFAULT '',
        lease_capability_hash TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '' CHECK (length(last_error_code) <= 80),
        result_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(result_json) AND length(result_json) <= 4000),
        completed_at TEXT NOT NULL DEFAULT '',
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE background_task_events_v41 (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES background_tasks_v41(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN (
          'scheduled', 'leased', 'succeeded', 'retry_scheduled',
          'dead_lettered', 'manually_retried', 'cancelled'
        )),
        attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 20),
        reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 80),
        worker_id TEXT NOT NULL DEFAULT '' CHECK (length(worker_id) <= 120),
        privacy_classification TEXT NOT NULL DEFAULT 'operational_aggregate'
          CHECK (privacy_classification = 'operational_aggregate'),
        created_at TEXT NOT NULL,
        UNIQUE(task_id, sequence)
      ) STRICT;

      INSERT INTO background_task_schedules_v41 SELECT * FROM background_task_schedules;
      INSERT INTO background_tasks_v41 SELECT * FROM background_tasks;
      INSERT INTO background_task_events_v41 SELECT * FROM background_task_events;

      DROP TABLE background_task_events;
      DROP TABLE background_tasks;
      DROP TABLE background_task_schedules;

      ALTER TABLE background_task_schedules_v41 RENAME TO background_task_schedules;
      ALTER TABLE background_tasks_v41 RENAME TO background_tasks;
      ALTER TABLE background_task_events_v41 RENAME TO background_task_events;

      CREATE INDEX background_task_schedules_due_idx
        ON background_task_schedules(tenant_id, subject_user_id, enabled, next_run_at, id);
      CREATE UNIQUE INDEX background_tasks_active_dedupe_idx
        ON background_tasks(tenant_id, subject_user_id, task_kind, dedupe_key)
        WHERE state IN ('pending', 'leased', 'retry_wait');
      CREATE INDEX background_tasks_queue_idx
        ON background_tasks(tenant_id, subject_user_id, state, scheduled_for, priority DESC, created_at, id);
      CREATE INDEX background_tasks_history_idx
        ON background_tasks(tenant_id, subject_user_id, created_at DESC, id DESC);
      CREATE INDEX background_task_events_recent_idx
        ON background_task_events(tenant_id, subject_user_id, created_at DESC, id DESC);

      CREATE TRIGGER background_task_events_no_update
      BEFORE UPDATE ON background_task_events
      BEGIN SELECT RAISE(ABORT, 'background task events are append-only'); END;
      CREATE TRIGGER background_task_events_no_delete
      BEFORE DELETE ON background_task_events
      WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.subject_user_id)
        AND EXISTS (SELECT 1 FROM background_tasks WHERE id = OLD.task_id)
      BEGIN SELECT RAISE(ABORT, 'background task events are append-only'); END;
      CREATE TRIGGER background_tasks_bounded_delete
      BEFORE DELETE ON background_tasks
      WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.subject_user_id)
        AND NOT (
          OLD.state IN ('succeeded', 'cancelled')
          AND OLD.completed_at <> ''
          AND OLD.completed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
        )
      BEGIN SELECT RAISE(ABORT, 'background tasks are retained until bounded cleanup'); END;

      CREATE UNIQUE INDEX observer_recipe_generated_fingerprint_unique
        ON observer_recipe_candidates(tenant_id, recipe_fingerprint)
        WHERE provenance_code = 'privacy_bounded_repair_miner';
    `
  },
  {
    version: 42,
    name: "packaged_observer_recipe_oracle",
    sql: `
      ALTER TABLE observer_recipe_trials
        ADD COLUMN validation_profile TEXT NOT NULL DEFAULT 'legacy_packaged_comparison'
          CHECK (validation_profile IN ('legacy_packaged_comparison', 'packaged_structured_oracle_v1'));
      ALTER TABLE observer_recipe_trials
        ADD COLUMN oracle_evaluated_field_count INTEGER NOT NULL DEFAULT 0
          CHECK (oracle_evaluated_field_count BETWEEN 0 AND 5);
      ALTER TABLE observer_recipe_trials
        ADD COLUMN oracle_agreed_field_count INTEGER NOT NULL DEFAULT 0
          CHECK (oracle_agreed_field_count BETWEEN 0 AND 5);
      ALTER TABLE observer_recipe_trials
        ADD COLUMN oracle_conflict_field_count INTEGER NOT NULL DEFAULT 0
          CHECK (oracle_conflict_field_count BETWEEN 0 AND 5);
      ALTER TABLE observer_recipe_trials
        ADD COLUMN packaged_missing_field_count INTEGER NOT NULL DEFAULT 0
          CHECK (packaged_missing_field_count BETWEEN 0 AND 5);
      ALTER TABLE observer_recipe_trials
        ADD COLUMN packaged_conflict_field_count INTEGER NOT NULL DEFAULT 0
          CHECK (packaged_conflict_field_count BETWEEN 0 AND 5);
      ALTER TABLE observer_recipe_trials
        ADD COLUMN insufficient_field_count INTEGER NOT NULL DEFAULT 0
          CHECK (insufficient_field_count BETWEEN 0 AND 5);
      ALTER TABLE observer_recipe_trials
        ADD COLUMN field_outcomes_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(field_outcomes_json) AND json_type(field_outcomes_json) = 'array'
            AND length(field_outcomes_json) <= 1200);

      CREATE INDEX observer_recipe_trials_oracle_gate_idx
        ON observer_recipe_trials(
          recipe_id, validation_profile, outcome,
          packaged_conflict_field_count, oracle_conflict_field_count,
          oracle_agreed_field_count, received_at DESC
        );
    `
  },
  {
    version: 43,
    name: "observer_recipe_contributor_canary_governance",
    sql: `
      ALTER TABLE observer_recipe_trials
        ADD COLUMN recipe_state_at_trial TEXT NOT NULL DEFAULT 'legacy_unknown'
          CHECK (recipe_state_at_trial IN ('legacy_unknown', 'shadow', 'canary', 'trusted_read_only'));

      CREATE INDEX observer_recipe_trials_contributor_stage_idx
        ON observer_recipe_trials(
          recipe_id, recipe_state_at_trial, user_id,
          retailer_sku, layout_fingerprint, observed_at DESC, received_at DESC
        );
    `
  },
  {
    version: 44,
    name: "quarantined_observer_recipe_recovery_evidence",
    sql: `
      CREATE TABLE observer_recipe_recovery_evidence (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES extension_devices(id) ON DELETE CASCADE,
        trial_id TEXT NOT NULL REFERENCES observer_recipe_trials(id) ON DELETE CASCADE,
        recipe_id TEXT NOT NULL REFERENCES observer_recipe_candidates(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
        retailer_sku TEXT NOT NULL,
        layout_fingerprint TEXT NOT NULL CHECK (length(layout_fingerprint) = 64),
        field_name TEXT NOT NULL CHECK (field_name IN (
          'availability', 'unitPrice', 'seller', 'fulfillment', 'addControl'
        )),
        value_kind TEXT NOT NULL CHECK (value_kind IN ('enum', 'cents', 'text', 'boolean')),
        normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 1 AND 160),
        provenance_code TEXT NOT NULL DEFAULT 'recipe_packaged_oracle_agreement_v1'
          CHECK (provenance_code = 'recipe_packaged_oracle_agreement_v1'),
        recipe_state_at_trial TEXT NOT NULL CHECK (recipe_state_at_trial IN (
          'shadow', 'canary', 'trusted_read_only'
        )),
        evidence_state TEXT NOT NULL DEFAULT 'quarantined'
          CHECK (evidence_state = 'quarantined'),
        application_state TEXT NOT NULL DEFAULT 'not_applied'
          CHECK (application_state = 'not_applied'),
        observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        UNIQUE(trial_id, field_name),
        CHECK (
          (field_name IN ('availability', 'fulfillment') AND value_kind = 'enum')
          OR (field_name = 'unitPrice' AND value_kind = 'cents')
          OR (field_name = 'seller' AND value_kind = 'text')
          OR (field_name = 'addControl' AND value_kind = 'boolean')
        )
      ) STRICT;

      CREATE INDEX observer_recipe_recovery_evidence_review_idx
        ON observer_recipe_recovery_evidence(
          tenant_id, evidence_state, retailer_id, received_at DESC, id DESC
        );
      CREATE INDEX observer_recipe_recovery_evidence_recipe_field_idx
        ON observer_recipe_recovery_evidence(
          recipe_id, field_name, user_id, retailer_sku, layout_fingerprint,
          observed_at DESC, received_at DESC
        );

      CREATE TRIGGER observer_recipe_recovery_evidence_no_update
      BEFORE UPDATE ON observer_recipe_recovery_evidence
      BEGIN SELECT RAISE(ABORT, 'observer recipe recovery evidence is append-only'); END;

      CREATE TRIGGER observer_recipe_recovery_evidence_no_delete
      BEFORE DELETE ON observer_recipe_recovery_evidence
      WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
      BEGIN SELECT RAISE(ABORT, 'observer recipe recovery evidence is append-only'); END;
    `
  },
  {
    version: 45,
    name: "observer_recipe_recovery_user_reviews",
    sql: `
      CREATE UNIQUE INDEX observer_recipe_recovery_evidence_owner_idx
        ON observer_recipe_recovery_evidence(tenant_id, user_id, id);

      CREATE TABLE observer_recipe_recovery_reviews (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected', 'revoked')),
        confirmation_code TEXT NOT NULL,
        evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'maintainer')),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 3 AND 120),
        created_at TEXT NOT NULL,
        UNIQUE(evidence_id, sequence),
        CHECK (
          (decision = 'confirmed' AND confirmation_code = 'CONFIRM_NORMALIZED_RECOVERY_EVIDENCE')
          OR (decision = 'rejected' AND confirmation_code = 'REJECT_NORMALIZED_RECOVERY_EVIDENCE')
          OR (decision = 'revoked' AND confirmation_code = 'REVOKE_NORMALIZED_RECOVERY_CONFIRMATION')
        ),
        FOREIGN KEY(tenant_id, user_id, evidence_id)
          REFERENCES observer_recipe_recovery_evidence(tenant_id, user_id, id)
          ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX observer_recipe_recovery_reviews_owner_idx
        ON observer_recipe_recovery_reviews(
          tenant_id, user_id, created_at DESC, id DESC
        );
      CREATE INDEX observer_recipe_recovery_reviews_current_idx
        ON observer_recipe_recovery_reviews(evidence_id, sequence DESC);

      CREATE TRIGGER observer_recipe_recovery_reviews_no_update
      BEFORE UPDATE ON observer_recipe_recovery_reviews
      BEGIN SELECT RAISE(ABORT, 'observer recipe recovery reviews are append-only'); END;

      CREATE TRIGGER observer_recipe_recovery_reviews_no_delete
      BEFORE DELETE ON observer_recipe_recovery_reviews
      WHEN EXISTS (
        SELECT 1 FROM users WHERE tenant_id = OLD.tenant_id AND id = OLD.user_id
      )
      BEGIN SELECT RAISE(ABORT, 'observer recipe recovery reviews are append-only'); END;
    `
  },
  {
    version: 46,
    name: "observer_recipe_recovery_retention",
    sql: `
      CREATE TABLE observer_recipe_recovery_retention_receipts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        policy_version TEXT NOT NULL
          CHECK (policy_version = 'observer_recipe_recovery_retention_v1'),
        retention_days INTEGER NOT NULL CHECK (retention_days = 90),
        cutoff_at TEXT NOT NULL,
        deleted_evidence_count INTEGER NOT NULL
          CHECK (deleted_evidence_count BETWEEN 1 AND 500),
        deleted_review_event_count INTEGER NOT NULL
          CHECK (deleted_review_event_count BETWEEN 0 AND 1000000),
        application_affected INTEGER NOT NULL DEFAULT 0 CHECK (application_affected = 0),
        field_fill_applied INTEGER NOT NULL DEFAULT 0 CHECK (field_fill_applied = 0),
        created_by_actor_id TEXT NOT NULL CHECK (length(created_by_actor_id) BETWEEN 3 AND 120),
        privacy_classification TEXT NOT NULL DEFAULT 'restricted_user_aggregate'
          CHECK (privacy_classification = 'restricted_user_aggregate'),
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX observer_recipe_recovery_retention_receipts_owner_idx
        ON observer_recipe_recovery_retention_receipts(
          tenant_id, user_id, created_at DESC, id DESC
        );
      CREATE INDEX observer_recipe_recovery_evidence_owner_retention_idx
        ON observer_recipe_recovery_evidence(
          tenant_id, user_id, received_at, id
        );
      CREATE INDEX observer_recipe_recovery_reviews_retention_idx
        ON observer_recipe_recovery_reviews(
          tenant_id, user_id, evidence_id, created_at DESC
        );

      CREATE TRIGGER observer_recipe_recovery_retention_receipts_no_update
      BEFORE UPDATE ON observer_recipe_recovery_retention_receipts
      BEGIN SELECT RAISE(ABORT, 'observer recipe recovery retention receipts are append-only'); END;

      CREATE TRIGGER observer_recipe_recovery_retention_receipts_no_delete
      BEFORE DELETE ON observer_recipe_recovery_retention_receipts
      WHEN EXISTS (
        SELECT 1 FROM users WHERE tenant_id = OLD.tenant_id AND id = OLD.user_id
      )
      BEGIN SELECT RAISE(ABORT, 'observer recipe recovery retention receipts are append-only'); END;

      DROP TRIGGER observer_recipe_recovery_reviews_no_delete;
      CREATE TRIGGER observer_recipe_recovery_reviews_no_delete
      BEFORE DELETE ON observer_recipe_recovery_reviews
      WHEN EXISTS (
        SELECT 1 FROM users WHERE tenant_id = OLD.tenant_id AND id = OLD.user_id
      ) AND EXISTS (
        SELECT 1 FROM observer_recipe_recovery_evidence
        WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id AND id = OLD.evidence_id
      )
      BEGIN SELECT RAISE(ABORT, 'observer recipe recovery reviews are append-only'); END;

      DROP TRIGGER observer_recipe_recovery_evidence_no_delete;
      CREATE TRIGGER observer_recipe_recovery_evidence_no_delete
      BEFORE DELETE ON observer_recipe_recovery_evidence
      WHEN EXISTS (
        SELECT 1 FROM users WHERE tenant_id = OLD.tenant_id AND id = OLD.user_id
      ) AND NOT (
        OLD.received_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')
        AND NOT EXISTS (
          SELECT 1 FROM observer_recipe_recovery_reviews review
          WHERE review.tenant_id = OLD.tenant_id
            AND review.user_id = OLD.user_id
            AND review.evidence_id = OLD.id
            AND review.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')
        )
      )
      BEGIN SELECT RAISE(ABORT, 'observer recipe recovery evidence is retained until bounded cleanup'); END;
    `
  },
  {
    version: 47,
    name: "observer_recipe_regional_conflict_eligibility",
    sql: `
      INSERT INTO authorization_permissions(id, description, created_at)
      VALUES (
        'internal.eligibility',
        'Maintain short-lived contributor account, device, and coarse-region eligibility.',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ) ON CONFLICT(id) DO NOTHING;

      CREATE UNIQUE INDEX extension_devices_tenant_user_id_unique
        ON extension_devices(tenant_id, user_id, id);

      CREATE TABLE observer_recipe_contributor_eligibility_states (
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        policy_version TEXT NOT NULL
          CHECK (policy_version = 'observer_recipe_contributor_eligibility_v1'),
        contributor_ref_hash TEXT NOT NULL
          CHECK (length(contributor_ref_hash) = 64
            AND contributor_ref_hash NOT GLOB '*[^a-f0-9]*'),
        region_scope TEXT NOT NULL
          CHECK (
            (length(region_scope) = 10
              AND region_scope GLOB 'country:[A-Z][A-Z]')
            OR (length(region_scope) BETWEEN 16 AND 18
              AND substr(region_scope, 1, 12) = 'subdivision:'
              AND substr(region_scope, 13, 2) GLOB '[A-Z][A-Z]'
              AND substr(region_scope, 15, 1) = '-'
              AND substr(region_scope, 16) NOT GLOB '*[^A-Z0-9]*')
          ),
        account_eligible INTEGER NOT NULL CHECK (account_eligible IN (0, 1)),
        device_eligible INTEGER NOT NULL CHECK (device_eligible IN (0, 1)),
        region_eligible INTEGER NOT NULL CHECK (region_eligible IN (0, 1)),
        proof_hash TEXT NOT NULL
          CHECK (length(proof_hash) = 64 AND proof_hash NOT GLOB '*[^a-f0-9]*'),
        source TEXT NOT NULL CHECK (source = 'external_identity_risk_v1'),
        attested_by_actor_id TEXT NOT NULL
          CHECK (length(attested_by_actor_id) BETWEEN 3 AND 120),
        privacy_classification TEXT NOT NULL DEFAULT 'restricted_eligibility_metadata'
          CHECK (privacy_classification = 'restricted_eligibility_metadata'),
        attested_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id, user_id, device_id),
        CHECK (
          region_eligible = 0
          OR substr(region_scope, 1, 12) = 'subdivision:'
        ),
        CHECK (julianday(attested_at) IS NOT NULL),
        CHECK (julianday(expires_at) IS NOT NULL),
        CHECK (julianday(expires_at) > julianday(attested_at)),
        CHECK (julianday(expires_at) - julianday(attested_at) <= 1.0),
        FOREIGN KEY(tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY(tenant_id, user_id, device_id)
          REFERENCES extension_devices(tenant_id, user_id, id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX observer_recipe_contributor_eligibility_expiry_idx
        ON observer_recipe_contributor_eligibility_states(
          tenant_id, expires_at, account_eligible, device_eligible, region_eligible
        );

      CREATE TRIGGER observer_recipe_contributor_eligibility_monotonic
      BEFORE UPDATE ON observer_recipe_contributor_eligibility_states
      WHEN NEW.tenant_id <> OLD.tenant_id
        OR NEW.user_id <> OLD.user_id
        OR NEW.device_id <> OLD.device_id
        OR NEW.policy_version <> OLD.policy_version
        OR NEW.source <> OLD.source
        OR NEW.privacy_classification <> OLD.privacy_classification
        OR NEW.created_at <> OLD.created_at
        OR NEW.attested_at <= OLD.attested_at
      BEGIN SELECT RAISE(ABORT, 'observer recipe contributor eligibility attestations must advance monotonically'); END;

      CREATE TRIGGER observer_recipe_contributor_eligibility_no_delete
      BEFORE DELETE ON observer_recipe_contributor_eligibility_states
      WHEN EXISTS (
        SELECT 1 FROM users WHERE tenant_id = OLD.tenant_id AND id = OLD.user_id
      ) AND EXISTS (
        SELECT 1 FROM extension_devices WHERE id = OLD.device_id
      )
      BEGIN SELECT RAISE(ABORT, 'observer recipe contributor eligibility is service-managed'); END;

      ALTER TABLE observer_recipe_trials
        ADD COLUMN eligibility_policy_version TEXT NOT NULL DEFAULT ''
          CHECK (eligibility_policy_version IN ('', 'observer_recipe_contributor_eligibility_v1'));
      ALTER TABLE observer_recipe_trials
        ADD COLUMN eligibility_state TEXT NOT NULL DEFAULT 'unverified'
          CHECK (eligibility_state IN ('unverified', 'externally_attested'));
      ALTER TABLE observer_recipe_trials
        ADD COLUMN contributor_ref_hash TEXT NOT NULL DEFAULT ''
          CHECK (contributor_ref_hash = '' OR (
            length(contributor_ref_hash) = 64
            AND contributor_ref_hash NOT GLOB '*[^a-f0-9]*'
          ));
      ALTER TABLE observer_recipe_trials
        ADD COLUMN eligibility_proof_hash TEXT NOT NULL DEFAULT ''
          CHECK (eligibility_proof_hash = '' OR (
            length(eligibility_proof_hash) = 64
            AND eligibility_proof_hash NOT GLOB '*[^a-f0-9]*'
          ));
      ALTER TABLE observer_recipe_trials
        ADD COLUMN region_scope TEXT NOT NULL DEFAULT ''
          CHECK (
            region_scope = ''
            OR region_scope GLOB 'subdivision:[A-Z][A-Z]-[A-Z0-9]*'
          );

      CREATE INDEX observer_recipe_trials_regional_conflict_slo_idx
        ON observer_recipe_trials(
          tenant_id, recipe_id, eligibility_state, received_at,
          contributor_ref_hash, region_scope
        );
    `
  }
]);
