import assert from "node:assert/strict";
import {
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PostgresBackgroundWorkerQualificationStore } from "../packages/database/src/postgres-background-worker-store.js";
import {
  POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION,
  applyPostgresRuntimeReadRoles,
  buildPostgresRuntimeReadRoleManifest,
  postgresRuntimeReadRoleCapabilityProjection,
  verifyPostgresRuntimeReadRoles
} from "../packages/database/src/postgres-runtime-roles.js";
import {
  NodePostgresCutoverDatabase,
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  importPostgresCutoverArchive,
  inspectPostgresCutoverPreflight,
  loadPostgresCutoverConnectionConfig,
  verifyPostgresCutoverArchive,
  type PostgresCutoverDatabase,
  type PostgresQueryResult,
  type PostgresQuerySession
} from "../packages/database/src/postgres-cutover.js";
import {
  POSTGRES_ADAPTER_PACK_VERSION_TABLES,
  POSTGRES_SCHEMA_MANIFEST_CONTRACT_VERSION,
  buildPostgresSchemaManifest
} from "../packages/database/src/postgres-schema-manifest.js";
import {
  POSTGRES_TENANT_SESSION_CONTRACT_VERSION,
  buildPostgresTenantSessionManifest,
  postgresTenantSessionCapabilityProjection
} from "../packages/database/src/postgres-tenant-session.js";
import {
  POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION,
  buildPostgresTenantQueueWriteManifest,
  postgresTenantQueueWriteCapabilityProjection
} from "../packages/database/src/postgres-tenant-queue-writes.js";
import {
  POSTGRES_WORKER_CONTROL_CONTRACT_VERSION,
  buildPostgresWorkerControlManifest,
  postgresWorkerControlCapabilityProjection
} from "../packages/database/src/postgres-worker-control.js";
import {
  POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION,
  POSTGRES_NOTIFICATION_RECOVERY_FUNCTION,
  buildPostgresNotificationRecoveryManifest,
  postgresNotificationRecoveryCapabilityProjection
} from "../packages/database/src/postgres-notification-recovery.js";
import {
  POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION,
  POSTGRES_EXECUTION_RECOVERY_FUNCTION,
  buildPostgresExecutionRecoveryManifest,
  postgresExecutionRecoveryCapabilityProjection
} from "../packages/database/src/postgres-execution-recovery.js";
import {
  POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION,
  POSTGRES_OPERATIONAL_RETENTION_FUNCTION,
  buildPostgresOperationalRetentionManifest,
  postgresOperationalRetentionCapabilityProjection
} from "../packages/database/src/postgres-operational-retention.js";
import {
  POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION,
  POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION,
  buildPostgresObserverCandidateEvaluationManifest,
  postgresObserverCandidateEvaluationCapabilityProjection
} from "../packages/database/src/postgres-observer-repair-candidate-evaluation.js";
import {
  POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION,
  POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_FUNCTION,
  buildPostgresOperatorAlertConnectorDispatchManifest,
  operatorAlertDispatchFunctionSource,
  postgresOperatorAlertConnectorDispatchCapabilityProjection
} from "../packages/database/src/postgres-operator-alert-connector-dispatch.js";
import {
  POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION,
  POSTGRES_OPERATOR_ALERT_RECONCILIATION_FUNCTION,
  buildPostgresOperatorAlertReconciliationManifest,
  operatorAlertReconciliationFunctionSource,
  postgresOperatorAlertReconciliationCapabilityProjection
} from "../packages/database/src/postgres-operator-alert-reconciliation.js";
import {
  POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION,
  POSTGRES_OBSERVER_WITNESS_REFRESH_FUNCTION,
  buildPostgresObserverWitnessRefreshManifest,
  observerWitnessRefreshFunctionSource,
  postgresObserverWitnessRefreshCapabilityProjection
} from "../packages/database/src/postgres-observer-witness-refresh.js";
import {
  POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION,
  POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION,
  POSTGRES_HOSTED_SIGNAL_INBOX_FUNCTION,
  POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION,
  buildPostgresHostedDeliveryLeaseRecoveryManifest,
  hostedDeliveryLeaseRecoveryFunctionSource,
  hostedSignalInboxFunctionSource,
  hostedSignalResolutionPlanFunctionSource,
  postgresHostedDeliveryLeaseRecoveryCapabilityProjection
} from "../packages/database/src/postgres-hosted-delivery-lease-recovery.js";
import {
  POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION,
  buildPostgresSignalCatalogApplyManifest,
  postgresSignalCatalogApplyCapabilityProjection,
  signalCatalogApplyFunctionSource
} from "../packages/database/src/postgres-signal-catalog-apply.js";
import {
  POSTGRES_TEST_WORKER_FINGERPRINT as WORKER_FINGERPRINT,
  POSTGRES_TEST_WORKER_VERSION as WORKER_VERSION,
  createPostgresCutoverFixture
} from "./support/postgres-cutover-fixture.js";

const WORKER_NOW = new Date("2026-08-25T15:00:00.000Z").getTime();

class PgliteCutoverDatabase implements PostgresCutoverDatabase {
  constructor(readonly connection = new PGlite()) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<PostgresQueryResult<T>> {
    return this.connection.query<T>(sql, [...parameters]);
  }

  async transaction<T>(operation: (session: PostgresQuerySession) => Promise<T>): Promise<T> {
    return this.connection.transaction(async (transaction) => operation({
      query: async <R extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = []
      ): Promise<PostgresQueryResult<R>> => transaction.query<R>(sql, [...parameters])
    }));
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}

test("the PostgreSQL cutover manifest covers every current invariant family deterministically", () => {
  const first = buildPostgresSchemaManifest();
  const second = buildPostgresSchemaManifest();
  assert.deepEqual(second, first);
  const firstTableName = first.tables[0]?.name;
  assert.ok(firstTableName);
  second.tables[0]!.name = "caller_local_tamper";
  assert.equal(buildPostgresSchemaManifest().tables[0]?.name, firstTableName);
  assert.equal(first.contractVersion, POSTGRES_SCHEMA_MANIFEST_CONTRACT_VERSION);
  assert.equal(first.tableCount, 111);
  assert.equal(first.foreignKeyCount, 296);
  assert.equal(first.indexCount, 219);
  assert.equal(first.defaultExpressionCount, 360);
  assert.equal(first.checkConstraintCount, 410);
  assert.equal(first.triggerCount, 50);
  assert.equal(first.directTenantTableCount, 85);
  assert.equal(first.inheritedTenantPathTableCount, 14);
  assert.equal(first.noTenantPathTableCount, 12);
  assert.equal(first.inheritedTenantTableCount, 13);
  assert.equal(first.mixedTenantTableCount, 1);
  assert.equal(first.sharedCatalogTableCount, 6);
  assert.equal(first.authorizationCatalogTableCount, 3);
  assert.equal(first.deploymentControlTableCount, 2);
  assert.equal(first.tenantRegistryTableCount, 1);
  assert.equal(first.unresolvedTenantTableCount, 0);
  assert.equal(first.tables.filter((table) => table.tenantScopeKind === "direct").length, 85);
  assert.equal(first.tables.reduce((count, table) => count + table.tenantOwnershipEdges.length, 0), 20);
  assert.equal(first.tables.find((table) => table.name === "signal_incidents")?.tenantScopeKind, "direct");
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(first.tables.every((table) => table.name !== "schema_migrations"));
  assert.ok(first.tables.every((table) => table.indexes.every((index) => Buffer.byteLength(index.name) <= 63)));

  const readRoles = buildPostgresRuntimeReadRoleManifest("yoink_cutover_test", "yoink_q_test");
  assert.deepEqual(buildPostgresRuntimeReadRoleManifest("yoink_cutover_test", "yoink_q_test"), readRoles);
  assert.equal(readRoles.contractVersion, POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION);
  assert.equal(readRoles.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(readRoles.roleCount, 5);
  assert.equal(readRoles.grantedTableCount, 111);
  assert.equal(readRoles.unresolvedTableCount, 0);
  assert.deepEqual(readRoles.unresolvedTables, []);
  assert.equal(readRoles.roles.find((role) => role.kind === "tenant_reader")?.tableNames.length, 99);
  assert.equal(readRoles.roles.find((role) => role.kind === "shared_catalog_reader")?.tableNames.length, 6);
  assert.equal(readRoles.roles.find((role) => role.kind === "authorization_catalog_reader")?.tableNames.length, 3);
  assert.equal(readRoles.roles.find((role) => role.kind === "deployment_control_reader")?.tableNames.length, 2);
  assert.equal(readRoles.roles.find((role) => role.kind === "tenant_registry_reader")?.tableNames.length, 1);
  assert.ok(readRoles.roles.every((role) => role.login === false
    && role.inherit === false
    && role.bypassRls === false
    && role.writeAccess === false
    && role.privileges.join(",") === "SELECT"));
  assert.match(readRoles.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(postgresRuntimeReadRoleCapabilityProjection(), {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactGrantVerificationImplemented: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    readOnly: true,
    roleCount: 5,
    grantedTableCount: 111,
    tenantRlsTableCount: 99,
    sharedCatalogTableCount: 6,
    authorizationCatalogTableCount: 3,
    deploymentControlTableCount: 2,
    tenantRegistryTableCount: 1,
    unresolvedTableCount: 0,
    unresolvedTables: [],
    mixedSharedOfferAccess: false,
    runtimeWriteRoleParity: false,
    activeRuntimeRolesApplied: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: buildPostgresRuntimeReadRoleManifest().fingerprint
  });
  assert.throws(
    () => buildPostgresRuntimeReadRoleManifest("yoink_cutover_test", "Unsafe-Role"),
    /role namespace/
  );
});

test("the PostgreSQL tenant-session template is deterministic, inactive, and restrictive", () => {
  const manifest = buildPostgresTenantSessionManifest(
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test"
  );
  assert.deepEqual(
    buildPostgresTenantSessionManifest("yoink_cutover_test", "yoink_q_test", "yoink_session_test"),
    manifest
  );
  assert.equal(manifest.contractVersion, POSTGRES_TENANT_SESSION_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(manifest.tenantRlsTableCount, 99);
  assert.equal(manifest.restrictivePolicyCount, 99);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.equal(manifest.sessionRole.login, false);
  assert.equal(manifest.sessionRole.inherit, false);
  assert.equal(manifest.sessionRole.bypassRls, false);
  assert.equal(manifest.sessionRole.writeAccess, false);
  assert.equal(manifest.sessionRole.directParameterSetPrevented, false);
  assert.equal(manifest.sessionRole.directParameterScopeExpansionPrevented, true);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  const capability = postgresTenantSessionCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_TENANT_SESSION_CONTRACT_VERSION);
  assert.equal(capability.serverBoundRestrictivePolicies, true);
  assert.equal(capability.directParameterSetPrevented, false);
  assert.equal(capability.directParameterScopeExpansionPrevented, true);
  assert.equal(capability.nativeTwoPrincipalIsolationQualified, true);
  assert.equal(capability.tenantRlsTableCount, 99);
  assert.equal(capability.activePrincipalCount, 0);
  assert.equal(capability.principalProvisioningImplemented, false);
  assert.equal(capability.runtimeWriteRoleParity, false);
  assert.equal(capability.productionIdentityQualified, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresTenantSessionManifest("yoink_cutover_test", "same_namespace", "same_namespace"),
    /must differ/
  );
});

test("the PostgreSQL tenant queue-write template is exact, inert, and delete-free", () => {
  const manifest = buildPostgresTenantQueueWriteManifest(
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test"
  );
  assert.deepEqual(
    buildPostgresTenantQueueWriteManifest(
      "yoink_cutover_test",
      "yoink_q_test",
      "yoink_session_test",
      "yoink_queue_write_test"
    ),
    manifest
  );
  assert.equal(manifest.contractVersion, POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(manifest.tenantSessionContractVersion, POSTGRES_TENANT_SESSION_CONTRACT_VERSION);
  assert.equal(manifest.tableCount, 5);
  assert.equal(manifest.grantCount, 12);
  assert.equal(manifest.functionGrantCount, 3);
  assert.equal(manifest.constraintHelperFunctionCount, 1);
  assert.equal(manifest.restrictivePolicyCount, 4);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.handlerRepositoryParity, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.equal(manifest.writeRole.login, false);
  assert.equal(manifest.writeRole.inherit, false);
  assert.equal(manifest.writeRole.bypassRls, false);
  assert.equal(manifest.writeRole.deleteAccess, false);
  assert.deepEqual(manifest.writeRole.tableGrants, [
    { tableName: "background_task_schedules", privileges: ["SELECT", "INSERT", "UPDATE"] },
    { tableName: "background_tasks", privileges: ["SELECT", "INSERT", "UPDATE"] },
    { tableName: "background_task_events", privileges: ["SELECT", "INSERT"] },
    { tableName: "background_worker_heartbeats", privileges: ["SELECT", "INSERT", "UPDATE"] },
    { tableName: "background_worker_deployment_expectations", privileges: ["SELECT"] }
  ]);
  assert.deepEqual(manifest.writeRole.functionGrants, [{
    functionName: "yoink_json_valid",
    argumentTypes: ["text"],
    purpose: "immutable_json_constraint_helper"
  }]);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  const capability = postgresTenantQueueWriteCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.immutableBoundaryCatalogFingerprint, true);
  assert.equal(capability.serverBoundRestrictivePolicies, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.nativeTwoPrincipalWriteIsolationQualified, true);
  assert.equal(capability.queueStoreRepositoryParity, true);
  assert.equal(capability.atomicDeploymentAttestationAndQueueWrite, true);
  assert.equal(capability.controlRepositoryParity, false);
  assert.equal(capability.tableCount, 5);
  assert.equal(capability.grantCount, 12);
  assert.equal(capability.functionGrantCount, 3);
  assert.equal(capability.constraintHelperFunctionCount, 1);
  assert.equal(capability.insertTableCount, 4);
  assert.equal(capability.updateTableCount, 3);
  assert.equal(capability.deleteTableCount, 0);
  assert.equal(capability.principalProvisioningImplemented, false);
  assert.equal(capability.handlerRepositoryParity, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresTenantQueueWriteManifest(
      "yoink_cutover_test",
      "same_namespace",
      "same_namespace",
      "queue_namespace"
    ),
    /must be distinct/
  );
});

test("the PostgreSQL worker-control template is exact, inert, and fleet-bounded", () => {
  const manifest = buildPostgresWorkerControlManifest(
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test"
  );
  assert.deepEqual(
    buildPostgresWorkerControlManifest(
      "yoink_cutover_test",
      "yoink_q_test",
      "yoink_session_test",
      "yoink_queue_write_test",
      "yoink_worker_control_test"
    ),
    manifest
  );
  assert.equal(manifest.contractVersion, POSTGRES_WORKER_CONTROL_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(manifest.queueWriteContractVersion, POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION);
  assert.equal(manifest.tableCount, 3);
  assert.equal(manifest.grantCount, 19);
  assert.equal(manifest.permissivePolicyCount, 3);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.controlRole.login, false);
  assert.equal(manifest.controlRole.inherit, false);
  assert.equal(manifest.controlRole.bypassRls, false);
  assert.equal(manifest.controlRole.insertAccess, false);
  assert.equal(manifest.controlRole.deleteAccess, false);
  assert.deepEqual(manifest.controlRole.tableGrants, [
    {
      tableName: "users",
      selectColumns: ["tenant_id", "id"],
      updateColumns: []
    },
    {
      tableName: "background_worker_deployment_expectations",
      selectColumns: ["id", "contract_version", "desired_mode", "runtime_version", "deployment_fingerprint"],
      updateColumns: []
    },
    {
      tableName: "background_worker_heartbeats",
      selectColumns: [
        "tenant_id",
        "subject_user_id",
        "worker_id",
        "runtime_kind",
        "state",
        "heartbeat_at",
        "last_error_code",
        "deployment_fingerprint"
      ],
      updateColumns: ["state", "heartbeat_at", "stopped_at", "last_error_code"]
    }
  ]);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  const capability = postgresWorkerControlCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_WORKER_CONTROL_CONTRACT_VERSION);
  assert.equal(capability.queueWriteContractVersion, POSTGRES_TENANT_QUEUE_WRITE_CONTRACT_VERSION);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.immutableBoundaryCatalogFingerprint, true);
  assert.equal(capability.controlRepositoryParity, true);
  assert.equal(capability.principalEnumeration, true);
  assert.equal(capability.deploymentStatus, true);
  assert.equal(capability.workerStopping, true);
  assert.equal(capability.tableCount, 3);
  assert.equal(capability.grantCount, 19);
  assert.equal(capability.permissivePolicyCount, 3);
  assert.equal(capability.insertTableCount, 0);
  assert.equal(capability.updateTableCount, 1);
  assert.equal(capability.deleteTableCount, 0);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresWorkerControlManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "same_namespace"
    ),
    /must be distinct/
  );
});

