import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION,
  buildPostgresSignalActionSpendApplyManifest,
  signalActionSpendApplyFunctionSource
} from "../packages/database/src/postgres-signal-action-spend-apply.js";
import {
  buildPostgresSignalCatalogApplyManifest,
  signalCatalogApplyFunctionSource
} from "../packages/database/src/postgres-signal-catalog-apply.js";
import {
  buildPostgresSignalConstraintConfigApplyManifest,
  signalConstraintConfigApplyFunctionSource
} from "../packages/database/src/postgres-signal-constraint-config-apply.js";
import {
  buildPostgresSignalMissionBindingApplyManifest,
  signalMissionBindingApplyFunctionSource
} from "../packages/database/src/postgres-signal-mission-binding-apply.js";
import {
  buildPostgresSignalOfferIncidentApplyManifest,
  signalOfferIncidentApplyFunctionSource
} from "../packages/database/src/postgres-signal-offer-incident-apply.js";
import {
  buildPostgresSignalPostIncidentDecisionApplyManifest,
  signalPostIncidentDecisionApplyFunctionSource
} from "../packages/database/src/postgres-signal-post-incident-decision-apply.js";
import {
  buildPostgresSignalResolutionApplyManifest,
  signalResolutionApplyFunctionSource
} from "../packages/database/src/postgres-signal-resolution-apply.js";
import {
  buildPostgresSignalSourceReferenceRefreshManifest,
  signalSourceReferenceRefreshFunctionSource
} from "../packages/database/src/postgres-signal-source-reference-refresh.js";
import {
  buildPostgresSignalStrategyEvaluationApplyManifest,
  signalStrategyEvaluationApplyFunctionSource
} from "../packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import {
  buildPostgresSignalTerminalDecisionApplyManifest,
  signalTerminalDecisionApplyFunctionSource
} from "../packages/database/src/postgres-signal-terminal-decision-apply.js";
import {
  buildPostgresSignalWriterLockProtocolManifest,
  signalWriterLockProtocolFunctionSource
} from "../packages/database/src/postgres-signal-writer-lock-protocol.js";
import {
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT,
  POSTGRES_SIGNAL_EVALUATION_COMPOSITION_WRITER_DISCIPLINE_BOUNDARIES,
  POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES,
  buildPostgresSignalEvaluationCompositionManifest,
  postgresSignalEvaluationCompositionCapabilityProjection
} from "../packages/database/src/postgres-signal-evaluation-composition.js";

