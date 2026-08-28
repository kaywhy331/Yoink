import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { SIGNAL_INGRESS_EVENT_TYPE } from "../packages/contracts/src/signal-ingress.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { HostedDeliveryRepository } from "../packages/database/src/hosted-delivery-repository.js";
import {
  POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONFIRMATION,
  POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_FUNCTION,
  POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE,
  PostgresSignalDeadLetterResetApplyQualificationError,
  buildPostgresSignalDeadLetterResetApplyManifest,
  buildPostgresSignalDeadLetterResetRequestId,
  normalizedPostgresSignalDeadLetterResetPayload,
  postgresSignalDeadLetterResetCapabilityProjection,
  signalDeadLetterResetApplyFunctionSource
} from "../packages/database/src/postgres-signal-dead-letter-reset-apply.js";
import {
  POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION,
  buildPostgresSignalJobLifecycleApplyManifest
} from "../packages/database/src/postgres-signal-job-lifecycle-apply.js";
import { LOCAL_REQUEST_SCOPE, runWithRequestScope } from "../packages/database/src/request-scope.js";
import { nowIso, stableHash } from "../packages/domain/src/ids.js";

const NOW = new Date("2026-08-28T09:00:00.000Z").getTime();
const principal = { tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID };

/**
 * Drives a real `HostedDeliveryRepository`/SQLite fixture from `accepted`
 * straight to `dead_letter` with the minimum number of state transitions:
 * accept -> lease (attempt 1) -> force `delivery_attempts` to the
 * `MAX_DELIVERY_ATTEMPTS` ceiling via a direct row update (bypassing the
 * usual 20-cycle lease/retry loop, which changes nothing `retryInbox`
 * itself reads besides that one column) -> one more `retryInbox` call,
 * whose own `attempt >= MAX_DELIVERY_ATTEMPTS` check then dead-letters it.
 */
function deadLetteredInboxFixture(db: YoinkDatabase, messageKey: string, now: number): string {
  const delivery = new HostedDeliveryRepository(db);
  return runWithRequestScope(LOCAL_REQUEST_SCOPE, () => {
    const accepted = delivery.acceptInbox({
      source: "trackalacker",
      messageKey,
      eventType: SIGNAL_INGRESS_EVENT_TYPE,
      payload: { parserVersion: "trackalacker-push-v1" }
    }, now);
    const lease = delivery.leaseInboxByEventType(SIGNAL_INGRESS_EVENT_TYPE, 60, now + 1);
    assert.ok(lease);
    assert.equal(lease.id, accepted.id);
    db.run("UPDATE inbox_messages SET delivery_attempts = 20 WHERE id = ?", accepted.id);
    const disposition = delivery.retryInbox(lease.id, lease.capabilityToken, "poison_fixture", 1, now + 2);
    assert.equal(disposition, "dead_letter");
    assert.equal(
      db.get<{ state: string }>("SELECT state FROM inbox_messages WHERE id = ?", accepted.id)?.state,
      "dead_letter"
    );
    return accepted.id;
  });
}

