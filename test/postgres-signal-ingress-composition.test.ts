import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildPostgresHostedDeliveryLeaseRecoveryManifest } from "../packages/database/src/postgres-hosted-delivery-lease-recovery.js";
import * as ingressCompositionModule from "../packages/database/src/postgres-signal-ingress-composition.js";
import {
  POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_LENGTH,
  POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_ORDER,
  POSTGRES_SIGNAL_INGRESS_COMPOSITION_CONTRACT_VERSION,
  POSTGRES_SIGNAL_INGRESS_COMPOSITION_DELEGATED_BOUNDARIES,
  POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES,
  POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES,
  POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT,
  buildPostgresSignalIngressCompositionManifest,
  postgresSignalIngressCompositionCapabilityProjection,
  verifyPostgresSignalIngressCompositionBoundary,
  type PostgresSignalIngressCompositionManifest
} from "../packages/database/src/postgres-signal-ingress-composition.js";
import { buildPostgresSignalIngressEnqueueApplyManifest } from "../packages/database/src/postgres-signal-ingress-enqueue-apply.js";
import { buildPostgresSignalEvaluationRepositoryCompositionManifest } from "../packages/database/src/postgres-signal-evaluation-repository-composition.js";
import { buildPostgresTenantQueueWriteManifest } from "../packages/database/src/postgres-tenant-queue-writes.js";

test("the signal-ingress composition manifest is deterministic and chains all four boundaries exactly once", () => {
  const manifest = buildPostgresSignalIngressCompositionManifest();
  assert.deepEqual(buildPostgresSignalIngressCompositionManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_INGRESS_COMPOSITION_CONTRACT_VERSION);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(manifest.schemaName, manifest.ingressEnqueueApplyManifest.schemaName);
  assert.equal(manifest.schemaName, manifest.tenantQueueWriteManifest.schemaName);
  assert.equal(manifest.schemaName, manifest.hostedDeliveryLeaseRecoveryManifest.schemaName);
  assert.equal(manifest.schemaName, manifest.evaluationRepositoryCompositionManifest.schemaName);

  // Every one of the four named boundaries appears exactly once, in the
  // declared structural order, with a unique fingerprint.
  assert.equal(manifest.chain.length, POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_LENGTH);
  assert.equal(manifest.chainBoundaryCount, 4);
  assert.deepEqual(manifest.chain.map((entry) => entry.boundary), [
    ...POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_ORDER
  ]);
  assert.equal(new Set(manifest.chain.map((entry) => entry.boundary)).size, 4);
  assert.equal(new Set(manifest.chain.map((entry) => entry.fingerprint)).size, 4);
  for (const entry of manifest.chain) {
    assert.match(entry.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(typeof entry.contractVersion, "number");
  }

  // Each independently-rebuilt member's own fingerprint matches what this
  // composition recorded for it.
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "ingressEnqueueApply")?.fingerprint,
    buildPostgresSignalIngressEnqueueApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "tenantQueueWrite")?.fingerprint,
    buildPostgresTenantQueueWriteManifest(manifest.schemaName).fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "hostedDeliveryLeaseRecovery")?.fingerprint,
    buildPostgresHostedDeliveryLeaseRecoveryManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "evaluationRepositoryComposition")?.fingerprint,
    buildPostgresSignalEvaluationRepositoryCompositionManifest().fingerprint
  );

  // hostedDeliveryLeaseRecovery is the one chain member whose own capability
  // projection declares mutationAuthority: false (a design choice of that
  // module, not reinterpreted here -- see that module's own header and
  // rung-2's precedent test). Every other member declares it true.
  for (const entry of manifest.chain) {
    if (entry.boundary === "hostedDeliveryLeaseRecovery") {
      assert.equal(entry.mutationAuthority, false);
    } else {
      assert.equal(entry.mutationAuthority, true);
    }
  }

  // Three convergence proofs (header section 4): each directly-bound member
  // is the exact same node reachable through the other members' own
  // predecessor/embedded fingerprints -- one connected DAG, not four
  // disconnected islands.
  assert.equal(
    manifest.ingressEnqueueApplyManifest.attributionReceiptApplyManifestFingerprint,
    manifest.evaluationRepositoryCompositionManifest.attributionReceiptApplyManifest.fingerprint
  );
  assert.equal(
    manifest.ingressEnqueueApplyManifest.queueWriteManifestFingerprint,
    manifest.tenantQueueWriteManifest.fingerprint
  );
  assert.equal(
    manifest.hostedDeliveryLeaseRecoveryManifest.fingerprint,
    manifest.evaluationRepositoryCompositionManifest.hostedDeliveryLeaseRecoveryManifest.fingerprint
  );
  assert.equal(manifest.sharedAncestryConvergenceVerified, true);
  assert.equal(manifest.queueWriteConvergenceVerified, true);
  assert.equal(manifest.leaseRecoveryConvergenceVerified, true);

  assert.equal(manifest.noNewRoleCreated, true);
  assert.equal(manifest.noNewFunctionCreated, true);
  assert.equal(manifest.noNewMutationPath, true);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, true);
  assert.equal(manifest.signalEvaluationRepositoryParity, true);
  // The central closure: every precedent module (including this composition's
  // own bound members, asserted individually below) still declares this
  // false at its own level; only this composition -- by binding the accept
  // path, the task-wake path, the dequeue/lease/plan path, and the full
  // evaluation-repository chain together -- can honestly flip it.
  assert.equal(manifest.signalIngressRepositoryParity, true);
  assert.equal(buildPostgresSignalIngressEnqueueApplyManifest().signalIngressRepositoryParity, false);
  assert.equal(buildPostgresHostedDeliveryLeaseRecoveryManifest().signalIngressRepositoryParity, false);
  assert.equal(buildPostgresSignalEvaluationRepositoryCompositionManifest().signalIngressRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.allHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.ok(manifest.knownOutOfScopeWrites.length >= 4);
});

