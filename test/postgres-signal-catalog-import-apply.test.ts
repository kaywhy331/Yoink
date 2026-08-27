import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION,
  buildPostgresSignalCatalogImportApplyManifest,
  buildPostgresSignalCatalogImportRequestId,
  postgresSignalCatalogImportCapabilityProjection,
  signalCatalogImportApplyBoundarySpec,
  signalCatalogImportApplyFunctionSource,
  type PostgresSignalCatalogImportPayload
} from "../packages/database/src/postgres-signal-catalog-import-apply.js";

const principal = { tenantId: "tenant_test", userId: "user_test" };
const payload: PostgresSignalCatalogImportPayload = {
  deviceId: "device_test_123",
  sourceConnectionId: "source_test_trackalacker",
  syncId: "tlsync_fixture_12345678",
  sourceProductId: "trackalacker-product:138022",
  sourceProductSlug: "fixture-product-138022",
  sourceProductUrl: "https://www.trackalacker.com/products/show/138022",
  title: "Fixture collectible",
  msrpCents: 4_999,
  observedAt: "2026-08-27T12:00:00.000Z",
  listings: [
    {
      sourceListingId: "trackalacker-listing:amazon:B0FIXTURE1",
      storeName: "Amazon",
      retailerId: "amazon",
      retailerSku: "B0FIXTURE1",
      canonicalUrl: "https://www.amazon.com/dp/B0FIXTURE1",
      sourceListingUrl: "https://www.trackalacker.com/listing/fixture-amazon",
      outboundUrl: "https://www.amazon.com/dp/B0FIXTURE1?tag=fixture-20",
      availability: "in_stock",
      unitPriceCents: 4_799
    },
    {
      sourceListingId: "trackalacker-listing:walmart:123456789",
      storeName: "Walmart",
      retailerId: "walmart",
      retailerSku: "123456789",
      canonicalUrl: "https://www.walmart.com/ip/fixture/123456789",
      sourceListingUrl: "https://www.trackalacker.com/listing/fixture-walmart",
      outboundUrl: "https://www.walmart.com/ip/fixture/123456789",
      availability: "out_of_stock",
      unitPriceCents: null
    }
  ],
  confirmation: POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONFIRMATION
};

