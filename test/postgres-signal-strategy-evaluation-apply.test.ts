import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type {
  ListingContext,
  MissionContext,
  NormalizedSignal,
  PurchaseIntentPolicy,
  StrategyDefinition
} from "../packages/contracts/src/index.js";
import {
  POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION,
  POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION,
  buildPostgresSignalStrategyEvaluationApplyManifest,
  postgresSignalStrategyEvaluationApplyCapabilityProjection,
  postgresSignalStrategyEvaluationApplyPlanFingerprint,
  signalStrategyEvaluationApplyFunctionSource,
  type PostgresSignalStrategyEvaluationApplyPlan
} from "../packages/database/src/postgres-signal-strategy-evaluation-apply.js";
import {
  attestSignalPolicyEvaluation,
  signalPolicyEvaluationFingerprint,
  signalStrategySetFingerprint
} from "../packages/domain/src/signal-policy-evaluation.js";

const strategy: StrategyDefinition = {
  id: "strategy_primary",
  name: "Primary",
  enabled: true,
  position: 1,
  revision: 3,
  sources: ["trackalacker"],
  retailers: ["target"],
  pricePolicy: { kind: "absolute_max", maxPriceCents: 7_000 },
  sellerPolicy: "first_party_only",
  allowedSellers: ["target"],
  includeKeywords: "pokemon",
  excludeKeywords: "damaged",
  action: "add_to_cart",
  quantity: 2,
  fulfillment: "shipping",
  maxSignalAgeSeconds: 120
};

const signal: NormalizedSignal = {
  schemaVersion: 1,
  signalId: "signal_test",
  sourceConnectionId: "source_test",
  source: "trackalacker",
  externalEventId: "event_test",
  eventType: "restock",
  observedAt: "2026-08-26T20:00:00.000Z",
  receivedAt: "2026-08-26T20:00:01.000Z",
  test: false,
  identity: {
    sourceProductId: "product_test",
    sourceListingId: "source_listing_test",
    retailerId: "target",
    retailerSku: "12345678",
    canonicalUrl: "https://www.target.com/p/-/A-12345678",
    title: "Pokemon cards",
    globalIdentifiers: {}
  },
  offer: {
    availability: "in_stock",
    currency: "USD",
    sellerName: "Target",
    sellerType: "first_party",
    fulfillment: "shipping",
    unitPriceCents: 6_500,
    orderLimit: 3,
    offerFingerprint: "offer-test"
  },
  evidence: {
    headline: "Pokemon cards restocked",
    body: "Available now",
    msrpStatus: "below_msrp",
    clickUrl: "https://example.test/signal"
  },
  parserVersion: "test-v1",
  transportHash: "1".repeat(64),
  ephemeralOfferId: ""
};

const listing: ListingContext = {
  id: "listing_test",
  variantId: "variant_test",
  title: "Pokemon cards",
  retailerId: "target",
  retailerSku: "12345678",
  canonicalUrl: "https://www.target.com/p/-/A-12345678",
  executionSupported: true,
  msrpCents: 6_999,
  currency: "USD"
};

const mission: MissionContext = {
  id: "mission_test",
  status: "active",
  targetQuantity: 5,
  targetId: "mission_target_test",
  targetEnabled: true,
  maxUnitPriceCents: null,
  sellerPolicy: "inherit",
  fulfillment: "inherit"
};

const policy: PurchaseIntentPolicy = {
  id: "intent_revision_test",
  missionId: mission.id,
  revision: 1,
  quantity: 1,
  currency: "USD",
  maxAllInCents: null,
  actionCeiling: "add_to_cart",
  decisionMode: "strategy",
  maxSignalAgeSeconds: 120,
  substitutionPolicy: "exact_only",
  expiresAt: "",
  cooldownSeconds: 0,
  targets: [{
    targetId: mission.targetId,
    listingId: listing.id,
    retailerId: listing.retailerId,
    enabled: true,
    maxUnitPriceCents: null,
    sellerPolicy: "inherit",
    fulfillment: "inherit"
  }],
  policyHash: "2".repeat(64),
  changeReason: "Initial exact purchase policy.",
  createdByActorId: "worker_test",
  createdAt: "2026-08-26T19:59:00.000Z"
};