test("the signal-ingress composition boundary verify fails closed on manifest drift before touching the database", async () => {
  const manifest = buildPostgresSignalIngressCompositionManifest();
  const tampered: PostgresSignalIngressCompositionManifest = {
    ...manifest,
    fingerprint: "0".repeat(64)
  };
  // buildPostgresSignalIngressCompositionManifest() is re-derived and
  // compared against the passed-in (tampered) manifest BEFORE any database
  // call is made -- so this rejects without ever touching the `database`
  // argument, and a deliberately invalid placeholder is safe to pass here.
  await assert.rejects(
    () => verifyPostgresSignalIngressCompositionBoundary(
      null as unknown as Parameters<typeof verifyPostgresSignalIngressCompositionBoundary>[0],
      tampered
    ),
    /drifted from its live sub-boundaries/
  );
});

test("the signal-ingress composition family coverage is total, with lease-recovery and rung-2 delegated", () => {
  assert.equal(POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES.length, POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILY_COUNT);
  assert.equal(POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES.length, 2);

  const manifest = buildPostgresSignalIngressCompositionManifest();
  assert.equal(manifest.ownFamilyCount, 2);
  assert.equal(manifest.delegatedFamilyCount, manifest.evaluationRepositoryCompositionManifest.totalFamilyCount);
  assert.equal(manifest.delegatedFamilyCount, 15);
  assert.equal(manifest.totalFamilyCount, 17);

  // Every own-family name is unique, maps to a chained boundary, cites a
  // real sqlite source, and names at least one write table (both of this
  // module's own families are mutation families -- see header section 7).
  const familyNames = POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES.map((entry) => entry.family);
  assert.equal(new Set(familyNames).size, familyNames.length);
  const chainKeySet = new Set(POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_ORDER);
  for (const entry of POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES) {
    assert.ok(chainKeySet.has(entry.boundary), `${entry.family} must map to a chained boundary`);
    assert.ok(entry.sqliteSource.length > 0);
    assert.ok(entry.sqliteTables.length > 0, `${entry.family} must cite at least one table`);
  }

  // The union of own-family owners and the delegated boundaries covers the
  // full four-member chain -- nothing left over, nothing missing.
  const coveredBoundaries = new Set([
    ...POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES.map((entry) => entry.boundary),
    ...POSTGRES_SIGNAL_INGRESS_COMPOSITION_DELEGATED_BOUNDARIES
  ]);
  assert.deepEqual([...coveredBoundaries].sort(), [...chainKeySet].sort());
  const unmapped = POSTGRES_SIGNAL_INGRESS_COMPOSITION_CHAIN_ORDER.filter((key) => !coveredBoundaries.has(key));
  assert.deepEqual(unmapped, []);

  assert.deepEqual(
    [...POSTGRES_SIGNAL_INGRESS_COMPOSITION_DELEGATED_BOUNDARIES].sort(),
    ["evaluationRepositoryComposition", "hostedDeliveryLeaseRecovery"].sort()
  );
  // TypeScript itself proves (via the `as const satisfies` literal-union
  // inference on POSTGRES_SIGNAL_INGRESS_COMPOSITION_OWN_FAMILIES) that no
  // own family's `boundary` is "hostedDeliveryLeaseRecovery" or
  // "evaluationRepositoryComposition"; a runtime `.boundary === ...`
  // comparison against that narrowed union is therefore a compile-time
  // error (TS2367), not something to assert here.

  assert.ok(POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("NotificationRepository")
  ));
  assert.ok(POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("upsertListing")
  ));
  assert.ok(POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("retryDeadLetterInbox")
  ));
  assert.ok(POSTGRES_SIGNAL_INGRESS_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("BACKGROUND_TASK_KINDS")
  ));
});