test("the PostgreSQL notification-recovery handler template is deterministic, server bound, and inert", () => {
  const manifest = buildPostgresNotificationRecoveryManifest(
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test"
  );
  assert.deepEqual(
    buildPostgresNotificationRecoveryManifest(
      "yoink_cutover_test",
      "yoink_q_test",
      "yoink_session_test",
      "yoink_queue_write_test",
      "yoink_worker_control_test",
      "yoink_notify_test"
    ),
    manifest
  );
  assert.equal(manifest.contractVersion, POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(manifest.workerControlContractVersion, POSTGRES_WORKER_CONTROL_CONTRACT_VERSION);
  assert.equal(manifest.recoveryRole.functionName, POSTGRES_NOTIFICATION_RECOVERY_FUNCTION);
  assert.deepEqual(manifest.recoveryRole.functionArgumentTypes, [
    "text",
    "text"
  ]);
  assert.deepEqual(manifest.recoveryRole.protectedTableNames, [
    "action_jobs",
    "notification_deliveries"
  ]);
  assert.deepEqual(manifest.handlerTaskKinds, ["notification_recovery"]);
  assert.equal(manifest.protectedTableCount, 2);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.handlerTaskKindCount, 1);
  assert.equal(manifest.totalHandlerTaskKindCount, 7);
  assert.equal(manifest.notificationRecoveryRepositoryParity, true);
  assert.equal(manifest.serverClockBoundRecovery, true);
  assert.equal(manifest.fullHandlerRepositoryParity, false);
  assert.equal(manifest.recoveryRole.login, false);
  assert.equal(manifest.recoveryRole.inherit, false);
  assert.equal(manifest.recoveryRole.bypassRls, false);
  assert.equal(manifest.recoveryRole.directTableAccess, false);
  assert.equal(manifest.recoveryRole.insertAccess, false);
  assert.equal(manifest.recoveryRole.deleteAccess, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  const capability = postgresNotificationRecoveryCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION);
  assert.equal(capability.workerControlContractVersion, POSTGRES_WORKER_CONTROL_CONTRACT_VERSION);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.serverBoundPrincipalLookup, true);
  assert.equal(capability.serverClockBoundRecovery, true);
  assert.equal(capability.notificationRecoveryRepositoryParity, true);
  assert.equal(capability.fullHandlerRepositoryParity, false);
  assert.equal(capability.handlerTaskKindCount, 1);
  assert.equal(capability.totalHandlerTaskKindCount, 7);
  assert.equal(capability.protectedTableCount, 2);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresNotificationRecoveryManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "same_namespace"
    ),
    /must be distinct/
  );
});

test("the PostgreSQL execution-recovery handler template is cumulative, fail closed, and inert", () => {
  const manifest = buildPostgresExecutionRecoveryManifest(
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test",
    "yoink_execute_test"
  );
  assert.deepEqual(
    buildPostgresExecutionRecoveryManifest(
      "yoink_cutover_test",
      "yoink_q_test",
      "yoink_session_test",
      "yoink_queue_write_test",
      "yoink_worker_control_test",
      "yoink_notify_test",
      "yoink_execute_test"
    ),
    manifest
  );
  assert.equal(manifest.contractVersion, POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(
    manifest.notificationRecoveryContractVersion,
    POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION
  );
  assert.equal(manifest.executionRecoveryRole.functionName, POSTGRES_EXECUTION_RECOVERY_FUNCTION);
  assert.deepEqual(manifest.executionRecoveryRole.functionArgumentTypes, ["text", "text"]);
  assert.deepEqual(manifest.executionRecoveryRole.protectedTableNames, [
    "action_events",
    "action_jobs",
    "audit_events",
    "outbox_events",
    "signal_events",
    "signal_incidents",
    "signal_occurrences",
    "spend_ledger_entries",
    "spend_reservations"
  ]);
  assert.deepEqual(manifest.executionRecoveryRole.indirectScopeTableNames, []);
  assert.equal(manifest.protectedTableCount, 9);
  assert.equal(manifest.forcedRlsTableCount, 9);
  assert.equal(manifest.indirectScopeTableCount, 0);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.deepEqual(manifest.boundaryHandlerTaskKinds, ["execution_recovery"]);
  assert.deepEqual(manifest.qualifiedHandlerTaskKinds, [
    "notification_recovery",
    "execution_recovery"
  ]);
  assert.equal(manifest.boundaryHandlerTaskKindCount, 1);
  assert.equal(manifest.qualifiedHandlerTaskKindCount, 2);
  assert.equal(manifest.totalHandlerTaskKindCount, 7);
  assert.equal(manifest.executionRecoveryRepositoryParity, true);
  assert.equal(manifest.notificationRecoveryRepositoryParity, true);
  assert.equal(manifest.serverClockBoundRecovery, true);
  assert.equal(manifest.sharedIncidentMutationFailClosed, true);
  assert.equal(manifest.fullHandlerRepositoryParity, false);
  assert.equal(manifest.executionRecoveryRole.login, false);
  assert.equal(manifest.executionRecoveryRole.inherit, false);
  assert.equal(manifest.executionRecoveryRole.bypassRls, false);
  assert.equal(manifest.executionRecoveryRole.directTableAccess, false);
  assert.equal(manifest.executionRecoveryRole.insertAccess, false);
  assert.equal(manifest.executionRecoveryRole.deleteAccess, false);
  assert.match(manifest.notificationRecoveryManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  const capability = postgresExecutionRecoveryCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION);
  assert.equal(
    capability.notificationRecoveryContractVersion,
    POSTGRES_NOTIFICATION_RECOVERY_CONTRACT_VERSION
  );
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.serverBoundPrincipalLookup, true);
  assert.equal(capability.serverClockBoundRecovery, true);
  assert.equal(capability.sharedIncidentMutationFailClosed, true);
  assert.equal(capability.notificationRecoveryRepositoryParity, true);
  assert.equal(capability.executionRecoveryRepositoryParity, true);
  assert.equal(capability.fullHandlerRepositoryParity, false);
  assert.equal(capability.handlerTaskKindCount, 2);
  assert.equal(capability.totalHandlerTaskKindCount, 7);
  assert.equal(capability.protectedTableCount, 9);
  assert.equal(capability.forcedRlsTableCount, 9);
  assert.equal(capability.indirectScopeTableCount, 0);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresExecutionRecoveryManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "notify_namespace",
      "same_namespace"
    ),
    /must be distinct/
  );
});

