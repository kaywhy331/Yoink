import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { SignalEventInput } from "../packages/contracts/src/index.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import {
  POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION,
  buildPostgresSignalAttributionReceiptApplyManifest
} from "../packages/database/src/postgres-signal-attribution-receipt-apply.js";
import {
  POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_FUNCTION,
  POSTGRES_SIGNAL_INGRESS_EVENT_TYPE,
  POSTGRES_SIGNAL_INGRESS_SOURCE,
  PostgresSignalIngressEnqueueApplyQualificationError,
  buildPostgresSignalIngressAcceptRequestId,
  buildPostgresSignalIngressEnqueueApplyManifest,
  normalizedPostgresSignalIngressAcceptPayload,
  postgresSignalIngressEnqueueApplyCapabilityProjection,
  signalIngressEnqueueApplyFunctionSource
} from "../packages/database/src/postgres-signal-ingress-enqueue-apply.js";
import {
  POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
  buildPostgresTenantQueueWriteManifest
} from "../packages/database/src/postgres-tenant-queue-writes.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID } from "../packages/database/src/database.js";
import {
  runWithRequestScope,
  type RequestScope
} from "../packages/database/src/request-scope.js";
import { stableHash } from "../packages/domain/src/ids.js";
import { DurableSignalIngressService } from "../packages/engine/src/signal-ingress.js";

const NOW = new Date("2026-08-27T09:00:00.000Z").getTime();
const principal = { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID };
const DEVICE_SCOPE: RequestScope = {
  tenantId: principal.tenantId,
  userId: principal.userId,
  actorKind: "device",
  actorId: "device_signal_ingress_apply_test"
};

function signal(sequence = 1): SignalEventInput {
  return {
    schemaVersion: 1,
    signalId: `push:trackalacker:durable-${sequence}`,
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    externalEventId: `push:trackalacker:durable-${sequence}`,
    eventType: "unknown",
    observedAt: new Date(NOW).toISOString(),
    receivedAt: new Date(NOW + 1_000).toISOString(),
    test: true,
    identity: {},
    offer: {
      availability: "unknown",
      currency: "USD",
      offerId: `EPHEMERAL-OFFER-${sequence}`
    },
    evidence: {
      headline: "TrackaLacker connectivity test",
      clickUrl: "https://www.target.com/p/example/-/A-1011483414?tracking=discard"
    },
    parserVersion: "trackalacker-push-v1"
  };
}