test("the signal-ingress composition capability projection is qualified-inactive with the closed and still-open flags", () => {
  const capability = postgresSignalIngressCompositionCapabilityProjection();
  assert.deepEqual(postgresSignalIngressCompositionCapabilityProjection(), capability);
  assert.equal(capability.contractVersion, POSTGRES_SIGNAL_INGRESS_COMPOSITION_CONTRACT_VERSION);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.sharedAncestryConvergenceVerified, true);
  assert.equal(capability.queueWriteConvergenceVerified, true);
  assert.equal(capability.leaseRecoveryConvergenceVerified, true);
  assert.equal(capability.chainBoundaryCount, 4);
  assert.equal(capability.ownFamilyCount, 2);
  assert.equal(capability.delegatedFamilyCount, 15);
  assert.equal(capability.totalFamilyCount, 17);
  assert.equal(capability.unmappedOwnFamilyCount, 0);
  assert.equal(capability.noNewRoleCreated, true);
  assert.equal(capability.noNewFunctionCreated, true);
  assert.equal(capability.noNewMutationPath, true);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, true);
  assert.equal(capability.signalEvaluationRepositoryParity, true);
  assert.equal(capability.signalIngressRepositoryParity, true);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.allHandlerRepositoryParity, false);
  assert.equal(capability.activePrincipalCount, 0);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.match(capability.roleTemplateFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    capability.roleTemplateFingerprint,
    buildPostgresSignalIngressCompositionManifest().fingerprint
  );
});

test("the signal-ingress composition module generates no SQL of its own to parse-probe", async () => {
  // Every one of this module's four bound members already owns a PGlite
  // parse-probe test for its own generated SQL elsewhere in this
  // repository. This module is composition-only.
  const exportedNames = Object.keys(ingressCompositionModule);
  assert.deepEqual(exportedNames.filter((name) => name.endsWith("FunctionSource")), []);

  // A vacuous PGlite round-trip confirms the harness itself is reachable
  // from this test file, mirroring the joint-parse-probe form used
  // elsewhere without asserting anything false about this module's own
  // (nonexistent) generated SQL.
  const database = new PGlite();
  try {
    const result = await database.query<{ probe: number }>("SELECT 1 AS probe");
    assert.equal(Number((result.rows[0] as { probe: number }).probe), 1);
  } finally {
    await database.close();
  }
});