test("the dead-letter reset writer is deterministic, chains onto job-lifecycle-apply in full, and is inactive", () => {
  const manifest = buildPostgresSignalDeadLetterResetApplyManifest();
  assert.deepEqual(buildPostgresSignalDeadLetterResetApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.jobLifecycleApplyContractVersion, POSTGRES_SIGNAL_JOB_LIFECYCLE_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.deadLetterResetRole.kind, "signal_dead_letter_reset_apply_boundary");
  assert.equal(manifest.deadLetterResetRole.functionName, POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_FUNCTION);
  assert.equal(manifest.deadLetterResetRole.login, false);
  assert.equal(manifest.deadLetterResetRole.inherit, false);
  assert.equal(manifest.deadLetterResetRole.bypassRls, false);
  assert.equal(manifest.deadLetterResetRole.directTableAccess, false);
  assert.deepEqual(manifest.deadLetterResetRole.protectedTenantTableNames, [
    "audit_events", "hosted_delivery_receipts", "inbox_messages", "outbox_events"
  ]);
  assert.deepEqual(manifest.deadLetterResetRole.mutationTableNames, [
    "audit_events", "hosted_delivery_receipts", "inbox_messages", "outbox_events"
  ]);
  assert.equal(manifest.operationCount, 1);
  assert.equal(manifest.hardcodedEventType, "signal_event_v1");
  assert.equal(manifest.hardcodedEventType, POSTGRES_SIGNAL_DEAD_LETTER_RESET_EVENT_TYPE);
  assert.equal(manifest.hardcodedEventType, SIGNAL_INGRESS_EVENT_TYPE);
  assert.equal(manifest.protectedTenantTableCount, 4);
  assert.equal(manifest.forcedRlsTableCount, 4);
  assert.equal(manifest.mutationTableCount, 4);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);

  // Chains onto job-lifecycle-apply's manifest as the FULL object -- not a
  // `Pick` -- so this equals the freshly-built job-lifecycle-apply manifest
  // byte-for-byte, and every one of ITS OWN predecessor fields (down to
  // attribution-policy-apply) is mechanically reachable from here too.
  const jobLifecycleManifest = buildPostgresSignalJobLifecycleApplyManifest();
  assert.deepEqual(manifest.predecessorManifest, jobLifecycleManifest);
  assert.equal(manifest.jobLifecycleApplyManifestFingerprint, jobLifecycleManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.fingerprint, jobLifecycleManifest.fingerprint);
  assert.equal(manifest.predecessorManifest.jobLifecycleRoleNamespace, jobLifecycleManifest.jobLifecycleRoleNamespace);
  assert.equal(
    manifest.predecessorManifest.predecessorManifest.attributionPolicyRoleNamespace,
    jobLifecycleManifest.predecessorManifest.attributionPolicyRoleNamespace
  );
  assert.notEqual(manifest.deadLetterResetRoleNamespace, jobLifecycleManifest.jobLifecycleRoleNamespace);

  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.workerManagePermissionRevalidated, false);
  assert.equal(manifest.inboxOwnershipRevalidated, true);
  assert.equal(manifest.deadLetterStatePreconditionEnforced, true);
  assert.equal(manifest.repeatedResetAfterReDeadLetterAllowed, true);
  assert.equal(manifest.deterministicRequestIdentity, true);
  assert.equal(manifest.auditedReplayGraphIdempotency, true);
  assert.equal(manifest.atomicInboxReceiptAuditOutboxMutation, true);
  assert.equal(manifest.databaseOwnedTimestamps, true);
  assert.equal(manifest.deterministicReceiptIdentity, true);
  assert.equal(manifest.writerLockProtocolConsumed, false);

  // World-state carried forward unchanged from job-lifecycle-apply, plus
  // this boundary's own new closure. The ingress-composition-level flags
  // stay honestly false: only that composition module's own chain (or a
  // future rung binding this module into it) could ever flip them.
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
  assert.equal(manifest.jobLifecycleWriterParity, true);
  assert.equal(manifest.writerLockProtocolParity, false);
  assert.equal(manifest.deadLetterResetWriterParity, true);
  assert.equal(manifest.signalIngressRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.allHandlerRepositoryParity, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalDeadLetterResetApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /reset_dead_letter_inbox/);
  assert.match(source, /DEAD_LETTER_RESET_V1/);
  assert.match(source, /jsonb_object_keys\(request_payload\)\) <> 3/);
  assert.match(source, /'signal_event_v1'/);
  assert.match(source, /FOR UPDATE OF inbox/);
  assert.match(source, /state = 'dead_letter'/);
  assert.match(source, /state = 'accepted', delivery_attempts = 0/);
  assert.match(source, /hosted_delivery_receipt_v1/);
  assert.match(source, /'inbox'::text/);
  assert.match(source, /'retry'::text/);
  assert.match(source, /'operator_retry'/);
  assert.match(source, /signal_inbox_retried/);
  assert.match(source, /'hosted_inbox'/);
  assert.match(source, /UPDATE .*"inbox_messages"/s);
  assert.match(source, /INSERT INTO .*"hosted_delivery_receipts"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.match(source, /\[\[:cntrl:\]\]/);
  // Audited-replay-graph idempotency, matching job-lifecycle-apply's own
  // pattern -- never SQLite's own `data: { inboxMessageId, eventType }`
  // shape.
  assert.match(source, /already_applied/);
  assert.match(source, /'request', request_payload, 'result', result_value/);
  // Never touches any other domain table, and never calls the shared
  // writer-lock protocol function or the background_task* queue-write
  // family -- both genuinely out of this boundary's scope (module header
  // §1/§4).
  assert.doesNotMatch(source, /background_task/);
  assert.doesNotMatch(source, /yoink_lock_signal_action_constraints/);
  assert.doesNotMatch(source, /"action_jobs"/);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\.(?!"inbox_messages"|"hosted_delivery_receipts"|"audit_events"|"outbox_events")/
  );

  const payload = normalizedPostgresSignalDeadLetterResetPayload({
    inboxMessageId: "inbox_00000000000000000000000000000001",
    correlationId: "request_dead_letter_reset_test_1"
  });
  assert.equal(payload.confirmation, POSTGRES_SIGNAL_DEAD_LETTER_RESET_APPLY_CONFIRMATION);
  const requestId = buildPostgresSignalDeadLetterResetRequestId(principal, payload);
  assert.match(requestId, /^dead_letter_reset_[a-f0-9]{32}$/);
  assert.equal(buildPostgresSignalDeadLetterResetRequestId(principal, payload), requestId);
  assert.notEqual(
    buildPostgresSignalDeadLetterResetRequestId({ ...principal, userId: "user_other" }, payload),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalDeadLetterResetRequestId({ ...principal, tenantId: "tenant_other" }, payload),
    requestId
  );
  assert.notEqual(
    buildPostgresSignalDeadLetterResetRequestId(
      principal,
      normalizedPostgresSignalDeadLetterResetPayload({
        inboxMessageId: "inbox_00000000000000000000000000000001",
        correlationId: "request_dead_letter_reset_test_2"
      })
    ),
    requestId
  );

  const capability = postgresSignalDeadLetterResetCapabilityProjection();
  assert.deepEqual(capability, postgresSignalDeadLetterResetCapabilityProjection());
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.writerLockProtocolConsumed, false);
  assert.equal(capability.deadLetterResetWriterParity, true);
  assert.equal(capability.signalIngressRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.allHandlerRepositoryParity, false);
  assert.equal(capability.jobLifecycleWriterParity, true);
  assert.equal(capability.protectedTenantTableCount, 4);
  assert.equal(capability.mutationTableCount, 4);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activePrincipalCount, 0);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalDeadLetterResetApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.jobLifecycleRoleNamespace
    ),
    /independent/
  );
  assert.throws(
    () => buildPostgresSignalDeadLetterResetApplyManifest(
      manifest.predecessorManifest as never,
      manifest.predecessorManifest.predecessorManifest.attributionPolicyRoleNamespace
    ),
    /independent/
  );
});