test("the PostgreSQL operational-retention handler template is bounded, cumulative, and inert", () => {
  const manifest = buildPostgresOperationalRetentionManifest(
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test",
    "yoink_execute_test",
    "yoink_retention_test"
  );
  assert.deepEqual(
    buildPostgresOperationalRetentionManifest(
      "yoink_cutover_test",
      "yoink_q_test",
      "yoink_session_test",
      "yoink_queue_write_test",
      "yoink_worker_control_test",
      "yoink_notify_test",
      "yoink_execute_test",
      "yoink_retention_test"
    ),
    manifest
  );
  assert.equal(manifest.contractVersion, POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(
    manifest.executionRecoveryContractVersion,
    POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION
  );
  assert.equal(
    manifest.operationalRetentionRole.functionName,
    POSTGRES_OPERATIONAL_RETENTION_FUNCTION
  );
  assert.deepEqual(manifest.operationalRetentionRole.functionArgumentTypes, ["text", "text"]);
  assert.deepEqual(manifest.operationalRetentionRole.protectedTableNames, [
    "audit_events",
    "background_task_events",
    "background_tasks",
    "observer_recipe_recovery_evidence",
    "observer_recipe_recovery_retention_receipts",
    "observer_recipe_recovery_reviews",
    "operational_error_events",
    "operational_request_rollups",
    "operational_telemetry_retention_receipts",
    "outbox_events"
  ]);
  assert.deepEqual(manifest.boundaryHandlerTaskKinds, ["operational_telemetry_retention"]);
  assert.deepEqual(manifest.qualifiedHandlerTaskKinds, [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention"
  ]);
  assert.equal(manifest.protectedTableCount, 10);
  assert.equal(manifest.forcedRlsTableCount, 10);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.qualifiedHandlerTaskKindCount, 3);
  assert.equal(manifest.totalHandlerTaskKindCount, 7);
  assert.equal(manifest.operationalRetentionRepositoryParity, true);
  assert.equal(manifest.executionRecoveryRepositoryParity, true);
  assert.equal(manifest.notificationRecoveryRepositoryParity, true);
  assert.equal(manifest.serverClockBoundRetention, true);
  assert.equal(manifest.serverAuthenticatedReceiptActor, true);
  assert.equal(manifest.boundedEvidenceDeletionLimit, 500);
  assert.equal(manifest.fullHandlerRepositoryParity, false);
  assert.equal(manifest.operationalRetentionRole.login, false);
  assert.equal(manifest.operationalRetentionRole.inherit, false);
  assert.equal(manifest.operationalRetentionRole.bypassRls, false);
  assert.equal(manifest.operationalRetentionRole.directTableAccess, false);
  assert.equal(manifest.operationalRetentionRole.insertAccess, false);
  assert.equal(manifest.operationalRetentionRole.deleteAccess, false);
  assert.match(manifest.executionRecoveryManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  const capability = postgresOperationalRetentionCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION);
  assert.equal(
    capability.executionRecoveryContractVersion,
    POSTGRES_EXECUTION_RECOVERY_CONTRACT_VERSION
  );
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.serverBoundPrincipalLookup, true);
  assert.equal(capability.serverClockBoundRetention, true);
  assert.equal(capability.serverAuthenticatedReceiptActor, true);
  assert.equal(capability.boundedEvidenceDeletionLimit, 500);
  assert.equal(capability.operationalRetentionRepositoryParity, true);
  assert.equal(capability.handlerTaskKindCount, 3);
  assert.equal(capability.totalHandlerTaskKindCount, 7);
  assert.equal(capability.protectedTableCount, 10);
  assert.equal(capability.forcedRlsTableCount, 10);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresOperationalRetentionManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "notify_namespace",
      "execute_namespace",
      "same_namespace"
    ),
    /must be distinct/
  );
});

test("the PostgreSQL observer-candidate handler template is quarantined, cumulative, and inert", () => {
  const args = [
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test",
    "yoink_execute_test",
    "yoink_retention_test",
    "yoink_candidate_test"
  ] as const;
  const manifest = buildPostgresObserverCandidateEvaluationManifest(...args);
  assert.deepEqual(buildPostgresObserverCandidateEvaluationManifest(...args), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION
  );
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(
    manifest.operationalRetentionContractVersion,
    POSTGRES_OPERATIONAL_RETENTION_CONTRACT_VERSION
  );
  assert.equal(
    manifest.observerCandidateRole.functionName,
    POSTGRES_OBSERVER_CANDIDATE_EVALUATION_FUNCTION
  );
  assert.deepEqual(manifest.observerCandidateRole.functionArgumentTypes, [
    "text", "text", "text", "text", "text", "text"
  ]);
  assert.deepEqual(manifest.observerCandidateRole.protectedTableNames, [
    "audit_events",
    "observer_recipe_candidates",
    "observer_recipe_lifecycle_events",
    "outbox_events",
    "retailer_adapter_diagnostics"
  ]);
  assert.deepEqual(manifest.boundaryHandlerTaskKinds, [
    "observer_recipe_candidate_evaluation"
  ]);
  assert.deepEqual(manifest.qualifiedHandlerTaskKinds, [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation"
  ]);
  assert.equal(manifest.qualifiedHandlerTaskKindCount, 4);
  assert.equal(manifest.totalHandlerTaskKindCount, 7);
  assert.equal(manifest.maximumDiagnosticRows, 2_000);
  assert.equal(manifest.maximumCandidatesPerRun, 25);
  assert.equal(manifest.supportedRepairFieldCount, 5);
  assert.equal(manifest.generatedCandidateLifetimeDays, 30);
  assert.equal(manifest.serverDerivedEvidencePlan, true);
  assert.equal(manifest.serverClockBoundEvaluation, true);
  assert.equal(manifest.applicationDeterministicFingerprints, true);
  assert.equal(manifest.databaseEvidenceRevalidation, true);
  assert.equal(manifest.quarantinedOnly, true);
  assert.equal(manifest.generatedCandidatesExecutable, false);
  assert.equal(manifest.mutationAuthority, false);
  assert.equal(manifest.observerCandidateEvaluationRepositoryParity, true);
  assert.equal(manifest.protectedTableCount, 5);
  assert.equal(manifest.forcedRlsTableCount, 5);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.observerCandidateRole.login, false);
  assert.equal(manifest.observerCandidateRole.inherit, false);
  assert.equal(manifest.observerCandidateRole.bypassRls, false);
  assert.equal(manifest.observerCandidateRole.directTableAccess, false);
  assert.match(manifest.operationalRetentionManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  const capability = postgresObserverCandidateEvaluationCapabilityProjection();
  assert.equal(
    capability.contractVersion,
    POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION
  );
  assert.equal(capability.handlerTaskKindCount, 4);
  assert.equal(capability.totalHandlerTaskKindCount, 7);
  assert.equal(capability.maximumDiagnosticRows, 2_000);
  assert.equal(capability.maximumCandidatesPerRun, 25);
  assert.equal(capability.serverDerivedEvidencePlan, true);
  assert.equal(capability.databaseEvidenceRevalidation, true);
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.quarantinedOnly, true);
  assert.equal(capability.generatedCandidatesExecutable, false);
  assert.equal(capability.mutationAuthority, false);
  assert.equal(capability.protectedTableCount, 5);
  assert.equal(capability.forcedRlsTableCount, 5);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresObserverCandidateEvaluationManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "notify_namespace",
      "execute_namespace",
      "retention_namespace",
      "same_namespace"
    ),
    /must be distinct/
  );
});

test("the PostgreSQL operator-alert dispatch sub-boundary is tenant-bound, secretless, and inert", () => {
  const args = [
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test",
    "yoink_execute_test",
    "yoink_retention_test",
    "yoink_candidate_test",
    "yoink_alert_dispatch_test"
  ] as const;
  const manifest = buildPostgresOperatorAlertConnectorDispatchManifest(...args);
  assert.deepEqual(buildPostgresOperatorAlertConnectorDispatchManifest(...args), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION
  );
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(
    manifest.observerCandidateContractVersion,
    POSTGRES_OBSERVER_CANDIDATE_EVALUATION_CONTRACT_VERSION
  );
  assert.equal(
    manifest.alertDispatchRole.functionName,
    POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_FUNCTION
  );
  assert.deepEqual(manifest.alertDispatchRole.functionArgumentTypes, Array(12).fill("text"));
  assert.deepEqual(manifest.alertDispatchRole.protectedTableNames, [
    "operator_alert_connector_deliveries",
    "operator_alert_connector_delivery_events",
    "operator_alert_connectors",
    "operator_alert_incidents"
  ]);
  assert.deepEqual(manifest.qualifiedHandlerTaskKinds, [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation"
  ]);
  assert.equal(manifest.qualifiedHandlerTaskKindCount, 4);
  assert.equal(manifest.totalHandlerTaskKindCount, 7);
  assert.equal(manifest.maximumBindings, 20);
  assert.equal(manifest.maximumAttempts, 12);
  assert.equal(manifest.maximumPayloadBytes, 4_000);
  assert.equal(manifest.twoPhaseLease, true);
  assert.equal(manifest.applicationHashedOneUseCapabilities, true);
  assert.equal(manifest.databaseServerClock, true);
  assert.equal(manifest.endpointReferencesOnly, true);
  assert.equal(manifest.rawUrlsAccessible, false);
  assert.equal(manifest.connectorSecretsAccessible, false);
  assert.equal(manifest.alertDispatchRepositoryParity, true);
  assert.equal(manifest.alertReconciliationRepositoryParity, false);
  assert.equal(manifest.fullHandlerRepositoryParity, false);
  assert.equal(manifest.protectedTableCount, 4);
  assert.equal(manifest.forcedRlsTableCount, 4);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.mutationAuthority, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.observerCandidateManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = operatorAlertDispatchFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /incident\.subject_user_id = resolved_user_id/);
  assert.match(source, /operation_name IN \('lease_plan', 'lease_apply'\)/);
  assert.match(source, /FOR UPDATE OF d SKIP LOCKED/);
  assert.match(source, /lease_capability_hash = capability_hash/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /connector_secret|endpoint_url/i);

  const capability = postgresOperatorAlertConnectorDispatchCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.serverBoundPrincipalLookup, true);
  assert.equal(capability.twoPhaseLease, true);
  assert.equal(capability.applicationHashedOneUseCapabilities, true);
  assert.equal(capability.databaseServerClock, true);
  assert.equal(capability.endpointReferencesOnly, true);
  assert.equal(capability.rawUrlsAccessible, false);
  assert.equal(capability.connectorSecretsAccessible, false);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.alertDispatchRepositoryParity, true);
  assert.equal(capability.alertReconciliationRepositoryParity, false);
  assert.equal(capability.fullHandlerRepositoryParity, false);
  assert.equal(capability.handlerTaskKindCount, 4);
  assert.equal(capability.totalHandlerTaskKindCount, 7);
  assert.equal(capability.protectedTableCount, 4);
  assert.equal(capability.forcedRlsTableCount, 4);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresOperatorAlertConnectorDispatchManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "notify_namespace",
      "execute_namespace",
      "retention_namespace",
      "candidate_namespace",
      "same_namespace"
    ),
    /must be distinct/
  );
});