test("signal evaluation attestations bind the deterministic domain result and complete strategy set", () => {
  const attestation = attestSignalPolicyEvaluation({
    strategies: [strategy],
    policy,
    signal,
    listing,
    mission,
    sourceTrustLevel: "trusted_exact",
    now: Date.parse("2026-08-26T20:00:10.000Z")
  });
  assert.equal(attestation.state, "matched");
  assert.equal(attestation.strategyId, strategy.id);
  assert.equal(attestation.strategyRevision, 3);
  assert.equal(attestation.effectiveAction, "add_to_cart");
  assert.equal(attestation.effectiveQuantity, 2);
  assert.equal(attestation.missionEvaluationQuantity, 5);
  assert.equal(attestation.evaluationFingerprint, signalPolicyEvaluationFingerprint(attestation));
  const secondaryStrategy: StrategyDefinition = {
    ...strategy,
    id: "strategy_secondary",
    name: "Secondary",
    position: 2,
    revision: 1,
    action: "notify"
  };
  assert.equal(
    signalStrategySetFingerprint([strategy, secondaryStrategy]),
    signalStrategySetFingerprint([secondaryStrategy, strategy])
  );
  assert.notEqual(signalStrategySetFingerprint([strategy]), signalStrategySetFingerprint([secondaryStrategy]));
  assert.notEqual(
    signalStrategySetFingerprint([{ ...strategy, revision: 4 }]),
    attestation.strategySetFingerprint
  );

  const directPolicy = {
    ...policy,
    decisionMode: "purchase_intent" as const,
    targets: policy.targets.map((target) => ({ ...target, maxUnitPriceCents: 7_000 }))
  };
  const direct = attestSignalPolicyEvaluation({
    strategies: [strategy],
    policy: directPolicy,
    signal,
    listing,
    mission: { ...mission, targetQuantity: 1, maxUnitPriceCents: 7_000 },
    sourceTrustLevel: "informational",
    now: Date.parse("2026-08-26T20:00:10.000Z")
  });
  assert.equal(direct.sourceActionRestricted, true);
  assert.equal(direct.effectiveAction, "notify");
  assert.match(direct.reason, /informational/);
});

test("the PostgreSQL strategy-evaluation boundary is deterministic, least privilege, and honestly inactive", () => {
  const manifest = buildPostgresSignalStrategyEvaluationApplyManifest();
  assert.deepEqual(buildPostgresSignalStrategyEvaluationApplyManifest(), manifest);
  assert.equal(manifest.contractVersion, POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_CONTRACT_VERSION);
  assert.equal(manifest.missionBindingApplyContractVersion, 1);
  assert.equal(manifest.evaluatorContractVersion, 1);
  assert.equal(manifest.strategyEvaluationRole.kind, "signal_strategy_evaluation_apply_boundary");
  assert.equal(manifest.strategyEvaluationRole.functionName, POSTGRES_SIGNAL_STRATEGY_EVALUATION_APPLY_FUNCTION);
  assert.equal(manifest.strategyEvaluationRole.login, false);
  assert.equal(manifest.strategyEvaluationRole.inherit, false);
  assert.equal(manifest.strategyEvaluationRole.bypassRls, false);
  assert.equal(manifest.strategyEvaluationRole.directTableAccess, false);
  assert.equal(manifest.protectedTenantTableCount, 19);
  assert.equal(manifest.forcedRlsTableCount, 19);
  assert.deepEqual(manifest.strategyEvaluationRole.mutationTableNames, [
    "audit_events", "mission_decisions", "outbox_events"
  ]);
  assert.ok(manifest.strategyEvaluationRole.protectedTenantTableNames.includes("strategies"));
  assert.equal(manifest.directTableGrantCount, 0);
  assert.equal(manifest.functionGrantCount, 1);
  assert.equal(manifest.applicationOwnedDeterministicEvaluation, true);
  assert.equal(manifest.databaseInputSnapshotRevalidation, true);
  assert.equal(manifest.databaseSemanticEvaluation, false);
  assert.equal(manifest.actionableEvaluationZeroWriteHandoff, true);
  assert.equal(manifest.evaluationAuthority, false);
  assert.equal(manifest.runtimeAuthority, false);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const source = signalStrategyEvaluationApplyFunctionSource(manifest);
  assert.match(source, /principal\.principal_role = session_user::text/);
  assert.match(source, /yoink_apply_trackalacker_signal_mission_binding/);
  assert.match(source, /requires settled exact mission binding/);
  assert.match(source, /postgres_signal_strategy_evaluation_apply_plan_v1/);
  assert.match(source, /signal-policy-evaluation-v1/);
  assert.match(source, /signal-strategy-set-v1/);
  assert.match(source, /event_id_value \|\| ':' \|\| \(attestation->>'missionId'\)/);
  assert.match(source, /strategy snapshot changed/);
  assert.match(source, /transport snapshot changed/);
  assert.match(source, /INSERT INTO .*"mission_decisions"/s);
  assert.match(source, /INSERT INTO .*"audit_events"/s);
  assert.match(source, /INSERT INTO .*"outbox_events"/s);
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"[^"]+"\."(?:missions|mission_targets|mission_intent_revisions|strategies|action_jobs|spend_reservations|inbox_messages)"/
  );
  assert.doesNotMatch(source, /DELETE\s+FROM|TRUNCATE\s+/i);

  const capability = postgresSignalStrategyEvaluationApplyCapabilityProjection();
  assert.equal(capability.phase, "qualified_inactive");
  assert.equal(capability.twoPhasePlanApply, true);
  assert.equal(capability.strategySetFingerprintParity, true);
  assert.equal(capability.evaluationFingerprintParity, true);
  assert.equal(capability.terminalEvaluationDecisionParity, true);
  assert.equal(capability.databaseSemanticEvaluation, false);
  assert.equal(capability.signalEvaluationApplyRepositoryParity, true);
  assert.equal(capability.hostedDeliveryHandlerRepositoryParity, false);
  assert.equal(capability.mutationAuthority, true);
  assert.equal(capability.evaluationAuthority, false);
  assert.equal(capability.runtimeAuthority, false);
  assert.equal(capability.productionReady, false);

  assert.throws(
    () => buildPostgresSignalStrategyEvaluationApplyManifest(
      manifest.predecessorManifest,
      manifest.predecessorManifest.missionBindingApplyRoleNamespace
    ),
    /independent/
  );
});