test("the signal-ingress accept writer is deterministic, hardcoded-scope, queue-write-consuming, and inactive", () => {
  const manifest = buildPostgresSignalIngressEnqueueApplyManifest();
  assert.deepEqual(buildPostgresSignalIngressEnqueueApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.attributionReceiptApplyContractVersion, POSTGRES_SIGNAL_ATTRIBUTION_RECEIPT_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.tenantQueueWriteContractVersion, POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION);
  assert.equal(manifest.ingressAcceptRole.kind, "signal_ingress_enqueue_apply_boundary");
  assert.equal(manifest.ingressAcceptRole.functionName, POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_FUNCTION);
  assert.equal(manifest.ingressAcceptRole.login, false);
  assert.equal(manifest.ingressAcceptRole.inherit, false);
  assert.equal(manifest.ingressAcceptRole.bypassRls, false);
  assert.equal(manifest.ingressAcceptRole.directTableAccess, false);
  // This boundary's own SQL function touches exactly the two tables the
  // initial `acceptInbox` enqueue actually writes -- never any
  // `background_task*` table (that half is CONSUMED from
  // postgres-tenant-queue-writes.ts, not reimplemented; see module header
  // §2).
  assert.deepEqual(manifest.ingressAcceptRole.protectedTenantTableNames, [
    "hosted_delivery_receipts", "inbox_messages"
  ]);
  assert.deepEqual(manifest.ingressAcceptRole.mutationTableNames, [
    "hosted_delivery_receipts", "inbox_messages"
  ]);
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.hardcodedSource, "trackalacker");
  assert.equal(manifest.hardcodedEventType, "signal_event_v1");
  assert.equal(manifest.hardcodedSource, POSTGRES_SIGNAL_INGRESS_SOURCE);
  assert.equal(manifest.hardcodedEventType, POSTGRES_SIGNAL_INGRESS_EVENT_TYPE);
  assert.equal(manifest.envelopeKeyCount, 13);
  assert.equal(manifest.protectedTenantTableCount, 2);
  assert.equal(manifest.forcedRlsTableCount, 2);
  assert.equal(manifest.mutationTableCount, 2);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);

  // Chains onto attribution-receipt-apply, the newest full-writer sibling
  // at the time this boundary was authored -- and separately CONSUMES (via
  // fingerprint + a live verify call, never an apply call) the ALREADY
  // qualified tenant queue-writer, for the task-enqueue half this module
  // deliberately does not reimplement.
  const attributionReceiptManifest = buildPostgresSignalAttributionReceiptApplyManifest();
  assert.equal(manifest.attributionReceiptApplyManifestFingerprint, attributionReceiptManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.fingerprint, attributionReceiptManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.schemaName, attributionReceiptManifest.schemaName);
  assert.equal(
    manifest.predecessorManifest.attributionReceiptRoleNamespace,
    attributionReceiptManifest.attributionReceiptRoleNamespace
  );
  assert.notEqual(manifest.ingressAcceptRoleNamespace, attributionReceiptManifest.attributionReceiptRoleNamespace);

  const queueWriteManifest = buildPostgresTenantQueueWriteManifest(manifest.schemaName);
  assert.equal(manifest.queueWriteManifestFingerprint, queueWriteManifest.fingerprint);
  assert.equal(manifest.queueWriteManifest.fingerprint, queueWriteManifest.fingerprint);
  assert.equal(manifest.queueWriteManifest.schemaName, queueWriteManifest.schemaName);
  assert.equal(manifest.queueWriteManifest.writeRoleNamespace, queueWriteManifest.writeRoleNamespace);
  assert.notEqual(manifest.ingressAcceptRoleNamespace, queueWriteManifest.writeRoleNamespace);
  // enqueueServiceTask's real write surface (background_task_schedules
  // [SELECT,INSERT,UPDATE], background_tasks [SELECT,INSERT,UPDATE],
  // background_task_events [SELECT,INSERT]) is a strict subset of the
  // queue-writer's own qualified 5-table/12-grant surface -- static proof
  // this test asserts by shape, not a live functional-equivalence check.
  assert.equal(queueWriteManifest.tableCount, 5);
  assert.equal(queueWriteManifest.grantCount, 12);
  assert.deepEqual(
    queueWriteManifest.writeRole.tableGrants
      .filter((grant) => ["background_task_schedules", "background_tasks", "background_task_events"]
        .includes(grant.tableName))
      .map((grant) => ({ tableName: grant.tableName, privileges: grant.privileges })),
    [
      { tableName: "background_task_schedules", privileges: ["SELECT", "INSERT", "UPDATE"] },
      { tableName: "background_tasks", privileges: ["SELECT", "INSERT", "UPDATE"] },
      { tableName: "background_task_events", privileges: ["SELECT", "INSERT"] }
    ]
  );

  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.callerScopeHardcoded, true);
  assert.equal(manifest.messageKeyDatabaseDerived, true);
  assert.equal(manifest.payloadHashDatabaseDerived, true);
  assert.equal(manifest.sanitizedEnvelopeAcceptedAsInput, true);
  assert.equal(manifest.conflictingContentFailsClosed, true);
  assert.equal(manifest.receiptLedgerAppendOnly, true);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.deterministicReceiptIdentity, true);
  assert.equal(manifest.databaseOwnedTimestamps, true);
  // hosted_delivery_receipts/inbox_messages are not one of the five domains
  // the shared writer-lock protocol guards -- same posture as
  // attribution_receipts/attribution_policies.
  assert.equal(manifest.writerLockProtocolConsumed, false);
  assert.equal(manifest.queueWriteBoundaryConsumed, true);

  // World-state carried forward unchanged from attribution-receipt-apply,
  // plus this boundary's own new closure. signalIngressRepositoryParity
  // stays false: this module alone does not bind hostedDeliveryLeaseRecovery
  // or the resolution-plan function -- only a future composition rung can.
  assert.equal(manifest.sourceTrustWriterParity, true);
  assert.equal(manifest.sourceStatusWriterParity, true);
  assert.equal(manifest.sourceSyncWriterParity, true);
  assert.equal(manifest.catalogImportWriterParity, true);
  assert.equal(manifest.connectionProvisioningWriterParity, true);
  assert.equal(manifest.sourceWriterParity, true);
  assert.equal(manifest.retailerQualificationWriterParity, true);
  assert.equal(manifest.missionPolicyWriterParity, true);
  assert.equal(manifest.settingsWriterParity, false);
  assert.equal(manifest.configurationWriterParity, false);
  assert.equal(manifest.reservationWriterParity, true);
  assert.equal(manifest.attributionPolicyParity, true);
  assert.equal(manifest.attributionReceiptWriterParity, true);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.ingressEnqueueWriterParity, true);
  assert.equal(manifest.signalIngressRepositoryParity, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalIngressEnqueueApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /accept_signal_ingress/);
  assert.match(source, /SIGNAL_INGRESS_ACCEPT_V1/);
  assert.match(source, /jsonb_object_keys\(request_payload\)\) <> 2/);
  assert.match(source, /jsonb_object_keys\(signal_envelope\)\) <> 13/);
  assert.match(source, /message\.source = 'trackalacker'/);
  assert.match(source, /'signal_event_v1'/);
  assert.match(source, /ON CONFLICT \(tenant_id, user_id, source, message_key\) DO NOTHING/);
  assert.match(source, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(source, /already used for different content/);
  assert.match(source, /yoink_durable_signal_ingress_v1/);
  assert.match(source, /hosted_delivery_payload_v1/);
  assert.match(source, /hosted_delivery_receipt_v1/);
  assert.match(source, /INSERT INTO .*"inbox_messages"/s);
  assert.match(source, /INSERT INTO .*"hosted_delivery_receipts"/s);
  assert.match(source, /\[\[:cntrl:\]\]/);
  // Defense-in-depth envelope size ceiling, matching MAX_PAYLOAD_BYTES in
  // hosted-delivery-repository.ts exactly, even though sanitizeDiagnosticData's
  // own 100-key/50-entry caps make this practically unreachable via any
  // legitimately normalized signal -- see the parser-contract test below.
  assert.match(source, /NOT BETWEEN 1 AND 65536/);
  // Never touches audit_events/outbox_events (acceptInbox writes neither),
  // never the background_task* family (consumed, not reimplemented), and
  // never calls the shared writer-lock protocol function.
  assert.doesNotMatch(source, /"audit_events"/);
  assert.doesNotMatch(source, /"outbox_events"/);
  assert.doesNotMatch(source, /background_task/);
  assert.doesNotMatch(source, /yoink_lock_signal_action_constraints/);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\.(?!"inbox_messages"|"hosted_delivery_receipts")/
  );

  const payload = normalizedPostgresSignalIngressAcceptPayload(signal(), NOW);
  const requestId = buildPostgresSignalIngressAcceptRequestId(principal, payload);
  assert.match(requestId, /^signal_ingress_accept_[a-f0-9]{32}$/);
  assert.equal(buildPostgresSignalIngressAcceptRequestId(principal, payload), requestId);
  assert.notEqual(
    buildPostgresSignalIngressAcceptRequestId({ ...principal, userId: "user_other" }, payload),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalIngressAcceptRequestId({ ...principal, tenantId: "tenant_other" }, payload),
    requestId
  );
  const otherPayload = normalizedPostgresSignalIngressAcceptPayload(signal(2), NOW);
  assert.notEqual(buildPostgresSignalIngressAcceptRequestId(principal, otherPayload), requestId);

  const capability = postgresSignalIngressEnqueueApplyCapabilityProjection();
  assert.deepEqual(capability, postgresSignalIngressEnqueueApplyCapabilityProjection());
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, false);
  assert.equal(capability.queueWriteBoundaryConsumed, true);
  assert.equal(capability.ingressEnqueueWriterParity, true);
  assert.equal(capability.signalIngressRepositoryParity, false);
  assert.equal(capability.attributionReceiptWriterParity, true);
  assert.equal(capability.envelopeKeyCount, 13);
  assert.equal(capability.protectedTenantTableCount, 2);
  assert.equal(capability.mutationTableCount, 2);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activePrincipalCount, 0);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.sharedCatalogMutationAuthority, false);
  assert.equal(capability.actionAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalIngressEnqueueApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.attributionReceiptRoleNamespace
    ),
    /independent/
  );
  assert.throws(
    () => buildPostgresSignalIngressEnqueueApplyManifest(
      manifest.predecessorManifest as never,
      "yoink_signal_ingress_accept_qual",
      { ...queueWriteManifest, schemaName: "other_schema_xy" }
    ),
    /schema must match/
  );
});