test("the dead-letter reset payload normalizer rejects malformed input and mirrors deliveryIdentifier/cleanText bounds", () => {
  assert.throws(
    () => normalizedPostgresSignalDeadLetterResetPayload({ inboxMessageId: "", correlationId: "request_1" }),
    PostgresSignalDeadLetterResetApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalDeadLetterResetPayload({ inboxMessageId: "ab", correlationId: "request_1" }),
    PostgresSignalDeadLetterResetApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalDeadLetterResetPayload({
      inboxMessageId: "inbox message id with spaces",
      correlationId: "request_1"
    }),
    PostgresSignalDeadLetterResetApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalDeadLetterResetPayload({
      inboxMessageId: "inbox_valid_id_123",
      correlationId: ""
    }),
    PostgresSignalDeadLetterResetApplyQualificationError
  );
  assert.throws(
    () => normalizedPostgresSignalDeadLetterResetPayload({
      inboxMessageId: "inbox_valid_id_123",
      correlationId: "   "
    }),
    PostgresSignalDeadLetterResetApplyQualificationError
  );
  // `cleanText`'s exact semantics: control characters stripped, runs of
  // whitespace collapsed to one space, trimmed -- not rejected outright.
  const collapsed = normalizedPostgresSignalDeadLetterResetPayload({
    inboxMessageId: "inbox_valid_id_123",
    correlationId: "  spaced   \t out  correlation  "
  });
  assert.equal(collapsed.correlationId, "spaced out correlation");
});