test("the PostgreSQL operator-alert reconciliation boundary is server-derived, bounded, and inert", () => {
  const args = [
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test",
    "yoink_execute_test",
    "yoink_retention_test",
    "yoink_candidate_test",
    "yoink_alert_dispatch_test",
    "yoink_alert_reconcile_test"
  ] as const;
  const manifest = buildPostgresOperatorAlertReconciliationManifest(...args);
  assert.deepEqual(buildPostgresOperatorAlertReconciliationManifest(...args), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(
    manifest.alertDispatchContractVersion,
    POSTGRES_OPERATOR_ALERT_CONNECTOR_DISPATCH_CONTRACT_VERSION
  );
  assert.equal(
    manifest.alertReconciliationRole.functionName,
    POSTGRES_OPERATOR_ALERT_RECONCILIATION_FUNCTION
  );
  assert.deepEqual(manifest.alertReconciliationRole.functionArgumentTypes, Array(7).fill("text"));
  assert.deepEqual(manifest.alertReconciliationRole.protectedTableNames, [
    "audit_events",
    "operator_alert_connector_deliveries",
    "operator_alert_connector_delivery_events",
    "operator_alert_connectors",
    "operator_alert_deliveries",
    "operator_alert_events",
    "operator_alert_incidents",
    "operator_alert_rules",
    "outbox_events",
    "retailer_adapter_diagnostics"
  ]);
  assert.deepEqual(manifest.qualifiedHandlerTaskKinds, [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation",
    "adapter_alert_reconciliation"
  ]);
  assert.equal(manifest.qualifiedHandlerTaskKindCount, 5);
  assert.equal(manifest.totalHandlerTaskKindCount, 7);
  assert.equal(manifest.maximumDiagnostics, 2_000);
  assert.equal(manifest.maximumGroups, 50);
  assert.equal(manifest.maximumActions, 50);
  assert.equal(manifest.maximumRules, 50);
  assert.equal(manifest.maximumConnectors, 20);
  assert.equal(manifest.maximumConnectorPayloadBytes, 4_000);
  assert.equal(manifest.serverDerivedRepairGroups, true);
  assert.equal(manifest.databaseEvidenceRevalidation, true);
  assert.equal(manifest.twoPhasePlanApply, true);
  assert.equal(manifest.databaseServerClock, true);
  assert.equal(manifest.applicationGeneratedOpaqueIds, true);
  assert.equal(manifest.sanitizedAggregateOnly, true);
  assert.equal(manifest.endpointReferencesOnly, true);
  assert.equal(manifest.rawUrlsAccessible, false);
  assert.equal(manifest.connectorSecretsAccessible, false);
  assert.equal(manifest.alertDispatchRepositoryParity, true);
  assert.equal(manifest.alertReconciliationRepositoryParity, true);
  assert.equal(manifest.fullHandlerRepositoryParity, true);
  assert.equal(manifest.protectedTableCount, 10);
  assert.equal(manifest.forcedRlsTableCount, 10);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.mutationAuthority, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.alertDispatchManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = operatorAlertReconciliationFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /LIMIT 2000/);
  assert.match(source, /operation_name NOT IN \('plan', 'apply'\)/);
  assert.match(source, /apply set does not match its evidence plan/);
  assert.match(source, /subject_user_id = resolved_user_id/);
  assert.match(source, /endpoint_reference/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /connector_secret|endpoint_url/i);

  const capability = postgresOperatorAlertReconciliationCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.serverBoundPrincipalLookup, true);
  assert.equal(capability.serverDerivedRepairGroups, true);
  assert.equal(capability.databaseEvidenceRevalidation, true);
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.databaseServerClock, true);
  assert.equal(capability.applicationGeneratedOpaqueIds, true);
  assert.equal(capability.sanitizedAggregateOnly, true);
  assert.equal(capability.endpointReferencesOnly, true);
  assert.equal(capability.rawUrlsAccessible, false);
  assert.equal(capability.connectorSecretsAccessible, false);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.alertDispatchRepositoryParity, true);
  assert.equal(capability.alertReconciliationRepositoryParity, true);
  assert.equal(capability.fullHandlerRepositoryParity, true);
  assert.equal(capability.handlerTaskKindCount, 5);
  assert.equal(capability.totalHandlerTaskKindCount, 7);
  assert.equal(capability.protectedTableCount, 10);
  assert.equal(capability.forcedRlsTableCount, 10);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresOperatorAlertReconciliationManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "notify_namespace",
      "execute_namespace",
      "retention_namespace",
      "candidate_namespace",
      "dispatch_namespace",
      "same_namespace"
    ),
    /must be distinct/
  );
});

test("the PostgreSQL observer-witness refresh boundary is two-phase, public-only, and inert", () => {
  const args = [
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test",
    "yoink_execute_test",
    "yoink_retention_test",
    "yoink_candidate_test",
    "yoink_alert_dispatch_test",
    "yoink_alert_reconcile_test",
    "yoink_witness_refresh_test"
  ] as const;
  const manifest = buildPostgresObserverWitnessRefreshManifest(...args);
  assert.deepEqual(buildPostgresObserverWitnessRefreshManifest(...args), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(
    manifest.alertReconciliationContractVersion,
    POSTGRES_OPERATOR_ALERT_RECONCILIATION_CONTRACT_VERSION
  );
  assert.equal(manifest.witnessRefreshRole.functionName, POSTGRES_OBSERVER_WITNESS_REFRESH_FUNCTION);
  assert.deepEqual(manifest.witnessRefreshRole.functionArgumentTypes, Array(8).fill("text"));
  assert.deepEqual(manifest.witnessRefreshRole.protectedTableNames, [
    "audit_events",
    "observer_recipe_transparency_events",
    "observer_recipe_trust_manifests",
    "observer_recipe_witness_checks",
    "observer_recipe_witness_receipts",
    "outbox_events"
  ]);
  assert.deepEqual(manifest.qualifiedHandlerTaskKinds, [
    "notification_recovery",
    "execution_recovery",
    "operational_telemetry_retention",
    "observer_recipe_candidate_evaluation",
    "adapter_alert_reconciliation",
    "observer_recipe_witness_refresh"
  ]);
  assert.equal(manifest.qualifiedHandlerTaskKindCount, 6);
  assert.equal(manifest.totalHandlerTaskKindCount, 7);
  assert.equal(manifest.maximumEnvelopeBytes, 65_536);
  assert.equal(manifest.twoPhaseExternalIo, true);
  assert.equal(manifest.externalIoOutsideTransaction, true);
  assert.equal(manifest.applicationEd25519Verification, true);
  assert.equal(manifest.serverDerivedCheckpoint, true);
  assert.equal(manifest.databasePlanRevalidation, true);
  assert.equal(manifest.databaseServerClock, true);
  assert.equal(manifest.serverAuthenticatedReceiptActor, true);
  assert.equal(manifest.publicCryptographicMetadataOnly, true);
  assert.equal(manifest.witnessRefreshRepositoryParity, true);
  assert.equal(manifest.allHandlerRepositoryParity, false);
  assert.equal(manifest.protectedTableCount, 6);
  assert.equal(manifest.forcedRlsTableCount, 6);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.mutationAuthority, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.alertReconciliationManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = observerWitnessRefreshFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /operation_name NOT IN \('plan', 'accept', 'failure'\)/);
  assert.match(source, /observer-witness plan changed before apply/);
  assert.match(source, /independent_signature_verified/);
  assert.match(source, /public_cryptographic_metadata/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /publicKeySpki|privateKey|endpointOrigin|fetch\(/i);

  const capability = postgresObserverWitnessRefreshCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.serverBoundPrincipalLookup, true);
  assert.equal(capability.twoPhaseExternalIo, true);
  assert.equal(capability.externalIoOutsideTransaction, true);
  assert.equal(capability.applicationEd25519Verification, true);
  assert.equal(capability.serverDerivedCheckpoint, true);
  assert.equal(capability.databasePlanRevalidation, true);
  assert.equal(capability.databaseServerClock, true);
  assert.equal(capability.serverAuthenticatedReceiptActor, true);
  assert.equal(capability.publicCryptographicMetadataOnly, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.witnessRefreshRepositoryParity, true);
  assert.equal(capability.allHandlerRepositoryParity, false);
  assert.equal(capability.handlerTaskKindCount, 6);
  assert.equal(capability.totalHandlerTaskKindCount, 7);
  assert.equal(capability.maximumEnvelopeBytes, 65_536);
  assert.equal(capability.protectedTableCount, 6);
  assert.equal(capability.forcedRlsTableCount, 6);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresObserverWitnessRefreshManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "notify_namespace",
      "execute_namespace",
      "retention_namespace",
      "candidate_namespace",
      "dispatch_namespace",
      "reconcile_namespace",
      "same_namespace"
    ),
    /must be independent/
  );
});