test("the signal evaluation composition manifest is deterministic and chains all eleven boundaries exactly once", () => {
  const manifest = buildPostgresSignalEvaluationCompositionManifest();
  assert.deepEqual(buildPostgresSignalEvaluationCompositionManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION);
  assert.equal(manifest.actionSpendApplyContractVersion, POSTGRES_SIGNAL_ACTION_SPEND_APPLY_CONTRACT_VERSION);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(manifest.schemaName, manifest.actionSpendApplyManifest.schemaName);

  // Every one of the eleven named boundaries appears exactly once, in the
  // structural predecessor order, with a unique fingerprint.
  assert.equal(manifest.chain.length, POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_LENGTH);
  assert.equal(manifest.chainBoundaryCount, 11);
  assert.deepEqual(manifest.chain.map((entry) => entry.boundary), [
    ...POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER
  ]);
  assert.equal(new Set(manifest.chain.map((entry) => entry.boundary)).size, 11);
  assert.equal(new Set(manifest.chain.map((entry) => entry.fingerprint)).size, 11);
  for (const entry of manifest.chain) {
    assert.match(entry.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(typeof entry.contractVersion, "number");
  }

  // Cross-boundary sequence contract: each independently-rebuilt boundary's
  // own fingerprint matches what its declared successor recorded.
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "catalogApply")?.fingerprint,
    buildPostgresSignalCatalogApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "resolutionApply")?.fingerprint,
    buildPostgresSignalResolutionApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "sourceReferenceRefresh")?.fingerprint,
    buildPostgresSignalSourceReferenceRefreshManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "terminalDecisionApply")?.fingerprint,
    buildPostgresSignalTerminalDecisionApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "offerIncidentApply")?.fingerprint,
    buildPostgresSignalOfferIncidentApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "postIncidentDecisionApply")?.fingerprint,
    buildPostgresSignalPostIncidentDecisionApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "missionBindingApply")?.fingerprint,
    buildPostgresSignalMissionBindingApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "strategyEvaluationApply")?.fingerprint,
    buildPostgresSignalStrategyEvaluationApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "writerLockProtocol")?.fingerprint,
    buildPostgresSignalWriterLockProtocolManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "constraintConfigApply")?.fingerprint,
    buildPostgresSignalConstraintConfigApplyManifest().fingerprint
  );
  assert.equal(
    manifest.chain.find((entry) => entry.boundary === "actionSpendApply")?.fingerprint,
    buildPostgresSignalActionSpendApplyManifest().fingerprint
  );

  // mutationAuthority is true for every composed boundary except the
  // lock-only writer-lock-protocol.
  for (const entry of manifest.chain) {
    if (entry.boundary === "writerLockProtocol") {
      assert.equal(entry.mutationAuthority, false);
    } else {
      assert.equal(entry.mutationAuthority, true);
    }
  }

  assert.equal(manifest.noNewRoleCreated, true);
  assert.equal(manifest.noNewFunctionCreated, true);
  assert.equal(manifest.noNewMutationPath, true);
  assert.equal(manifest.signalEvaluationApplyRepositoryParity, true);
  assert.equal(manifest.signalEvaluationRepositoryParity, false);
  assert.equal(manifest.signalIngressRepositoryParity, false);
  assert.equal(manifest.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(manifest.allHandlerRepositoryParity, false);
  assert.equal(manifest.mutationAuthority, true);
  assert.equal(manifest.activePrincipalCount, 0);
  assert.equal(manifest.runtimeAuthority, false);
  assert.ok(manifest.knownOutOfScopeWrites.length >= 4);
});

test("the signal evaluation composition mutation-family coverage is total with zero unmapped families", () => {
  assert.equal(POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES.length, POSTGRES_SIGNAL_EVALUATION_COMPOSITION_MUTATION_FAMILY_COUNT);
  assert.equal(POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES.length, 10);

  // Every family name is unique, cites at least one SQLite table, and maps
  // to exactly one boundary drawn from the eleven-member chain.
  const familyNames = POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES.map((entry) => entry.family);
  assert.equal(new Set(familyNames).size, familyNames.length);
  const chainKeySet = new Set(POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER);
  for (const entry of POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES) {
    assert.ok(entry.sqliteTables.length > 0, `${entry.family} must cite at least one SQLite table`);
    assert.ok(chainKeySet.has(entry.boundary), `${entry.family} must map to a chained boundary`);
    assert.ok(entry.sqliteSource.length > 0);
  }

  // The union of mutation-family owners and the two writer-discipline
  // boundaries covers the full eleven-member chain — nothing left over,
  // nothing missing.
  const coveredBoundaries = new Set([
    ...POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES.map((entry) => entry.boundary),
    ...POSTGRES_SIGNAL_EVALUATION_COMPOSITION_WRITER_DISCIPLINE_BOUNDARIES
  ]);
  assert.deepEqual(
    [...coveredBoundaries].sort(),
    [...chainKeySet].sort()
  );
  const unmapped = POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CHAIN_ORDER.filter((key) => !coveredBoundaries.has(key));
  assert.deepEqual(unmapped, []);

  // The writer-discipline boundaries are exactly writerLockProtocol and
  // constraintConfigApply, and neither owns a mutation family of its own
  // (writer-lock has zero mutation tables; constraint-config's writes are
  // operator-driven configuration, not signal-triggered).
  assert.deepEqual([...POSTGRES_SIGNAL_EVALUATION_COMPOSITION_WRITER_DISCIPLINE_BOUNDARIES].sort(), [
    "constraintConfigApply", "writerLockProtocol"
  ]);
  // TypeScript itself proves (via the `as const satisfies` literal-union
  // inference on POSTGRES_SIGNAL_EVALUATION_MUTATION_FAMILIES) that no
  // family's `boundary` is "writerLockProtocol" or "constraintConfigApply";
  // a runtime `.boundary === "writerLockProtocol"` comparison against that
  // narrowed union is therefore a compile-time error (TS2367), not
  // something to assert here.
  assert.ok(familyNames.length === 10);

  assert.ok(POSTGRES_SIGNAL_EVALUATION_COMPOSITION_KNOWN_OUT_OF_SCOPE_WRITES.some(
    (entry) => entry.includes("attribution_receipts")
  ));
});

