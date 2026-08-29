import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { BACKGROUND_TASK_KINDS } from "../packages/domain/src/background-task.js";
import { buildPostgresObserverWitnessRefreshManifest } from "../packages/database/src/postgres-observer-witness-refresh.js";
import { buildPostgresSignalDeadLetterResetApplyManifest } from "../packages/database/src/postgres-signal-dead-letter-reset-apply.js";
import { buildPostgresSignalIngressCompositionManifest } from "../packages/database/src/postgres-signal-ingress-composition.js";
import * as handlerCompositionModule from "../packages/database/src/postgres-signal-handler-composition.js";
import {
  POSTGRES_SIGNAL_HANDLER_COMPOSITION_CHAIN_LENGTH,
  POSTGRES_SIGNAL_HANDLER_COMPOSITION_CHAIN_ORDER,
  POSTGRES_SIGNAL_HANDLER_COMPOSITION_CONTRACT_VERSION,
  POSTGRES_SIGNAL_HANDLER_COMPOSITION_DELEGATED_BOUNDARIES,
  POSTGRES_SIGNAL_HANDLER_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES,
  POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILIES,
  POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILY_COUNT,
  buildPostgresSignalHandlerCompositionManifest,
  postgresSignalHandlerCompositionCapabilityProjection,
  verifyPostgresSignalHandlerCompositionBoundary,
  type PostgresSignalHandlerCompositionManifest
} from "../packages/database/src/postgres-signal-handler-composition.js";