test("the signal-ingress accept payload normalizer mirrors acceptTrackalacker + acceptInbox byte-for-byte (SQLite cross-check)", () => {
  const db = new YoinkDatabase();
  try {
    const ingress = new DurableSignalIngressService(db);
    const receipt = runWithRequestScope(DEVICE_SCOPE, () => ingress.acceptTrackalacker(signal(), NOW));
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.duplicate, false);

    const row = db.get<{
      source: string;
      messageKey: string;
      eventType: string;
      payloadHash: string;
      payloadJson: string;
      state: string;
    }>(
      `SELECT source, message_key AS messageKey, event_type AS eventType,
              payload_hash AS payloadHash, payload_json AS payloadJson, state
       FROM inbox_messages WHERE id = ?`,
      receipt.inboxReceiptId
    );
    assert.ok(row);
    assert.equal(row?.source, "trackalacker");
    assert.equal(row?.eventType, "signal_event_v1");
    assert.equal(row?.state, "accepted");

    const payload = normalizedPostgresSignalIngressAcceptPayload(signal(), NOW);
    assert.equal(payload.confirmation, POSTGRES_SIGNAL_INGRESS_ENQUEUE_APPLY_CONFIRMATION);
    // stableJson is a recursively key-sorted canonical serialization -- if
    // this module's local copy matches hosted-delivery-repository.ts's
    // private original exactly, the two independently-produced strings are
    // byte-identical, not merely structurally equal.
    assert.equal(payload.payloadJson, row?.payloadJson);

    const expectedMessageKey = `signal:${stableHash(
      "yoink_durable_signal_ingress_v1",
      principal.tenantId,
      principal.userId,
      "source_trackalacker_local",
      "push:trackalacker:durable-1"
    )}`;
    assert.equal(row?.messageKey, expectedMessageKey);

    const expectedPayloadHash = stableHash("hosted_delivery_payload_v1", payload.payloadJson);
    assert.equal(row?.payloadHash, expectedPayloadHash);
    assert.match(expectedPayloadHash, /^[a-f0-9]{64}$/);
  } finally {
    db.close();
  }
});