test("the signal evaluation composition capability projection is qualified-inactive with the closed and still-open flags", () => {
  const capability = postgresSignalEvaluationCompositionCapabilityProjection();
  assert.deepEqual(postgresSignalEvaluationCompositionCapabilityProjection(), capability);
  assert.equal(capability.contractVersion, POSTGRES_SIGNAL_EVALUATION_COMPOSITION_CONTRACT_VERSION);
  assert.equal(capability.deterministicManifestImplemented, true);
  assert.equal(capability.chainSequenceContractVerified, true);
  assert.equal(capability.chainBoundaryCount, 11);
  assert.equal(capability.mutationFamilyCount, 10);
  assert.equal(capability.unmappedMutationFamilyCount, 0);
  assert.equal(capability.noNewRoleCreated, true);
  assert.equal(capability.noNewFunctionCreated, true);
  assert.equal(capability.noNewMutationPath, true);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, true);
  assert.equal(capability.signalEvaluationRepositoryParity, false);
  assert.equal(capability.signalIngressRepositoryParity, false);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.allHandlerRepositoryParity, false);
  assert.equal(capability.activePrincipalCount, 0);
  assert.equal(capability.activeRuntimeRoleApplied, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);
  assert.match(capability.roleTemplateFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(capability.roleTemplateFingerprint, buildPostgresSignalEvaluationCompositionManifest().fingerprint);
});

test("the eleven composed boundaries' generated PL/pgSQL jointly parse in one database", async () => {
  const database = new PGlite();
  try {
    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_catalog_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalCatalogApplyFunctionSource(buildPostgresSignalCatalogApplyManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_resolution_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalResolutionApplyFunctionSource(buildPostgresSignalResolutionApplyManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_source_reference_refresh(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalSourceReferenceRefreshFunctionSource(buildPostgresSignalSourceReferenceRefreshManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_terminal_decision_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalTerminalDecisionApplyFunctionSource(buildPostgresSignalTerminalDecisionApplyManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_offer_incident_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalOfferIncidentApplyFunctionSource(buildPostgresSignalOfferIncidentApplyManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_post_incident_decision_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalPostIncidentDecisionApplyFunctionSource(buildPostgresSignalPostIncidentDecisionApplyManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_mission_binding_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalMissionBindingApplyFunctionSource(buildPostgresSignalMissionBindingApplyManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_strategy_evaluation_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalStrategyEvaluationApplyFunctionSource(buildPostgresSignalStrategyEvaluationApplyManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_writer_lock_protocol(
      expected_tenant_id text, expected_user_id text,
      source_connection_id_input text, retailer_id_input text,
      mission_id_input text, lock_mask text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalWriterLockProtocolFunctionSource(buildPostgresSignalWriterLockProtocolManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_constraint_config_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      request_id text, request_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalConstraintConfigApplyFunctionSource(buildPostgresSignalConstraintConfigApplyManifest())}
    $function$`);

    await database.exec(`CREATE FUNCTION public.yoink_eval_probe_action_spend_apply(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      authorization_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${signalActionSpendApplyFunctionSource(buildPostgresSignalActionSpendApplyManifest())}
    $function$`);

    const routines = await database.query<{ count: string | number | bigint }>(
      `SELECT COUNT(*) AS count FROM pg_catalog.pg_proc routine
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
       WHERE namespace.nspname = 'public' AND routine.proname LIKE 'yoink_eval_probe_%'`
    );
    assert.equal(Number((routines.rows[0] as { count: string | number | bigint }).count), 11);
  } finally {
    await database.close();
  }
});