test("the signal-handler composition manifest is deterministic and chains all four boundaries exactly once", () => {
  const manifest = buildPostgresSignalHandlerCompositionManifest();
  assert.deepEqual(buildPostgresSignalHandlerCompositionManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_HANDLER_COMPOSITION_CONTRACT_VERSION);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(manifest.schemaName, manifest.observerWitnessRefreshManifest.schemaName);
  assert.equal(manifest.schemaName, manifest.signalIngressCompositionManifest.schemaName);
  assert.equal(manifest.schemaName, manifest.deadLetterResetApplyManifest.schemaName);

  // Every one of the three named boundaries appears exactly once, in the
  // declared structural order, with a unique fingerprint.
  assert.equal(manifest.chain.length, POSTGRES_SIGNAL_HANDLER_COMPOSITION_CHAIN_LENGTH);
  assert.equal(manifest.chainBoundaryCount, 4);
  assert.deepEqual(manifest.chain.map((entry) => entry.boundary), [
    ...POSTGRES_SIGNAL_HANDLER_COMPOSITION_CHAIN_ORDER
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
    manifest.chain.find((entry) => entry.boundary === "observerWitnessRefresh")?.fingerprint,
    buildPostgresObserverWitnessRefreshManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "signalIngressComposition")?.fingerprint,
    buildPostgresSignalIngressCompositionManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "deadLetterResetApply")?.fingerprint,
    buildPostgresSignalDeadLetterResetApplyManifest().fingerprint
  );

  // observerWitnessRefresh is the one chain member whose own capability
  // projection declares mutationAuthority: false (a design choice of that
  // module -- two-phase external I/O plus a receipt write, not reinterpreted
  // here). The other two declare it true.
  for (const entry of manifest.chain) {
    if (entry.boundary === "observerWitnessRefresh") {
      assert.equal(entry.mutationAuthority, false);
    } else {
      assert.equal(entry.mutationAuthority, true);
    }
  }

  // Two convergence proofs (header section 5): each directly-bound member is
  // the exact same node reachable through the other member's own
  // predecessor/embedded fingerprints -- one connected graph, not three
  // disconnected islands.
  assert.equal(
    manifest.observerWitnessRefreshManifest.fingerprint,
    manifest.signalIngressCompositionManifest.hostedDeliveryLeaseRecoveryManifest.witnessRefreshManifestFingerprint
  );
  assert.equal(
    manifest.deadLetterResetApplyManifest.jobLifecycleApplyManifestFingerprint,
    manifest.signalIngressCompositionManifest.evaluationRepositoryCompositionManifest.jobLifecycleApplyManifest
      .fingerprint
  );
  assert.equal(manifest.witnessRefreshConvergenceVerified, true);
  assert.equal(manifest.deadLetterResetAncestryConvergenceVerified, true);

  assert.equal(manifest.noNewRoleCreated, true);
  assert.equal(manifest.noNewFunctionCreated, true);
  assert.equal(manifest.noNewMutationPath, true);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, true);
  assert.equal(manifest.signalEvaluationRepositoryParity, true);
  assert.equal(manifest.signalIngressRepositoryParity, true);
  // The central closure: every bound member (asserted individually below)
  // still declares these false at its own level; only this composition --
  // by binding the six-handler-family chain, the hosted-delivery/ingress
  // chain, and the dead-letter-reset residual together -- can honestly flip
  // them.
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, true);
  assert.equal(manifest.allHandlerRepositoryParity, true);
  assert.equal(buildPostgresObserverWitnessRefreshManifest().allHandlerRepositoryParity, false);
  assert.equal(buildPostgresSignalIngressCompositionManifest().hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(buildPostgresSignalIngressCompositionManifest().allHandlerRepositoryParity, false);
  assert.equal(buildPostgresSignalDeadLetterResetApplyManifest().hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(buildPostgresSignalDeadLetterResetApplyManifest().allHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.ok(manifest.knownOutOfScopeWrites.length >= 2);
});

test("the signal-handler composition boundary verify fails closed on manifest drift before touching the database", async () => {
  const manifest = buildPostgresSignalHandlerCompositionManifest();
  const tampered: PostgresSignalHandlerCompositionManifest = {
    ...manifest,
    fingerprint: "0".repeat(64)
  };
  // buildPostgresSignalHandlerCompositionManifest() is re-derived and
  // compared against the passed-in (tampered) manifest BEFORE any database
  // call is made -- so this rejects without ever touching the `database`
  // argument, and a deliberately invalid placeholder is safe to pass here.
  await assert.rejects(
    () => verifyPostgresSignalHandlerCompositionBoundary(
      null as unknown as Parameters<typeof verifyPostgresSignalHandlerCompositionBoundary>[0],
      tampered
    ),
    /drifted from its live sub-boundaries/
  );
});

test("the signal-handler composition task-kind coverage maps every real BACKGROUND_TASK_KINDS entry exactly once", () => {
  const manifest = buildPostgresSignalHandlerCompositionManifest();

  // Asserted against the REAL imported constant, not a copied list.
  assert.equal(manifest.taskKindCount, BACKGROUND_TASK_KINDS.length);
  assert.equal(manifest.unmappedTaskKindCount, 0);
  assert.equal(manifest.taskKindMapping.length, BACKGROUND_TASK_KINDS.length);
  assert.deepEqual(
    [...manifest.taskKindMapping.map((row) => row.taskKind)].sort(),
    [...BACKGROUND_TASK_KINDS].sort()
  );
  assert.equal(new Set(manifest.taskKindMapping.map((row) => row.taskKind)).size, BACKGROUND_TASK_KINDS.length);

  const chainKeySet = new Set(POSTGRES_SIGNAL_HANDLER_COMPOSITION_CHAIN_ORDER);
  for (const row of manifest.taskKindMapping) {
    assert.ok(chainKeySet.has(row.boundary), `${row.taskKind} must map to a chained boundary`);
    assert.ok(row.sqliteSource.length > 0);
    assert.ok(row.qualifiedModule.length > 0);
    // Never the dead-letter-reset or notification-ensure residuals: neither
    // is BACKGROUND_TASK_KINDS dispatch at all (header section 4).
    assert.notEqual(row.boundary, "deadLetterResetApply");
    assert.notEqual(row.boundary, "notificationEnsureApply");
  }

  // hosted_delivery_recovery is the one task kind covered through the
  // hosted-delivery/ingress chain; the remaining six are covered through the
  // six-handler-family chain's tip.
  const hostedDeliveryRow = manifest.taskKindMapping.find((row) => row.taskKind === "hosted_delivery_recovery");
  assert.equal(hostedDeliveryRow?.boundary, "signalIngressComposition");
  const otherRows = manifest.taskKindMapping.filter((row) => row.taskKind !== "hosted_delivery_recovery");
  assert.equal(otherRows.length, 6);
  for (const row of otherRows) {
    assert.equal(row.boundary, "observerWitnessRefresh");
  }

  // Each row claiming observerWitnessRefresh is corroborated by that
  // member's own live-built qualifiedHandlerTaskKinds; the
  // hosted_delivery_recovery row is corroborated by
  // hostedDeliveryLeaseRecoveryManifest's own boundaryHandlerTaskKinds.
  const witnessRefreshTaskKinds = new Set<string>(manifest.observerWitnessRefreshManifest.qualifiedHandlerTaskKinds);
  for (const row of otherRows) {
    assert.ok(witnessRefreshTaskKinds.has(row.taskKind));
  }
  assert.deepEqual(
    [...manifest.signalIngressCompositionManifest.hostedDeliveryLeaseRecoveryManifest.boundaryHandlerTaskKinds],
    ["hosted_delivery_recovery"]
  );
});

test("the signal-handler composition family coverage is total, with witness-refresh and rung-3 delegated", () => {
  assert.equal(
    POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILIES.length,
    POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILY_COUNT
  );
  assert.equal(POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILIES.length, 2);

  const manifest = buildPostgresSignalHandlerCompositionManifest();
  assert.equal(manifest.ownFamilyCount, 2);
  assert.equal(manifest.unmappedOwnFamilyCount, 0);
  assert.equal(manifest.unmappedChainBoundaryCount, 0);

  const familyNames = POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILIES.map((entry) => entry.family);
  assert.equal(new Set(familyNames).size, familyNames.length);
  const chainKeySet = new Set(POSTGRES_SIGNAL_HANDLER_COMPOSITION_CHAIN_ORDER);
  for (const entry of POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILIES) {
    assert.ok(chainKeySet.has(entry.boundary), `${entry.family} must map to a chained boundary`);
    assert.ok(entry.sqliteSource.length > 0);
    assert.ok(entry.sqliteTables.length > 0, `${entry.family} must cite at least one table`);
  }

  // The union of own-family owners and the delegated boundaries covers the
  // full three-member chain -- nothing left over, nothing missing.
  const coveredBoundaries = new Set([
    ...POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILIES.map((entry) => entry.boundary),
    ...POSTGRES_SIGNAL_HANDLER_COMPOSITION_DELEGATED_BOUNDARIES
  ]);
  assert.deepEqual([...coveredBoundaries].sort(), [...chainKeySet].sort());
  const unmapped = POSTGRES_SIGNAL_HANDLER_COMPOSITION_CHAIN_ORDER.filter((key) => !coveredBoundaries.has(key));
  assert.deepEqual(unmapped, []);

  assert.deepEqual(
    [...POSTGRES_SIGNAL_HANDLER_COMPOSITION_DELEGATED_BOUNDARIES].sort(),
    ["observerWitnessRefresh", "signalIngressComposition"].sort()
  );

  // ensureForJob is no longer out of scope: the notification-ensure writer
  // qualified it and this composition binds that writer as its fourth member.
  assert.ok(!POSTGRES_SIGNAL_HANDLER_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("ensureForJob")
  ));
  assert.ok(POSTGRES_SIGNAL_HANDLER_COMPOSITION_OWN_FAMILIES.some(
    (entry) => entry.boundary === "notificationEnsureApply"
  ));
  assert.ok(POSTGRES_SIGNAL_HANDLER_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("upsertListing")
  ));
  assert.ok(POSTGRES_SIGNAL_HANDLER_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("DISPATCH mechanism")
  ));
});