test("the generated strategy-evaluation PL/pgSQL parses before the native qualification run", async () => {
  const database = new PGlite();
  try {
    const source = signalStrategyEvaluationApplyFunctionSource(
      buildPostgresSignalStrategyEvaluationApplyManifest()
    );
    await database.exec(`CREATE FUNCTION public.yoink_signal_strategy_evaluation_parse_probe(
      expected_tenant_id text, expected_user_id text, operation_name text,
      target_message_id text, capability_token text,
      evaluation_timestamp_input text, apply_payload_json text
    ) RETURNS TABLE(result_json text)
    LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
    AS $function$
    ${source}
    $function$`);
  } finally {
    await database.close();
  }
});

test("the strategy-evaluation plan fingerprint seals every evaluation and mutation field", () => {
  const plan: PostgresSignalStrategyEvaluationApplyPlan = {
    contractVersion: 1,
    messageId: "inbox_00000000000000000000000000000001",
    payloadHash: "3".repeat(64),
    evaluatedAt: "2026-08-26T20:00:00.000Z",
    validUntil: "2026-08-26T20:00:30.000Z",
    eventId: "signal_event_00000000000000000000000000000001",
    signalId: "signal_test",
    resolutionDecisionId: "resolution_00000000000000000000000000000001",
    listingId: listing.id,
    variantId: listing.variantId,
    offerObservationId: "offer_observation_00000000000000000000000000000001",
    incidentId: "incident_00000000000000000000000000000001",
    semanticKey: "4".repeat(64),
    missionId: mission.id,
    missionTargetId: mission.targetId,
    missionEvaluationQuantity: 5,
    policyRevisionId: policy.id,
    policyRevision: 1,
    policyHash: policy.policyHash,
    strategySetFingerprint: signalStrategySetFingerprint([strategy]),
    strategyCount: 1,
    evaluationFingerprint: "5".repeat(64),
    evaluationState: "matched",
    evaluationReason: "Matched safely.",
    decisionSource: "strategy",
    strategyId: strategy.id,
    strategyRevision: 3,
    maxSignalAgeSeconds: 120,
    effectiveUnitCapCents: 6_500,
    effectiveQuantity: 2,
    effectiveAction: "add_to_cart",
    sellerPolicy: "first_party_only",
    fulfillment: "shipping",
    sourceActionRestricted: false,
    outcome: "continue_downstream",
    decisionAction: "none",
    auditAction: "none",
    outboxAction: "none",
    mutationStatementCount: 0,
    mutationRowCount: 0,
    strategyEvaluationApplyWillApply: false,
    continueDownstream: true,
    sharedCatalogMutation: false,
    missionMutation: false,
    policyMutation: false,
    strategyMutation: false,
    actionMutation: false,
    spendMutation: false,
    inboxLifecycleMutation: false,
    rawSignalPayloadReturned: false,
    evaluationAuthority: false,
    planFingerprint: ""
  };
  const principal = { tenantId: "tenant_test", userId: "user_test" };
  const first = postgresSignalStrategyEvaluationApplyPlanFingerprint(principal, plan);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, postgresSignalStrategyEvaluationApplyPlanFingerprint(principal, plan));
  assert.notEqual(
    postgresSignalStrategyEvaluationApplyPlanFingerprint(principal, {
      ...plan,
      effectiveQuantity: 1
    }),
    first
  );
  assert.notEqual(
    postgresSignalStrategyEvaluationApplyPlanFingerprint(principal, {
      ...plan,
      evaluationState: "unmatched",
      outcome: "unmatched",
      decisionAction: "insert",
      auditAction: "insert",
      outboxAction: "insert",
      mutationStatementCount: 3,
      mutationRowCount: 3,
      strategyEvaluationApplyWillApply: true,
      continueDownstream: false
    }),
    first
  );
});