test("the PostgreSQL hosted-delivery and signal-inbox lifecycle boundary is exact without claiming handler parity", () => {
  const args = [
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test",
    "yoink_execute_test",
    "yoink_retention_test",
    "yoink_candidate_test",
    "yoink_alert_dispatch_test",
    "yoink_alert_reconcile_test",
    "yoink_witness_refresh_test",
    "yoink_delivery_lease_test"
  ] as const;
  const manifest = buildPostgresHostedDeliveryLeaseRecoveryManifest(...args);
  assert.deepEqual(buildPostgresHostedDeliveryLeaseRecoveryManifest(...args), manifest);
  assert.equal(
    manifest.contractVersion,
    POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION
  );
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(
    manifest.witnessRefreshContractVersion,
    POSTGRES_OBSERVER_WITNESS_REFRESH_CONTRACT_VERSION
  );
  assert.equal(
    manifest.leaseRecoveryRole.functionName,
    POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_FUNCTION
  );
  assert.deepEqual(manifest.leaseRecoveryRole.functionArgumentTypes, ["text", "text"]);
  assert.equal(
    manifest.leaseRecoveryRole.signalInboxFunctionName,
    POSTGRES_HOSTED_SIGNAL_INBOX_FUNCTION
  );
  assert.deepEqual(
    manifest.leaseRecoveryRole.signalInboxFunctionArgumentTypes,
    ["text", "text", "text", "text", "text"]
  );
  assert.equal(
    manifest.leaseRecoveryRole.signalResolutionPlanFunctionName,
    POSTGRES_HOSTED_SIGNAL_RESOLUTION_PLAN_FUNCTION
  );
  assert.deepEqual(
    manifest.leaseRecoveryRole.signalResolutionPlanFunctionArgumentTypes,
    ["text", "text", "text", "text"]
  );
  assert.deepEqual(manifest.leaseRecoveryRole.protectedTableNames, [
    "hosted_delivery_receipts",
    "inbox_messages",
    "outbox_events"
  ]);
  assert.deepEqual(manifest.boundaryHandlerTaskKinds, ["hosted_delivery_recovery"]);
  assert.equal(manifest.qualifiedHandlerTaskKindCount, 6);
  assert.equal(manifest.totalHandlerTaskKindCount, 7);
  assert.equal(manifest.maximumDeliveryAttempts, 20);
  assert.equal(manifest.maximumResolutionPlanAgeSeconds, 30);
  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.databaseServerClock, true);
  assert.equal(manifest.deterministicReceiptHashParity, true);
  assert.equal(manifest.leaseRecoverySubBoundaryParity, true);
  assert.equal(manifest.signalInboxLifecycleRepositoryParity, true);
  assert.equal(manifest.signalResolutionPlanRepositoryParity, true);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, false);
  assert.equal(manifest.signalEvaluationRepositoryParity, false);
  assert.equal(manifest.signalIngressRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.allHandlerRepositoryParity, false);
  assert.equal(manifest.protectedTableCount, 3);
  assert.equal(manifest.forcedRlsTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 3);
  assert.equal(manifest.mutationAuthority, false);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.witnessRefreshManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = hostedDeliveryLeaseRecoveryFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /statement_timestamp\(\)/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /delivery_attempts AS attempt/);
  assert.match(source, /message_record\.attempt >= 20/);
  assert.match(source, /last_error_code = 'lease_expired'/);
  assert.match(source, /pg_catalog\.sha256/);
  assert.match(source, /hosted_delivery_receipt_v1/);
  assert.doesNotMatch(source, /payload_json/);
  assert.doesNotMatch(source, /signal_events|action_jobs|retailer_adapter/i);

  const signalSource = hostedSignalInboxFunctionSource(manifest);
  assert.match(signalSource, /principal\.principal_role = session_user::text/);
  assert.match(signalSource, /statement_timestamp\(\)/);
  assert.match(signalSource, /FOR UPDATE SKIP LOCKED/);
  assert.match(signalSource, /event_type = 'signal_event_v1'/);
  assert.match(signalSource, /hosted_delivery_capability_v1/);
  assert.match(signalSource, /hosted_delivery_receipt_v1/);
  assert.match(signalSource, /operation_name NOT IN \('lease', 'complete', 'fail', 'dead_letter'\)/);
  assert.match(signalSource, /WHEN operation_name = 'dead_letter' THEN 'signal_rejected_invalid'/);
  assert.match(signalSource, /signal_processing_failed/);
  assert.doesNotMatch(signalSource, /signal_events|action_jobs|retailer_adapter/i);

  const resolutionSource = hostedSignalResolutionPlanFunctionSource(manifest);
  assert.match(resolutionSource, /principal\.principal_role = session_user::text/);
  assert.match(resolutionSource, /statement_timestamp\(\)/);
  assert.match(resolutionSource, /FOR SHARE/);
  assert.match(resolutionSource, /hosted_delivery_capability_v1/);
  assert.match(resolutionSource, /hosted_delivery_payload_v1/);
  assert.match(resolutionSource, /postgres_hosted_signal_resolution_plan_v1/);
  assert.match(resolutionSource, /source_listing_refs/);
  assert.match(resolutionSource, /source_variant_retailer_refs/);
  assert.match(resolutionSource, /shared_catalog_mutation_required_value/);
  assert.doesNotMatch(resolutionSource, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(
    resolutionSource,
    /"(?:action_jobs|missions|strategies|signal_incidents)"/i
  );

  const capability = postgresHostedDeliveryLeaseRecoveryCapabilityProjection();
  assert.equal(
    capability.contractVersion,
    POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION
  );
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.serverBoundPrincipalLookup, true);
  assert.equal(capability.databaseServerClock, true);
  assert.equal(capability.deterministicReceiptHashParity, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.nativeContentionQualified, true);
  assert.equal(capability.leaseRecoverySubBoundaryParity, true);
  assert.equal(capability.signalInboxLifecycleRepositoryParity, true);
  assert.equal(capability.signalResolutionPlanRepositoryParity, true);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, false);
  assert.equal(capability.sharedCatalogMutationFailClosed, true);
  assert.equal(capability.rawSignalPayloadReturned, false);
  assert.equal(capability.signalEvaluationRepositoryParity, false);
  assert.equal(capability.signalIngressRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.allHandlerRepositoryParity, false);
  assert.equal(capability.handlerTaskKindCount, 6);
  assert.equal(capability.totalHandlerTaskKindCount, 7);
  assert.equal(capability.maximumDeliveryAttempts, 20);
  assert.equal(capability.maximumResolutionPlanAgeSeconds, 30);
  assert.equal(capability.protectedTableCount, 3);
  assert.equal(capability.forcedRlsTableCount, 3);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 3);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresHostedDeliveryLeaseRecoveryManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "notify_namespace",
      "execute_namespace",
      "retention_namespace",
      "candidate_namespace",
      "dispatch_namespace",
      "reconcile_namespace",
      "witness_namespace",
      "same_namespace"
    ),
    /must be independent/
  );
});

test("the PostgreSQL unknown-signal catalog boundary is separately privileged, insert-only, and inert", () => {
  const args = [
    "yoink_cutover_test",
    "yoink_q_test",
    "yoink_session_test",
    "yoink_queue_write_test",
    "yoink_worker_control_test",
    "yoink_notify_test",
    "yoink_execute_test",
    "yoink_retention_test",
    "yoink_candidate_test",
    "yoink_alert_dispatch_test",
    "yoink_alert_reconcile_test",
    "yoink_witness_refresh_test",
    "yoink_delivery_lease_test",
    "yoink_catalog_apply_test"
  ] as const;
  const manifest = buildPostgresSignalCatalogApplyManifest(...args);
  assert.deepEqual(buildPostgresSignalCatalogApplyManifest(...args), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
  assert.equal(
    manifest.hostedDeliveryContractVersion,
    POSTGRES_HOSTED_DELIVERY_LEASE_RECOVERY_CONTRACT_VERSION
  );
  assert.equal(manifest.catalogApplyRole.functionName, POSTGRES_SIGNAL_CATALOG_APPLY_FUNCTION);
  assert.deepEqual(
    manifest.catalogApplyRole.functionArgumentTypes,
    ["text", "text", "text", "text", "text", "text", "text"]
  );
  assert.deepEqual(manifest.catalogApplyRole.protectedTenantTableNames, [
    "inbox_messages",
    "source_listing_refs",
    "source_product_aliases",
    "source_product_refs"
  ]);
  assert.deepEqual(manifest.catalogApplyRole.sharedCatalogWriteTableNames, [
    "listing_urls",
    "listings",
    "product_families",
    "variants"
  ]);
  assert.deepEqual(manifest.catalogApplyRole.tenantReferenceWriteTableNames, [
    "source_listing_refs",
    "source_product_aliases",
    "source_product_refs"
  ]);
  assert.equal(manifest.catalogApplyRole.login, false);
  assert.equal(manifest.catalogApplyRole.inherit, false);
  assert.equal(manifest.catalogApplyRole.bypassRls, false);
  assert.equal(manifest.catalogApplyRole.directTableAccess, false);
  assert.equal(manifest.protectedTenantTableCount, 4);
  assert.equal(manifest.forcedRlsTableCount, 4);
  assert.equal(manifest.sharedCatalogWriteTableCount, 4);
  assert.equal(manifest.tenantReferenceWriteTableCount, 3);
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.maximumPlanAgeSeconds, 30);
  assert.equal(manifest.supportedExactRetailerCount, 20);
  assert.equal(manifest.serverBoundPrincipalLookup, true);
  assert.equal(manifest.databasePlanRevalidation, true);
  assert.equal(manifest.insertOnlyCatalogMutation, true);
  assert.equal(manifest.sharedCatalogCreateApplyRepositoryParity, true);
  assert.equal(manifest.sourceReferenceRefreshRepositoryParity, false);
  assert.equal(manifest.signalEvaluationGraphMutation, false);
  assert.equal(manifest.rawSignalPayloadReturned, false);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.hostedDeliveryManifestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalCatalogApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_plan_trackalacker_signal_resolution/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /postgres_signal_catalog_apply_plan_v1/);
  assert.match(source, /operation_name NOT IN \('plan', 'apply'\)/);
  assert.match(source, /INSERT INTO .*"product_families"/s);
  assert.match(source, /INSERT INTO .*"variants"/s);
  assert.match(source, /INSERT INTO .*"listings"/s);
  assert.match(source, /INSERT INTO .*"listing_urls"/s);
  assert.match(source, /INSERT INTO .*"source_product_refs"/s);
  assert.match(source, /INSERT INTO .*"source_listing_refs"/s);
  assert.match(source, /INSERT INTO .*"source_product_aliases"/s);
  for (const retailerId of [
    "target", "walmart", "amazon", "bestbuy", "riot", "booksamillion",
    "pbandai", "pokemoncenter", "disney", "ravensburger", "fanatics",
    "kohls", "macys"
  ]) {
    assert.match(source, new RegExp(`WHEN '${retailerId}' THEN`));
  }
  assert.doesNotMatch(source, /\b(?:UPDATE\s+"|DELETE\s+FROM|TRUNCATE\s+)\b/i);
  assert.doesNotMatch(
    source,
    /"(?:offer_observations|signal_incidents|signal_occurrences|resolution_decisions|mission_decisions|missions|mission_targets|strategies|action_jobs|notifications)"/i
  );

  const capability = postgresSignalCatalogApplyCapabilityProjection();
  assert.equal(capability.contractVersion, POSTGRES_SIGNAL_CATALOG_APPLY_CONTRACT_VERSION);
  assert.equal(capability.hostedDeliveryContractVersion, 3);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.atomicQualificationApplyImplemented, true);
  assert.equal(capability.exactEffectivePrivilegeVerification, true);
  assert.equal(capability.securityDefinerRoutineVerified, true);
  assert.equal(capability.serverBoundPrincipalLookup, true);
  assert.equal(capability.databasePlanRevalidation, true);
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.readCommittedTransactionAdapter, true);
  assert.equal(capability.insertOnlyCatalogMutation, true);
  assert.equal(capability.sharedCatalogCreateApplyRepositoryParity, true);
  assert.equal(capability.sourceReferenceRefreshRepositoryParity, false);
  assert.equal(capability.signalEvaluationGraphMutation, false);
  assert.equal(capability.rawSignalPayloadReturned, false);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.maximumPlanAgeSeconds, 30);
  assert.equal(capability.supportedExactRetailerCount, 20);
  assert.equal(capability.protectedTenantTableCount, 4);
  assert.equal(capability.forcedRlsTableCount, 4);
  assert.equal(capability.sharedCatalogWriteTableCount, 4);
  assert.equal(capability.tenantReferenceWriteTableCount, 3);
  assert.equal(capability.directTableGrantCount, 0);
  assert.equal(capability.functionGrantCount, 1);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.throws(
    () => buildPostgresSignalCatalogApplyManifest(
      "yoink_cutover_test",
      "same_namespace",
      "session_namespace",
      "queue_namespace",
      "control_namespace",
      "notify_namespace",
      "execute_namespace",
      "retention_namespace",
      "candidate_namespace",
      "dispatch_namespace",
      "reconcile_namespace",
      "witness_namespace",
      "delivery_namespace",
      "same_namespace"
    ),
    /must be independent/
  );
});