test("the signal-handler composition capability projection is qualified-inactive with every flag closed", () => {
  const capability = postgresSignalHandlerCompositionCapabilityProjection();
  assert.deepEqual(postgresSignalHandlerCompositionCapabilityProjection(), capability);
  assert.equal(capability.contractVersion, POSTGRES_SIGNAL_HANDLER_COMPOSITION_CONTRACT_VERSION);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.witnessRefreshConvergenceVerified, true);
  assert.equal(capability.deadLetterResetAncestryConvergenceVerified, true);
  assert.equal(capability.chainBoundaryCount, 4);
  assert.equal(capability.taskKindCount, BACKGROUND_TASK_KINDS.length);
  assert.equal(capability.unmappedTaskKindCount, 0);
  assert.equal(capability.ownFamilyCount, 2);
  assert.equal(capability.unmappedOwnFamilyCount, 0);
  assert.equal(capability.noNewRoleCreated, true);
  assert.equal(capability.noNewFunctionCreated, true);
  assert.equal(capability.noNewMutationPath, true);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, true);
  assert.equal(capability.signalEvaluationRepositoryParity, true);
  assert.equal(capability.signalIngressRepositoryParity, true);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, true);
  assert.equal(capability.allHandlerRepositoryParity, true);
  assert.equal(capability.activePrincipalCount, 0);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.match(capability.roleTemplateFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    capability.roleTemplateFingerprint,
    buildPostgresSignalHandlerCompositionManifest().fingerprint
  );
});

test("the signal-handler composition module generates no SQL of its own to parse-probe", async () => {
  // Every one of this module's three bound members (and, transitively,
  // every module in the eight-hop handler-family chain and the
  // rung-1/rung-2/rung-3 lineage) already owns a PGlite parse-probe test for
  // its own generated SQL elsewhere in this repository. This module is
  // composition-only.
  const exportedNames = Object.keys(handlerCompositionModule);
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