test("the signal-ingress accept payload normalizer requires the packaged TrackaLacker parser contract", () => {
  assert.throws(
    () => normalizedPostgresSignalIngressAcceptPayload({ ...signal(), source: "not_trackalacker" }, NOW),
    PostgresSignalIngressEnqueueApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalIngressAcceptPayload({ ...signal(), parserVersion: "other-parser-v1" }, NOW),
    PostgresSignalIngressEnqueueApplyQualificationError
  );
  // normalizeSignal's own validation (missing required identity fields)
  // still surfaces through this normalizer unchanged.
  assert.throws(
    () => normalizedPostgresSignalIngressAcceptPayload({ ...signal(), sourceConnectionId: "" }, NOW)
  );

  // The normalizer's own MAXIMUM_ENVELOPE_JSON_BYTES guard (65,536, matching
  // hosted-delivery-repository.ts's own MAX_PAYLOAD_BYTES exactly) cannot
  // actually be triggered through any legitimately `normalizeSignal`-shaped
  // input: sanitizeDiagnosticData caps every object to 100 keys and every
  // array to 50 entries at EVERY depth (packages/domain/src/redaction.ts:23),
  // so even the one genuinely uncapped-count field upstream --
  // `identity.globalIdentifiers` -- is truncated to 100 entries long before
  // stableJson runs, and every individual scalar is separately length-capped
  // (evidence.body: 2,000 chars via cleanText, then 500 via safeText). The
  // guard is a real, asserted-in-source defense-in-depth ceiling (see the
  // manifest test's `65536` source assertion below) that legitimate input
  // can never reach -- documented here rather than forced by a contrived
  // payload that would misrepresent what a real caller can ever submit.
});

test("the generated signal-ingress accept PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    await database.exec("SET search_path TO pg_catalog");
    const source = signalIngressEnqueueApplyFunctionSource(
      buildPostgresSignalIngressEnqueueApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_ingress_enqueue_apply_parse_probe(
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
