import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildPostgresHostedDeliveryLeaseRecoveryManifest } from "../packages/database/src/postgres-hosted-delivery-lease-recovery.js";
import { buildPostgresSignalAttributionReceiptApplyManifest } from "../packages/database/src/postgres-signal-attribution-receipt-apply.js";
import {
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
  buildPostgresSignalEvaluationCompositionManifest
} from "../packages/database/src/postgres-signal-evaluation-composition.js";
import * as evaluationRepositoryCompositionModule from "../packages/database/src/postgres-signal-evaluation-repository-composition.js";
import {
  POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_LENGTH,
  POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_ORDER,
  POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION,
  POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_DELEGATED_BOUNDARIES,
  POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES,
  POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES,
  POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT,
  buildPostgresSignalEvaluationRepositoryCompositionManifest,
  postgresSignalEvaluationRepositoryCompositionCapabilityProjection
} from "../packages/database/src/postgres-signal-evaluation-repository-composition.js";
import { buildPostgresSignalJobLifecycleApplyManifest } from "../packages/database/src/postgres-signal-job-lifecycle-apply.js";
import { buildPostgresSignalReservationLifecycleApplyManifest } from "../packages/database/src/postgres-signal-reservation-lifecycle-apply.js";
import { buildPostgresSignalTargetQualificationApplyManifest } from "../packages/database/src/postgres-signal-target-qualification-apply.js";

test("the signal evaluation-repository composition manifest is deterministic and chains all five boundaries exactly once", () => {
  const manifest = buildPostgresSignalEvaluationRepositoryCompositionManifest();
  assert.deepEqual(buildPostgresSignalEvaluationRepositoryCompositionManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(manifest.schemaName, manifest.jobLifecycleApplyManifest.schemaName);

  // Every one of the five named boundaries appears exactly once, in the
  // declared structural order, with a unique fingerprint.
  assert.equal(manifest.chain.length, POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_LENGTH);
  assert.equal(manifest.chainBoundaryCount, 5);
  assert.deepEqual(manifest.chain.map((entry) => entry.boundary), [
    ...POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_ORDER
  ]);
  assert.equal(new Set(manifest.chain.map((entry) => entry.boundary)).size, 5);
  assert.equal(new Set(manifest.chain.map((entry) => entry.fingerprint)).size, 5);
  for (const entry of manifest.chain) {
    assert.match(entry.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(typeof entry.contractVersion, "number");
  }

  // Each independently-rebuilt member's own fingerprint matches what this
  // composition recorded for it.
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "hostedDeliveryLeaseRecovery")?.fingerprint,
    buildPostgresHostedDeliveryLeaseRecoveryManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "evaluationApplyComposition")?.fingerprint,
    buildPostgresSignalEvaluationCompositionManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "reservationLifecycleApply")?.fingerprint,
    buildPostgresSignalReservationLifecycleApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "attributionReceiptApply")?.fingerprint,
    buildPostgresSignalAttributionReceiptApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "jobLifecycleApply")?.fingerprint,
    buildPostgresSignalJobLifecycleApplyManifest().fingerprint
  );

  // hostedDeliveryLeaseRecovery is the one chain member whose own
  // capability projection (what this composition actually reads, per
  // header section 7) declares mutationAuthority: false at both the
  // manifest AND capability-projection level -- a design choice of that
  // module (its role is scoped to recovery housekeeping, not tenant
  // business-mutation authority), not reinterpreted here. Every other
  // member's own capability projection declares it true.
  for (const entry of manifest.chain) {
    if (entry.boundary === "hostedDeliveryLeaseRecovery") {
      assert.equal(entry.mutationAuthority, false);
    } else {
      assert.equal(entry.mutationAuthority, true);
    }
  }

  // Writer-track-B convergence proof (header section 3): the residual
  // writers' lineage is rooted, ten hops up, at the exact same
  // actionSpendApply node rung-1's own chain terminates in.
  assert.equal(
    buildPostgresSignalTargetQualificationApplyManifest().actionSpendApplyManifestFingerprint,
    manifest.evaluationApplyCompositionManifest.actionSpendApplyManifest.fingerprint
  );
  assert.equal(manifest.writerTrackConvergenceVerified, true);

  assert.equal(manifest.noNewRoleCreated, true);
  assert.equal(manifest.noNewFunctionCreated, true);
  assert.equal(manifest.noNewMutationPath, true);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, true);
  assert.equal(manifest.signalEvaluationRepositoryParity, true);
  assert.equal(manifest.signalIngressRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.allHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.ok(manifest.knownOutOfScopeWrites.length >= 3);
});