test(
  "the dead-letter reset request id + receipt hash derivation mirrors HostedDeliveryRepository.retryDeadLetterInbox byte-for-byte (SQLite cross-check)",
  () => {
    const db = new YoinkDatabase();
    try {
      const inboxId = deadLetteredInboxFixture(db, "dead-letter-reset-fixture-1", NOW);
      const delivery = new HostedDeliveryRepository(db);
      const correlationId = "request_dead_letter_reset_cross_check";
      const resetAt = NOW + 3;

      const deadLetter = runWithRequestScope(
        LOCAL_REQUEST_SCOPE,
        () => delivery.retryDeadLetterInbox(inboxId, SIGNAL_INGRESS_EVENT_TYPE, correlationId, resetAt)
      );
      assert.equal(deadLetter.id, inboxId);
      assert.equal(deadLetter.eventType, SIGNAL_INGRESS_EVENT_TYPE);
      assert.equal(deadLetter.attempt, 0);
      assert.equal(deadLetter.lastErrorCode, "");
      assert.equal(deadLetter.privacyClassification, "operational_aggregate");
      assert.equal(deadLetter.updatedAt, nowIso(resetAt));

      const row = db.get<{
        state: string;
        deliveryAttempts: number;
        leaseCapabilityHash: string;
        leaseExpiresAt: string;
        nextAttemptAt: string;
        lastErrorCode: string;
        processedAt: string;
        updatedAt: string;
        receivedAt: string;
      }>(
        `SELECT state, delivery_attempts AS deliveryAttempts, lease_capability_hash AS leaseCapabilityHash,
                lease_expires_at AS leaseExpiresAt, next_attempt_at AS nextAttemptAt,
                last_error_code AS lastErrorCode, processed_at AS processedAt,
                updated_at AS updatedAt, received_at AS receivedAt
         FROM inbox_messages WHERE id = ?`,
        inboxId
      );
      assert.ok(row);
      assert.equal(row?.state, "accepted");
      assert.equal(row?.deliveryAttempts, 0);
      assert.equal(row?.leaseCapabilityHash, "");
      assert.equal(row?.leaseExpiresAt, "");
      assert.equal(row?.nextAttemptAt, "");
      assert.equal(row?.lastErrorCode, "");
      assert.equal(row?.processedAt, "");
      assert.equal(row?.updatedAt, nowIso(resetAt));
      assert.equal(deadLetter.receivedAt, row?.receivedAt);

      // Exactly one FRESH receipt row for this operator-retry event.
      const receipt = db.get<{
        direction: string;
        messageId: string;
        disposition: string;
        attempt: number;
        reasonCode: string;
        receiptHash: string;
        createdAt: string;
      }>(
        `SELECT direction, message_id AS messageId, disposition, attempt,
                reason_code AS reasonCode, receipt_hash AS receiptHash, created_at AS createdAt
         FROM hosted_delivery_receipts
         WHERE message_id = ? AND disposition = 'retry' AND reason_code = 'operator_retry'`,
        inboxId
      );
      assert.ok(receipt);
      assert.equal(receipt?.direction, "inbox");
      assert.equal(receipt?.attempt, 0);
      assert.equal(receipt?.createdAt, nowIso(resetAt));
      // The receipt_hash this boundary derives in PL/pgSQL must reproduce
      // the REAL `stableHash` call byte-for-byte, executed here against the
      // real SQLite repository, not merely re-derived in TypeScript again.
      const expectedReceiptHash = stableHash(
        "hosted_delivery_receipt_v1",
        LOCAL_TENANT_ID,
        LOCAL_USER_ID,
        "inbox",
        inboxId,
        "retry",
        0,
        "operator_retry",
        nowIso(resetAt)
      );
      assert.equal(receipt?.receiptHash, expectedReceiptHash);
      assert.match(expectedReceiptHash, /^[a-f0-9]{64}$/);

      const audit = db.get<{
        correlationId: string;
        eventType: string;
        reasonCode: string;
        message: string;
        dataJson: string;
      }>(
        `SELECT correlation_id AS correlationId, event_type AS eventType,
                reason_code AS reasonCode, message, data_json AS dataJson
         FROM audit_events WHERE event_type = 'signal_inbox_retried' AND correlation_id = ?`,
        correlationId
      );
      assert.ok(audit);
      assert.equal(audit?.eventType, "signal_inbox_retried");
      assert.equal(audit?.reasonCode, "operator_retry");
      assert.equal(audit?.message, "A dead-lettered signal message was reset for bounded worker evaluation.");
      assert.deepEqual(JSON.parse(audit?.dataJson ?? "{}"), {
        inboxMessageId: inboxId,
        eventType: SIGNAL_INGRESS_EVENT_TYPE
      });

      const outbox = db.get<{
        aggregateType: string;
        aggregateId: string;
        eventType: string;
        payloadJson: string;
      }>(
        `SELECT aggregate_type AS aggregateType, aggregate_id AS aggregateId,
                event_type AS eventType, payload_json AS payloadJson
         FROM outbox_events WHERE event_type = 'signal_inbox_retried' AND aggregate_id = ?`,
        correlationId
      );
      assert.ok(outbox);
      assert.equal(outbox?.aggregateType, "hosted_inbox");
      assert.equal(outbox?.aggregateId, correlationId);
      const outboxPayload = JSON.parse(outbox?.payloadJson ?? "{}") as Record<string, unknown>;
      assert.equal(outboxPayload.correlationId, correlationId);
      assert.equal(outboxPayload.reasonCode, "operator_retry");

      // This boundary's own request-id/payload normalizer, cross-checked
      // against the identical real (id, correlationId) pair.
      const payload = normalizedPostgresSignalDeadLetterResetPayload({
        inboxMessageId: inboxId,
        correlationId
      });
      const requestId = buildPostgresSignalDeadLetterResetRequestId(principal, payload);
      assert.match(requestId, /^dead_letter_reset_[a-f0-9]{32}$/);

      // A NOT FOUND state conflict on replay -- the row already moved to
      // 'accepted' -- matches the real SQLite 409, mirrored here by
      // `HostedDeliveryError`.
      assert.throws(
        () => runWithRequestScope(
          LOCAL_REQUEST_SCOPE,
          () => delivery.retryDeadLetterInbox(inboxId, SIGNAL_INGRESS_EVENT_TYPE, correlationId, resetAt + 1)
        ),
        /Only a dead-lettered signal inbox message can be retried\./
      );

      // A message that legitimately cycles back through dead_letter a
      // second time can be reset again -- `repeatedResetAfterReDeadLetterAllowed`.
      const release = runWithRequestScope(
        LOCAL_REQUEST_SCOPE,
        () => delivery.leaseInboxByEventType(SIGNAL_INGRESS_EVENT_TYPE, 60, resetAt + 2)
      );
      assert.ok(release);
      db.run("UPDATE inbox_messages SET delivery_attempts = 20 WHERE id = ?", inboxId);
      const redisposition = runWithRequestScope(
        LOCAL_REQUEST_SCOPE,
        () => delivery.retryInbox(release.id, release.capabilityToken, "poison_fixture_2", 1, resetAt + 3)
      );
      assert.equal(redisposition, "dead_letter");
      const secondCorrelationId = "request_dead_letter_reset_cross_check_2";
      const secondReset = runWithRequestScope(
        LOCAL_REQUEST_SCOPE,
        () => delivery.retryDeadLetterInbox(inboxId, SIGNAL_INGRESS_EVENT_TYPE, secondCorrelationId, resetAt + 4)
      );
      assert.equal(secondReset.id, inboxId);
      const secondRequestId = buildPostgresSignalDeadLetterResetRequestId(
        principal,
        normalizedPostgresSignalDeadLetterResetPayload({ inboxMessageId: inboxId, correlationId: secondCorrelationId })
      );
      assert.notEqual(secondRequestId, requestId);
      assert.equal(
        db.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM hosted_delivery_receipts WHERE message_id = ? AND disposition = 'retry'",
          inboxId
        )?.count,
        2
      );
      assert.equal(
        db.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'signal_inbox_retried'"
        )?.count,
        2
      );

      db.assertIntegrity();
    } finally {
      db.close();
    }
  }
);

test("the generated dead-letter reset PL/pgSQL parses before native qualification", async () => {
  const database = new PGlite();
  try {
    await database.exec("SET search_path TO pg_catalog");
    const source = signalDeadLetterResetApplyFunctionSource(
      buildPostgresSignalDeadLetterResetApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_dead_letter_reset_apply_parse_probe(
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