test("one verified archive imports atomically into real PostgreSQL semantics and reconciles exactly", async () => {
  const paths = createPostgresCutoverFixture();
  const postgres = new PgliteCutoverDatabase();
  try {
    const preflight = await inspectPostgresCutoverPreflight(postgres);
    assert.equal(preflight.serverVersionSupported, true);
    assert.equal(preflight.rowSecurityAvailable, true);
    assert.equal(preflight.skipLockedAvailable, true);
    assert.equal(preflight.cutoverRoleBypassesRls, true);
    assert.equal(preflight.productionReady, false);

    const imported = await importPostgresCutoverArchive(
      postgres,
      paths.archivePath,
      "yoink_cutover_test",
      "2026-08-25T14:00:00.000Z"
    );
    assert.equal(imported.matched, true);
    assert.deepEqual(imported.mismatchedTables, []);
    assert.equal(imported.databaseDataSha256, imported.archiveDataSha256);
    assert.equal(imported.database.tableCount, 111);
    assert.ok(imported.database.rowCount > 520);
    assert.equal(imported.receipt.phase, "verified");
    assert.equal(imported.receipt.qualification.runtimeAuthority, false);
    assert.equal(imported.receipt.qualification.cutoverReady, false);
    assert.equal(imported.receipt.qualification.defaultExpressionParity, true);
    assert.equal(imported.receipt.qualification.inheritedTenantRlsParity, true);
    assert.equal(imported.receipt.qualification.mixedTenantScopeParity, false);
    assert.equal(imported.receipt.qualification.sharedTableRuntimeRoleParity, false);
    assert.equal(imported.receipt.qualification.postgresAsyncWorkerStoreImplemented, true);
    assert.equal(imported.receipt.qualification.postgresAsyncWorkerStoreContractParity, true);
    assert.equal(imported.receipt.qualification.singleConnectionWorkerLeaseSemanticsQualified, true);
    assert.equal(imported.receipt.qualification.nativePostgresQualificationSuite, true);
    assert.equal(imported.receipt.qualification.nativePostgresMajorVersion, 16);
    assert.equal(imported.receipt.qualification.independentBackendSessionCount, 3);
    assert.equal(imported.receipt.qualification.fleetLeaseContentionQualified, true);
    assert.equal(imported.receipt.qualification.postgresBackgroundHandlerParity, false);
    assert.equal(imported.receipt.qualification.checkConstraintParity, true);
    assert.equal(imported.receipt.qualification.triggerParity, true);
    assert.equal(imported.receipt.qualification.asyncRuntimeRepositoryParity, false);

    const verified = await verifyPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_test");
    assert.equal(verified.matched, true);
    assert.equal(verified.receipt.sourceFileSha256, imported.archive.fileSha256);

    const workerStore = new PostgresBackgroundWorkerQualificationStore(postgres, "yoink_cutover_test", {
      allowCutoverRoleFallback: true
    });
    await assert.rejects(
      workerStore.listPrincipals("", 1),
      /must pass qualification/
    );
    const workerQualification = await workerStore.qualify();
    assert.ok(workerQualification.serverVersionMajor >= 15);
    assert.deepEqual({ ...workerQualification, serverVersionMajor: "supported" }, {
      qualificationOnly: true,
      cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
      schemaManifestFingerprint: imported.manifest.fingerprint,
      serverVersionMajor: "supported",
      verifiedTenantPolicyCount: imported.manifest.directTenantTableCount
        + imported.manifest.inheritedTenantTableCount
        + imported.manifest.mixedTenantTableCount,
      storeContractImplemented: true,
      tenantPredicatesApplied: true,
      skipLockedLeaseImplemented: true,
      singleConnectionSemanticsQualified: true,
      nativePostgresQualificationSuite: true,
      independentBackendSessionCount: 3,
      multiConnectionContentionQualified: true,
      serverBoundQueueWriteTransactions: false,
      queueStoreWriteRoleParity: false,
      atomicDeploymentAttestationAndQueueWrite: false,
      serverBoundControlTransactions: false,
      controlRepositoryParity: false,
      handlerRepositoryParity: false,
      runtimeAuthority: false
    });

    const tenantPolicies = await postgres.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_policies WHERE schemaname = 'yoink_cutover_test'`
    );
    assert.equal(
      tenantPolicies.rows[0]?.count,
      imported.manifest.directTenantTableCount
        + imported.manifest.inheritedTenantTableCount
        + imported.manifest.mixedTenantTableCount
    );
    const triggerCount = await postgres.query<{ count: number }>(`
      SELECT COUNT(*)::integer AS count
      FROM pg_catalog.pg_trigger trigger
      JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'yoink_cutover_test' AND trigger.tgisinternal = FALSE
    `);
    assert.equal(triggerCount.rows[0]?.count, imported.manifest.triggerCount);
    const defaultCount = await postgres.query<{ count: number }>(`
      SELECT COUNT(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = 'yoink_cutover_test'
        AND table_name <> 'yoink_cutover_receipt'
        AND column_default IS NOT NULL
    `);
    assert.equal(defaultCount.rows[0]?.count, imported.manifest.defaultExpressionCount);
    const packVersionColumns = await postgres.query<{ table_name: string; is_nullable: string }>(`
      SELECT table_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'yoink_cutover_test'
        AND column_name = 'pack_version'
      ORDER BY table_name
    `);
    assert.deepEqual(
      packVersionColumns.rows.map((row) => [row.table_name, row.is_nullable]),
      POSTGRES_ADAPTER_PACK_VERSION_TABLES.map((tableName) => [tableName, "YES"])
    );

    await postgres.query("BEGIN");
    await postgres.query(
      `INSERT INTO yoink_cutover_test.retailers(id, display_name, created_at, updated_at)
       VALUES ('retailer_postgres_default_test', 'Default test', $1, $1)`,
      ["2026-08-25T14:20:00.000Z"]
    );
    const defaulted = await postgres.query<{ execution_supported: bigint; domains_json: string }>(
      `SELECT execution_supported, domains_json
       FROM yoink_cutover_test.retailers WHERE id = 'retailer_postgres_default_test'`
    );
    assert.equal(String(defaulted.rows[0]?.execution_supported), "0");
    assert.equal(defaulted.rows[0]?.domains_json, "[]");
    await postgres.query("ROLLBACK");

    await postgres.query("BEGIN");
    await assert.rejects(
      postgres.query(
        `INSERT INTO yoink_cutover_test.retailers(
           id, display_name, execution_supported, created_at, updated_at
         ) VALUES ('retailer_postgres_invalid_check', 'Invalid check', 7, $1, $1)`,
        ["2026-08-25T14:21:00.000Z"]
      ),
      /check constraint/i
    );
    await postgres.query("ROLLBACK");

    await postgres.query("BEGIN");
    await assert.rejects(
      postgres.query(
        `INSERT INTO yoink_cutover_test.users(id, tenant_id, display_name, created_at)
         VALUES ('user_postgres_invalid_fk', 'tenant_does_not_exist', 'Invalid FK', $1)`,
        ["2026-08-25T14:22:00.000Z"]
      ),
      /foreign key/i
    );
    await postgres.query("ROLLBACK");

    await postgres.query("BEGIN");
    await postgres.query(
      `INSERT INTO yoink_cutover_test.extension_devices(
         id, tenant_id, user_id, name, token_hash, created_at, updated_at
       ) VALUES ($1, 'tenant_cutover_other', 'user_cutover_other', 'Trigger test', $2, $3, $3)`,
      [
        "device_postgres_backfill_test",
        "c".repeat(64),
        "2026-08-25T14:25:00.000Z"
      ]
    );
    const backfilled = await postgres.query<{ credential_issued_at: string }>(
      `SELECT credential_issued_at FROM yoink_cutover_test.extension_devices
       WHERE id = 'device_postgres_backfill_test'`
    );
    assert.equal(backfilled.rows[0]?.credential_issued_at, "2026-08-25T14:25:00.000Z");
    await postgres.query("ROLLBACK");

    const insertImmutableEvent = () => postgres.query(
      `INSERT INTO yoink_cutover_test.background_worker_deployment_events(
         id, sequence, contract_version, from_mode, to_mode,
         from_deployment_fingerprint, to_deployment_fingerprint,
         runtime_version, previous_event_hash, event_hash, reason_code,
         privacy_classification, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        "deployment_event_postgres_trigger_test",
        999,
        2,
        "",
        "disabled",
        "",
        "a".repeat(64),
        "0.56.0-test",
        "",
        "b".repeat(64),
        "api_startup_contract",
        "operational_configuration",
        "2026-08-25T14:30:00.000Z"
      ]
    );
    await postgres.query("BEGIN");
    await insertImmutableEvent();
    await assert.rejects(
      postgres.query(
        "UPDATE yoink_cutover_test.background_worker_deployment_events SET runtime_version = 'changed' WHERE sequence = 999"
      ),
      /append-only/
    );
    await postgres.query("ROLLBACK");
    await postgres.query("BEGIN");
    await insertImmutableEvent();
    await assert.rejects(
      postgres.query("DELETE FROM yoink_cutover_test.background_worker_deployment_events WHERE sequence = 999"),
      /append-only/
    );
    await postgres.query("ROLLBACK");

    const compactedAt = new Date().toISOString();
    await postgres.query(
      `INSERT INTO yoink_cutover_test.background_tasks(
         id, tenant_id, subject_user_id, task_kind, dedupe_key, state,
         maximum_attempts, scheduled_for, result_json, completed_at, created_at, updated_at
       ) VALUES (
         'task_postgres_no_work_compaction', 'tenant_cutover_other', 'user_cutover_other',
         'operational_telemetry_retention', 'postgres-no-work-compaction', 'succeeded',
         3, $1, '{"historyDisposition":"no_work"}', $1, $1, $1
       )`,
      [compactedAt]
    );
    await postgres.query(
      `INSERT INTO yoink_cutover_test.background_task_events(
         id, tenant_id, subject_user_id, task_id, sequence,
         event_type, attempt, reason_code, created_at
       ) VALUES (
         'task_event_postgres_no_work_compaction', 'tenant_cutover_other', 'user_cutover_other',
         'task_postgres_no_work_compaction', 1, 'succeeded', 1, 'handler_completed', $1
       )`,
      [compactedAt]
    );
    await postgres.query(
      "DELETE FROM yoink_cutover_test.background_tasks WHERE id = 'task_postgres_no_work_compaction'"
    );
    const compacted = await postgres.query<{ task_count: number; event_count: number }>(
      `SELECT
         (SELECT COUNT(*)::integer FROM yoink_cutover_test.background_tasks
          WHERE id = 'task_postgres_no_work_compaction') AS task_count,
         (SELECT COUNT(*)::integer FROM yoink_cutover_test.background_task_events
          WHERE task_id = 'task_postgres_no_work_compaction') AS event_count`
    );
    assert.deepEqual(compacted.rows[0], { task_count: 0, event_count: 0 });

    await postgres.query("CREATE ROLE yoink_cutover_reader NOLOGIN");
    await postgres.query("GRANT USAGE ON SCHEMA yoink_cutover_test TO yoink_cutover_reader");
    await postgres.query("GRANT SELECT, INSERT, UPDATE ON yoink_cutover_test.users TO yoink_cutover_reader");
    await postgres.query(
      `GRANT SELECT ON
         yoink_cutover_test.app_settings,
         yoink_cutover_test.offer_observations,
         yoink_cutover_test.source_connections,
         yoink_cutover_test.signal_events,
         yoink_cutover_test.signal_incidents,
         yoink_cutover_test.missions,
         yoink_cutover_test.strategies
       TO yoink_cutover_reader`
    );
    await postgres.query(
      "GRANT SELECT, INSERT ON yoink_cutover_test.mission_decisions TO yoink_cutover_reader"
    );
    await postgres.query("SET ROLE yoink_cutover_reader");
    const defaultDenied = await postgres.query<{ id: string }>("SELECT id FROM yoink_cutover_test.users");
    assert.deepEqual(defaultDenied.rows, []);
    const inheritedDefaultDenied = await postgres.query<{ user_id: string }>(
      "SELECT user_id FROM yoink_cutover_test.app_settings"
    );
    assert.deepEqual(inheritedDefaultDenied.rows, []);
    await assert.rejects(
      postgres.query(
        `INSERT INTO yoink_cutover_test.users(id, tenant_id, display_name, created_at)
         VALUES ('user_postgres_cross_tenant', 'tenant_local', 'Cross tenant', $1)`,
        ["2026-08-25T14:40:00.000Z"]
      ),
      /row-level security/i
    );
    await postgres.query("SET yoink.tenant_id = 'tenant_cutover_other'");
    const visible = await postgres.query<{ id: string }>("SELECT id FROM yoink_cutover_test.users ORDER BY id");
    assert.deepEqual(visible.rows.map((row) => row.id), ["user_cutover_other"]);
    const inheritedVisible = await postgres.query<{ user_id: string }>(
      "SELECT user_id FROM yoink_cutover_test.app_settings ORDER BY user_id"
    );
    assert.deepEqual(inheritedVisible.rows.map((row) => row.user_id), ["user_cutover_other"]);
    const mixedVisible = await postgres.query<{ id: string }>(
      "SELECT id FROM yoink_cutover_test.offer_observations ORDER BY id"
    );
    assert.deepEqual(mixedVisible.rows.map((row) => row.id), ["offer_cutover_other"]);

    await postgres.query("BEGIN");
    await postgres.query(
      `INSERT INTO yoink_cutover_test.mission_decisions(
         id, event_id, mission_id, outcome, reason, created_at
       ) VALUES ('decision_postgres_valid_owner', 'signal_cutover_other',
                 'mission_cutover_other', 'notify', 'valid owner', $1)`,
      ["2026-08-25T14:41:00.000Z"]
    );
    const validInheritedInsert = await postgres.query<{ id: string }>(
      "SELECT id FROM yoink_cutover_test.mission_decisions WHERE id = 'decision_postgres_valid_owner'"
    );
    assert.deepEqual(validInheritedInsert.rows.map((row) => row.id), ["decision_postgres_valid_owner"]);
    await postgres.query("ROLLBACK");
    await assert.rejects(
      postgres.query(
        `INSERT INTO yoink_cutover_test.mission_decisions(
           id, event_id, mission_id, outcome, reason, created_at
         ) VALUES ('decision_postgres_cross_owner', 'signal_cutover_other',
                   'mission_cutover_local', 'notify', 'cross owner', $1)`,
        ["2026-08-25T14:42:00.000Z"]
      ),
      /row-level security/i
    );
    const blocked = await postgres.query(
      "UPDATE yoink_cutover_test.users SET display_name = 'blocked' WHERE id = 'user_local' RETURNING id"
    );
    assert.equal(blocked.rows.length, 0);
    await postgres.query("RESET ROLE");
    await postgres.query("RESET yoink.tenant_id");

    const runtimeRoles = await applyPostgresRuntimeReadRoles(
      postgres,
      "yoink_cutover_test",
      "yoink_q_test",
      new Date("2026-08-25T14:45:00.000Z").getTime()
    );
    assert.equal(runtimeRoles.contractVersion, POSTGRES_RUNTIME_READ_ROLE_CONTRACT_VERSION);
    assert.equal(runtimeRoles.cutoverContractVersion, POSTGRES_CUTOVER_CONTRACT_VERSION);
    assert.equal(runtimeRoles.phase, "verified");
    assert.equal(runtimeRoles.roleCount, 5);
    assert.equal(runtimeRoles.grantedTableCount, 111);
    assert.equal(runtimeRoles.grantCount, 111);
    assert.equal(runtimeRoles.tenantPolicyCount, 99);
    assert.equal(runtimeRoles.membershipCount, 0);
    assert.deepEqual(runtimeRoles.unresolvedTables, []);
    assert.equal(runtimeRoles.readOnly, true);
    assert.equal(runtimeRoles.runtimeAuthority, false);
    assert.equal(runtimeRoles.productionReady, false);
    assert.equal(runtimeRoles.appliedAt, "2026-08-25T14:45:00.000Z");
    assert.equal(runtimeRoles.verifiedAt, "2026-08-25T14:45:00.001Z");

    const role = (kind: typeof runtimeRoles.roles[number]["kind"]): string => {
      const match = runtimeRoles.roles.find((candidate) => candidate.kind === kind)?.name;
      assert.ok(match);
      return match;
    };
    const tenantReader = role("tenant_reader");
    const sharedReader = role("shared_catalog_reader");
    const authorizationReader = role("authorization_catalog_reader");
    const deploymentReader = role("deployment_control_reader");
    const registryReader = role("tenant_registry_reader");

    await postgres.query(`SET ROLE "${tenantReader}"`);
    const tenantDefaultDenied = await postgres.query<{ id: string }>(
      "SELECT id FROM yoink_cutover_test.users"
    );
    assert.deepEqual(tenantDefaultDenied.rows, []);
    await postgres.query("SET yoink.tenant_id = 'tenant_cutover_other'");
    const tenantUsers = await postgres.query<{ id: string }>(
      "SELECT id FROM yoink_cutover_test.users ORDER BY id"
    );
    assert.deepEqual(tenantUsers.rows.map((row) => row.id), ["user_cutover_other"]);
    const tenantInherited = await postgres.query<{ user_id: string }>(
      "SELECT user_id FROM yoink_cutover_test.app_settings ORDER BY user_id"
    );
    assert.deepEqual(tenantInherited.rows.map((row) => row.user_id), ["user_cutover_other"]);
    const tenantMixed = await postgres.query<{ id: string }>(
      "SELECT id FROM yoink_cutover_test.offer_observations ORDER BY id"
    );
    assert.deepEqual(tenantMixed.rows.map((row) => row.id), ["offer_cutover_other"]);
    await assert.rejects(
      postgres.query("SELECT id FROM yoink_cutover_test.retailers"),
      /permission denied/i
    );
    await assert.rejects(
      postgres.query("INSERT INTO yoink_cutover_test.app_settings(user_id, updated_at) VALUES ('user_cutover_other', '')"),
      /permission denied/i
    );
    await assert.rejects(
      postgres.query("SELECT yoink_cutover_test.yoink_json_valid('{}')"),
      /permission denied/i
    );
    await assert.rejects(
      postgres.query("CREATE TABLE yoink_cutover_test.tenant_reader_escape(id TEXT)"),
      /permission denied/i
    );
    await postgres.query("RESET yoink.tenant_id");
    await postgres.query("RESET ROLE");

    await postgres.query(`SET ROLE "${sharedReader}"`);
    const sharedCatalog = await postgres.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM yoink_cutover_test.retailers"
    );
    assert.ok(Number(sharedCatalog.rows[0]?.count ?? 0) > 0);
    await assert.rejects(postgres.query("SELECT id FROM yoink_cutover_test.users"), /permission denied/i);
    await assert.rejects(
      postgres.query("SELECT id FROM yoink_cutover_test.offer_observations"),
      /permission denied/i
    );
    await assert.rejects(
      postgres.query("SELECT id FROM yoink_cutover_test.signal_incidents"),
      /permission denied/i
    );
    await postgres.query("RESET ROLE");

    await postgres.query(`SET ROLE "${authorizationReader}"`);
    const authorizationCatalog = await postgres.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM yoink_cutover_test.authorization_roles"
    );
    assert.ok(Number(authorizationCatalog.rows[0]?.count ?? 0) > 0);
    await assert.rejects(postgres.query("SELECT id FROM yoink_cutover_test.retailers"), /permission denied/i);
    await postgres.query("RESET ROLE");

    await postgres.query(`SET ROLE "${deploymentReader}"`);
    const deploymentControl = await postgres.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM yoink_cutover_test.background_worker_deployment_expectations"
    );
    assert.equal(deploymentControl.rows[0]?.count, 1);
    await assert.rejects(postgres.query("SELECT id FROM yoink_cutover_test.tenants"), /permission denied/i);
    await postgres.query("RESET ROLE");

    await postgres.query(`SET ROLE "${registryReader}"`);
    const tenantRegistry = await postgres.query<{ id: string }>(
      "SELECT id FROM yoink_cutover_test.tenants ORDER BY id"
    );
    assert.deepEqual(tenantRegistry.rows.map((row) => row.id), ["tenant_cutover_other", "tenant_local"]);
    await assert.rejects(postgres.query("SELECT id FROM yoink_cutover_test.users"), /permission denied/i);
    await postgres.query("RESET ROLE");

    const verifiedRuntimeRoles = await verifyPostgresRuntimeReadRoles(
      postgres,
      "yoink_cutover_test",
      "yoink_q_test"
    );
    assert.deepEqual(verifiedRuntimeRoles, runtimeRoles);
    const afterRuntimeRoles = await verifyPostgresCutoverArchive(
      postgres,
      paths.archivePath,
      "yoink_cutover_test"
    );
    assert.equal(afterRuntimeRoles.matched, true);
    await assert.rejects(
      applyPostgresRuntimeReadRoles(postgres, "yoink_cutover_test", "yoink_q_test", WORKER_NOW),
      /refuses existing roles/
    );

    await postgres.query(
      `GRANT SELECT ON yoink_cutover_test.signal_incidents TO "${sharedReader}"`
    );
    await assert.rejects(
      verifyPostgresRuntimeReadRoles(postgres, "yoink_cutover_test", "yoink_q_test"),
      /grants differ/
    );
    await postgres.query(
      `REVOKE SELECT ON yoink_cutover_test.signal_incidents FROM "${sharedReader}"`
    );
    assert.equal(
      (await verifyPostgresRuntimeReadRoles(postgres, "yoink_cutover_test", "yoink_q_test")).phase,
      "verified"
    );
    await postgres.query(
      `GRANT UPDATE (display_name) ON yoink_cutover_test.users TO "${tenantReader}"`
    );
    await assert.rejects(
      verifyPostgresRuntimeReadRoles(postgres, "yoink_cutover_test", "yoink_q_test"),
      /column privilege/
    );
    await postgres.query(
      `REVOKE UPDATE (display_name) ON yoink_cutover_test.users FROM "${tenantReader}"`
    );
    assert.equal(
      (await verifyPostgresRuntimeReadRoles(postgres, "yoink_cutover_test", "yoink_q_test")).phase,
      "verified"
    );
    await assert.rejects(
      postgres.query(
        "UPDATE yoink_cutover_test.yoink_runtime_read_role_receipt SET grant_count = 0 WHERE id = 'active'"
      ),
      /immutable/i
    );

    await postgres.query(
      "UPDATE yoink_cutover_test.users SET display_name = 'Changed after reconciliation' WHERE id = 'user_cutover_other'"
    );
    const mismatch = await verifyPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_test");
    assert.equal(mismatch.matched, false);
    assert.deepEqual(mismatch.mismatchedTables, ["users"]);

    const firstPrincipalPage = await workerStore.listPrincipals("", 1);
    assert.deepEqual(firstPrincipalPage.principals, [{
      tenantId: "tenant_cutover_other",
      userId: "user_cutover_other"
    }]);
    assert.ok(firstPrincipalPage.nextCursor);
    const secondPrincipalPage = await workerStore.listPrincipals(firstPrincipalPage.nextCursor, 1);
    assert.deepEqual(secondPrincipalPage, {
      principals: [{ tenantId: "tenant_local", userId: "user_local" }],
      nextCursor: ""
    });
    await assert.rejects(workerStore.listPrincipals(`${firstPrincipalPage.nextCursor}x`, 1), /cursor is invalid/);

    const workerContext = (tenantId: string, userId: string) => ({
      principal: { tenantId, userId },
      workerId: "postgres_worker_test",
      runtimeKind: "standalone" as const,
      runtimeVersion: WORKER_VERSION,
      deploymentFingerprint: WORKER_FINGERPRINT
    });
    const localWorker = workerContext("tenant_local", "user_local");
    const otherWorker = workerContext("tenant_cutover_other", "user_cutover_other");
    await assert.rejects(
      workerStore.ensureSchedules(workerContext("tenant_local", "user_cutover_other"), WORKER_NOW),
      /does not belong/
    );
    await workerStore.ensureSchedules(localWorker, WORKER_NOW);
    await workerStore.ensureSchedules(otherWorker, WORKER_NOW);
    assert.equal(await workerStore.enqueueDueSchedules(localWorker, WORKER_NOW), 7);
    assert.equal(await workerStore.enqueueDueSchedules(otherWorker, WORKER_NOW), 7);
    assert.equal(await workerStore.enqueueDueSchedules(localWorker, WORKER_NOW), 0);

    const localLease = await workerStore.leaseNext(localWorker, 60, WORKER_NOW + 1);
    const otherLease = await workerStore.leaseNext(otherWorker, 60, WORKER_NOW + 1);
    assert.ok(localLease);
    assert.ok(otherLease);
    assert.notEqual(localLease.id, otherLease.id);
    assert.match(localLease.capabilityToken, /^[A-Za-z0-9_-]{43}$/);
    await assert.rejects(
      workerStore.complete(localWorker, localLease.id, "invalid", { processed: 1 }, WORKER_NOW + 2),
      /capability is invalid/
    );
    await workerStore.complete(
      localWorker,
      localLease.id,
      localLease.capabilityToken,
      { processed: 1, bounded: true },
      WORKER_NOW + 2
    );
    await workerStore.fail(
      otherWorker,
      otherLease.id,
      otherLease.capabilityToken,
      "fixture_failure",
      WORKER_NOW + 2
    );
    const transitioned = await postgres.query<{ id: string; state: string; result_json: string }>(
      `SELECT id, state, result_json FROM yoink_cutover_test.background_tasks
       WHERE id IN ($1, $2) ORDER BY id`,
      [localLease.id, otherLease.id]
    );
    assert.deepEqual(
      new Map(transitioned.rows.map((row) => [row.id, row.state])),
      new Map([[localLease.id, "succeeded"], [otherLease.id, "retry_wait"]])
    );
    assert.deepEqual(
      JSON.parse(transitioned.rows.find((row) => row.id === localLease.id)?.result_json ?? "{}"),
      { processed: 1, bounded: true }
    );

    const expiringLease = await workerStore.leaseNext(localWorker, 60, WORKER_NOW + 3);
    assert.ok(expiringLease);
    await postgres.query(
      `UPDATE yoink_cutover_test.background_tasks SET lease_expires_at = $1 WHERE id = $2`,
      [new Date(WORKER_NOW + 3).toISOString(), expiringLease.id]
    );
    const reclaimedLease = await workerStore.leaseNext(localWorker, 60, WORKER_NOW + 4);
    assert.ok(reclaimedLease);
    assert.equal(reclaimedLease.id, expiringLease.id);
    assert.notEqual(reclaimedLease.capabilityToken, expiringLease.capabilityToken);
    await assert.rejects(
      workerStore.complete(
        localWorker,
        expiringLease.id,
        expiringLease.capabilityToken,
        { reclaimed: false },
        WORKER_NOW + 5
      ),
      /capability is invalid/
    );
    await workerStore.complete(
      localWorker,
      reclaimedLease.id,
      reclaimedLease.capabilityToken,
      { reclaimed: true },
      WORKER_NOW + 5
    );

    const exhaustedLease = await workerStore.leaseNext(localWorker, 60, WORKER_NOW + 6);
    assert.ok(exhaustedLease);
    await postgres.query(
      `UPDATE yoink_cutover_test.background_tasks
       SET attempt_count = maximum_attempts, lease_expires_at = $1 WHERE id = $2`,
      [new Date(WORKER_NOW + 6).toISOString(), exhaustedLease.id]
    );
    const afterExhaustion = await workerStore.leaseNext(localWorker, 60, WORKER_NOW + 7);
    assert.ok(afterExhaustion);
    assert.notEqual(afterExhaustion.id, exhaustedLease.id);
    const exhaustedState = await postgres.query<{ state: string; last_error_code: string }>(
      `SELECT state, last_error_code FROM yoink_cutover_test.background_tasks WHERE id = $1`,
      [exhaustedLease.id]
    );
    assert.deepEqual(exhaustedState.rows[0], {
      state: "dead_letter",
      last_error_code: "lease_attempts_exhausted"
    });
    await workerStore.complete(
      localWorker,
      afterExhaustion.id,
      afterExhaustion.capabilityToken,
      { continued: true },
      WORKER_NOW + 8
    );

    await workerStore.heartbeat(localWorker, "", WORKER_NOW + 9);
    await workerStore.heartbeat(otherWorker, "", WORKER_NOW + 9);
    const running = await workerStore.deploymentStatus("standalone", WORKER_FINGERPRINT, WORKER_NOW + 10);
    assert.equal(running.state, "running");
    assert.equal(running.healthy, true);
    assert.equal(running.deploymentAttested, true);
    assert.equal(running.coveredPrincipals, 2);
    await workerStore.stopWorker("postgres_worker_test", "standalone", "", WORKER_NOW + 11);
    const stopped = await workerStore.deploymentStatus("standalone", WORKER_FINGERPRINT, WORKER_NOW + 12);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.healthy, false);
    assert.equal(stopped.lastErrorCode, "worker_stopped");

    const mismatchedWorker = {
      ...localWorker,
      deploymentFingerprint: "e".repeat(64)
    };
    await assert.rejects(
      workerStore.ensureSchedules(mismatchedWorker, WORKER_NOW + 13),
      /does not match/
    );
    await workerStore.heartbeat(mismatchedWorker, "worker_deployment_mismatch", WORKER_NOW + 13);
    const mismatchedStatus = await workerStore.deploymentStatus(
      "standalone",
      WORKER_FINGERPRINT,
      WORKER_NOW + 14
    );
    assert.equal(mismatchedStatus.healthy, false);
    assert.equal(mismatchedStatus.lastErrorCode, "worker_deployment_mismatch");
  } finally {
    await postgres.close();
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

test("corruption and reused schemas fail closed without replacing a verified cutover receipt", async () => {
  const paths = createPostgresCutoverFixture();
  const postgres = new PgliteCutoverDatabase();
  try {
    const imported = await importPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_guard");
    await assert.rejects(
      importPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_guard"),
      /schema|exist|duplicate/i
    );
    const afterDuplicate = await verifyPostgresCutoverArchive(postgres, paths.archivePath, "yoink_cutover_guard");
    assert.equal(afterDuplicate.matched, true);
    assert.equal(afterDuplicate.receipt.sourceDataSha256, imported.receipt.sourceDataSha256);

    const corruptPath = join(paths.directory, "corrupt.yoink.ndjson");
    const corrupt = readFileSync(paths.archivePath, "utf8").replace("Other cutover tenant", "Poisoned cutover tenant");
    writeFileSync(corruptPath, corrupt, { mode: 0o600 });
    await assert.rejects(
      importPostgresCutoverArchive(postgres, corruptPath, "yoink_cutover_corrupt"),
      /hash/i
    );
    const absent = await postgres.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM pg_namespace WHERE nspname = 'yoink_cutover_corrupt'"
    );
    assert.equal(absent.rows[0]?.count, 0);
  } finally {
    await postgres.close();
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

test("PostgreSQL connection configuration keeps TLS explicit and loopback-only exceptions bounded", () => {
  assert.deepEqual(
    loadPostgresCutoverConnectionConfig({
      YOINK_POSTGRES_URL: "postgresql://yoink@db.internal/yoink",
      YOINK_POSTGRES_TLS_MODE: "verify-full"
    }),
    {
      connectionString: "postgresql://yoink@db.internal/yoink",
      tlsMode: "verify-full",
      certificateAuthorityPem: ""
    }
  );
  assert.equal(
    loadPostgresCutoverConnectionConfig({
      YOINK_POSTGRES_URL: "postgresql://yoink@127.0.0.1/yoink",
      YOINK_POSTGRES_TLS_MODE: "local-insecure"
    }).tlsMode,
    "local-insecure"
  );
  assert.throws(
    () => loadPostgresCutoverConnectionConfig({
      YOINK_POSTGRES_URL: "postgresql://yoink@db.internal/yoink",
      YOINK_POSTGRES_TLS_MODE: "local-insecure"
    }),
    /loopback/
  );
  assert.throws(
    () => loadPostgresCutoverConnectionConfig({
      YOINK_POSTGRES_URL: "postgresql://yoink@db.internal/yoink?sslmode=disable"
    }),
    /TLS policy/
  );
  assert.throws(() => loadPostgresCutoverConnectionConfig({}), /YOINK_POSTGRES_URL/);
});

test("PostgreSQL qualification pools accept only bounded connection counts and application names", async () => {
  const config = {
    connectionString: "postgresql://yoink@127.0.0.1/yoink",
    tlsMode: "local-insecure" as const,
    certificateAuthorityPem: ""
  };
  assert.throws(
    () => new NodePostgresCutoverDatabase(config, { maxConnections: 3 as 1 }),
    /qualification options/
  );
  assert.throws(
    () => new NodePostgresCutoverDatabase(config, {
      applicationName: "unbounded_client" as "yoink_postgres_cutover"
    }),
    /qualification options/
  );
  assert.throws(
    () => new NodePostgresCutoverDatabase(config, { transactionIsolation: "read-committed" }),
    /qualification options/
  );
  assert.throws(
    () => new NodePostgresCutoverDatabase(config, {
      applicationName: "yoink_postgres_fleet_qualification",
      transactionIsolation: "serializable"
    }),
    /qualification options/
  );
  const bounded = new NodePostgresCutoverDatabase(config, {
    maxConnections: 1,
    applicationName: "yoink_postgres_fleet_qualification"
  });
  await bounded.close();
});