test("the signal evaluation-repository composition family coverage is total, with rung-1's ten families delegated", () => {
  assert.equal(POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.length, POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILY_COUNT);
  assert.equal(POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.length, 5);
  assert.equal(POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT, 10);

  const manifest = buildPostgresSignalEvaluationRepositoryCompositionManifest();
  assert.equal(manifest.ownFamilyCount, 5);
  assert.equal(manifest.delegatedFamilyCount, 10);
  assert.equal(manifest.totalFamilyCount, 15);

  // Every own-family name is unique, maps to a chained boundary, and a
  // "plan" family names zero write tables (it performs none) while every
  // "mutation" family names at least one.
  const familyNames = POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.map((entry) => entry.family);
  assert.equal(new Set(familyNames).size, familyNames.length);
  const chainKeySet = new Set(POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_ORDER);
  for (const entry of POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES) {
    assert.ok(chainKeySet.has(entry.boundary), `${entry.family} must map to a chained boundary`);
    assert.ok(entry.sqliteSource.length > 0);
    if (entry.kind === "plan") {
      assert.equal(entry.sqliteTables.length, 0, `${entry.family} is a plan family and must name zero write tables`);
    } else {
      assert.ok(entry.sqliteTables.length > 0, `${entry.family} is a mutation family and must cite at least one table`);
    }
  }
  assert.equal(POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.filter((entry) => entry.kind === "plan").length, 1);
  assert.equal(POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.filter((entry) => entry.kind === "mutation").length, 4);

  // The union of own-family owners and the delegated boundary covers the
  // full five-member chain -- nothing left over, nothing missing.
  const coveredBoundaries = new Set([
    ...POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES.map((entry) => entry.boundary),
    ...POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_DELEGATED_BOUNDARIES
  ]);
  assert.deepEqual([...coveredBoundaries].sort(), [...chainKeySet].sort());
  const unmapped = POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CHAIN_ORDER.filter((key) => !coveredBoundaries.has(key));
  assert.deepEqual(unmapped, []);

  assert.deepEqual([...POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_DELEGATED_BOUNDARIES], ["evaluationApplyComposition"]);
  // TypeScript itself proves (via the `as const satisfies` literal-union
  // inference on POSTGRES_SIGNAL_EVALUATION_REPOSITORY_OWN_FAMILIES) that no
  // own family's `boundary` is "evaluationApplyComposition"; a runtime
  // `.boundary === "evaluationApplyComposition"` comparison against that
  // narrowed union is therefore a compile-time error (TS2367), not
  // something to assert here.

  assert.ok(POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("inbox_messages")
  ));
  assert.ok(POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("NotificationRepository")
  ));
  assert.ok(POSTGRES_SIGNAL_EVALUATION_REPOSITORY_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("upsertListing")
  ));
});

test("the signal evaluation-repository composition capability projection is qualified-inactive with the closed and still-open flags", () => {
  const capability = postgresSignalEvaluationRepositoryCompositionCapabilityProjection();
  assert.deepEqual(postgresSignalEvaluationRepositoryCompositionCapabilityProjection(), capability);
  assert.equal(capability.contractVersion, POSTGRES_SIGNAL_EVALUATION_REPOSITORY_COMPOSITION_CONTRACT_VERSION);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.writerTrackConvergenceVerified, true);
  assert.equal(capability.chainBoundaryCount, 5);
  assert.equal(capability.ownFamilyCount, 5);
  assert.equal(capability.delegatedFamilyCount, 10);
  assert.equal(capability.totalFamilyCount, 15);
  assert.equal(capability.unmappedOwnFamilyCount, 0);
  assert.equal(capability.noNewRoleCreated, true);
  assert.equal(capability.noNewFunctionCreated, true);
  assert.equal(capability.noNewMutationPath, true);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, true);
  assert.equal(capability.signalEvaluationRepositoryParity, true);
  assert.equal(capability.signalIngressRepositoryParity, false);
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
    buildPostgresSignalEvaluationRepositoryCompositionManifest().fingerprint
  );
});

test("the signal evaluation-repository composition module generates no SQL of its own to parse-probe", async () => {
  // Every one of this module's five bound members already owns a PGlite
  // parse-probe test for its own generated SQL (see header section 7):
  // postgres-signal-evaluation-composition.test.ts for rung-1's eleven, plus
  // the four sibling *-apply.test.ts files. This module is composition-only.
  const exportedNames = Object.keys(evaluationRepositoryCompositionModule);
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