test("the catalog-import writer is deterministic, bounded, serialized, and inactive", () => {
  const manifest = buildPostgresSignalCatalogImportApplyManifest();
  assert.deepEqual(buildPostgresSignalCatalogImportApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.reservationLifecycleApplyContractVersion, 1);
  assert.equal(manifest.writerLockProtocolContractVersion, 1);
  assert.equal(manifest.catalogImportRole.kind, "signal_catalog_import_apply_boundary");
  assert.equal(manifest.catalogImportRole.functionName, POSTGRES_SIGNAL_CATALOG_IMPORT_APPLY_FUNCTION);
  assert.equal(manifest.catalogImportRole.login, false);
  assert.equal(manifest.catalogImportRole.inherit, false);
  assert.equal(manifest.catalogImportRole.bypassRls, false);
  assert.equal(manifest.catalogImportRole.directTableAccess, false);
  assert.deepEqual(manifest.catalogImportRole.protectedTenantTableNames, [
    "audit_events",
    "extension_devices",
    "mission_targets",
    "missions",
    "offer_observations",
    "outbox_events",
    "source_connections",
    "source_listing_candidates",
    "source_listing_refs",
    "source_product_aliases",
    "source_product_refs",
    "source_sync_run_items",
    "source_sync_runs",
    "source_variant_retailer_refs"
  ]);
  assert.deepEqual(manifest.catalogImportRole.mutationTableNames, [
    "audit_events",
    "mission_targets",
    "offer_observations",
    "outbox_events",
    "source_connections",
    "source_listing_candidates",
    "source_listing_refs",
    "source_product_aliases",
    "source_product_refs",
    "source_sync_run_items",
    "source_variant_retailer_refs"
  ]);
  assert.deepEqual(manifest.catalogImportRole.protectedSharedCatalogTableNames, [
    "listing_urls", "listings", "product_families", "retailers", "variants"
  ]);
  assert.deepEqual(manifest.catalogImportRole.sharedCatalogMutationTableNames, [
    "listing_urls", "listings", "product_families", "variants"
  ]);

  const boundarySpec = signalCatalogImportApplyBoundarySpec(manifest);
  assert.deepEqual(boundarySpec.metadata.protectedSharedCatalogTableNames, [
    "listing_urls", "listings", "product_families", "retailers", "variants"
  ]);
  assert.deepEqual(boundarySpec.metadata.sharedCatalogMutationTableNames, [
    "listing_urls", "listings", "product_families", "variants"
  ]);
  assert.equal(boundarySpec.metadata.protectedSharedCatalogTableCount, 5);
  assert.equal(boundarySpec.metadata.sharedCatalogMutationTableCount, 4);
  assert.equal(boundarySpec.metadata.totalMutationTableCount, 15);
  assert.deepEqual(boundarySpec.protectedTenantTableNames, manifest.catalogImportRole.protectedTenantTableNames);
  assert.deepEqual(boundarySpec.mutationTableNames, manifest.catalogImportRole.mutationTableNames);

  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.maximumListingsPerItem, 250);
  assert.equal(manifest.supportedExecutionRetailerCount, 4);
  assert.equal(manifest.protectedTenantTableCount, 14);
  assert.equal(manifest.tenantMutationTableCount, 11);
  assert.equal(manifest.protectedSharedCatalogTableCount, 5);
  assert.equal(manifest.sharedCatalogMutationTableCount, 4);
  assert.equal(manifest.totalMutationTableCount, 15);
  assert.equal(manifest.writerLockProtocolConsumed, true);
  assert.equal(manifest.sourceScopeConsumed, true);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.immutableAuditedReplay, true);
  assert.equal(manifest.boundedCatalogPayload, true);
  assert.equal(manifest.completeSetIdentityConsensus, true);
  assert.equal(manifest.crossTenantCatalogSerialization, true);
  assert.equal(manifest.sourceProductConflictFailClosed, true);
  assert.equal(manifest.sourceAliasConflictFailClosed, true);
  assert.equal(manifest.sourceListingConflictFailClosed, true);
  assert.equal(manifest.sourceCandidateConflictFailClosed, true);
  assert.equal(manifest.registeredRetailerRevalidation, true);
  assert.equal(manifest.canonicalRetailerUrlRevalidation, true);
  assert.equal(manifest.serverDerivedExecutionSupport, true);
  assert.equal(manifest.monotonicSourceObservation, true);
  assert.equal(manifest.candidateUpsertParity, true);
  assert.equal(manifest.listingUpsertParity, true);
  assert.equal(manifest.sourceReferenceUpsertParity, true);
  assert.equal(manifest.preferredRetailerRouteParity, true);
  assert.equal(manifest.idempotentOfferObservation, true);
  assert.equal(manifest.existingMissionTargetAttachmentParity, true);
  assert.equal(manifest.optionalSyncItemCompositionParity, true);
  assert.equal(manifest.atomicCatalogSyncAuditOutbox, true);
  assert.equal(manifest.currentSourceOwnershipRevalidation, true);
  assert.equal(manifest.currentDeviceOwnershipRevalidation, true);
  assert.equal(manifest.currentRunOwnershipRevalidation, true);
  assert.equal(manifest.activeDeviceOnly, true);
  assert.equal(manifest.privateSourceOnly, true);
  assert.equal(manifest.trackalackerOnly, true);
  assert.equal(manifest.catalogImportWriterParity, true);
  assert.equal(manifest.connectionProvisioningWriterParity, false);
  assert.equal(manifest.sourceWriterParity, false);
  assert.equal(manifest.reservationWriterParity, true);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalCatalogImportApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_lock_signal_action_constraints/);
  assert.match(source, /source_connection_id_value, '', '', '10000'/);
  assert.match(source, /TRACKALACKER_CATALOG_IMPORT_V1/);
  assert.match(source, /import_trackalacker_catalog_item/);
  assert.match(source, /listing_count > 250/);
  assert.match(source, /octet_length\(\(candidate\.value->>'sourceListingId'\)\)/);
  assert.match(source, /\|\| \(candidate\.value->>'sourceListingId'\)/);
  assert.match(source, /yoink_catalog_import_source_v1:/);
  assert.match(source, /yoink_signal_catalog_apply_v1:/);
  assert.match(source, /signal catalog-import exact identities resolve to different variants/);
  assert.match(source, /signal catalog-import source product observation is stale/);
  assert.match(source, /INSERT INTO .*"product_families"/s);
  assert.match(source, /INSERT INTO .*"variants"/s);
  assert.match(source, /INSERT INTO .*"source_product_refs"/s);
  assert.match(source, /INSERT INTO .*"source_product_aliases"/s);
  assert.match(source, /INSERT INTO .*"source_listing_candidates"/s);
  assert.match(source, /INSERT INTO .*"listings"/s);
  assert.match(source, /INSERT INTO .*"listing_urls"/s);
  assert.match(source, /INSERT INTO .*"source_listing_refs"/s);
  assert.match(source, /INSERT INTO .*"source_variant_retailer_refs"/s);
  assert.match(source, /INSERT INTO .*"offer_observations"/s);
  assert.match(source, /INSERT INTO .*"mission_targets"/s);
  assert.match(source, /INSERT INTO .*"source_sync_run_items"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(source, /INSERT INTO\s+"[^"]+"\."source_connections"/);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:action_jobs|spend_reservations|spend_ledger_entries|inbox_messages|settings|target_qualifications|retailer_qualifications|checkout_sessions|orders)"/
  );

  const requestId = buildPostgresSignalCatalogImportRequestId(
    principal,
    "import_trackalacker_catalog_item",
    payload
  );
  assert.match(requestId, /^catalog_import_[a-f0-9]{32}$/);
  assert.equal(
    buildPostgresSignalCatalogImportRequestId(
      principal,
      "import_trackalacker_catalog_item",
      payload
    ),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalCatalogImportRequestId(
      principal,
      "import_trackalacker_catalog_item",
      { ...payload, sourceProductId: "trackalacker-product:other" }
    ),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalCatalogImportRequestId(
      principal,
      "import_trackalacker_catalog_item",
      { ...payload, listings: [{ ...payload.listings[0]!, unitPriceCents: 4_800 }] }
    ),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalCatalogImportRequestId(
      { ...principal, userId: "user_other" },
      "import_trackalacker_catalog_item",
      payload
    ),
    requestId
  );

  const capability = postgresSignalCatalogImportCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, true);
  assert.equal(capability.sourceScopeConsumed, true);
  assert.equal(capability.completeSetIdentityConsensus, true);
  assert.equal(capability.crossTenantCatalogSerialization, true);
  assert.equal(capability.catalogImportWriterParity, true);
  assert.equal(capability.connectionProvisioningWriterParity, false);
  assert.equal(capability.sourceWriterParity, false);
  assert.equal(capability.reservationWriterParity, true);
  assert.equal(capability.writerLockProtocolParity, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.sharedCatalogMutationAuthority, true);
  assert.equal(capability.actionAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalCatalogImportApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.reservationLifecycleRoleNamespace
    ),
    /independent/
  );
});

test("the generated catalog-import PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    await database.exec("SET search_path TO pg_catalog");
    const source = signalCatalogImportApplyFunctionSource(
      buildPostgresSignalCatalogImportApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_catalog_import_parse_probe(
      expected_tenant_id text, expected_user_id text, operation_name text,
      request_id text, request_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${source}
    $function$`);
  } finally {
    await database.close();
  }
});
