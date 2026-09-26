import assert from "node:assert/strict";
import test from "node:test";
import { AttributionRepository } from "../packages/database/src/attribution-repository.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import {
  HOSTED_PRINCIPAL_CONFIRMATION,
  PrincipalRepository,
  type HostedPrincipalInput
} from "../packages/database/src/principal-repository.js";
import { QualificationRepository } from "../packages/database/src/qualification-repository.js";
import {
  runWithRequestScope,
  scopedSourceConnectionId,
  type RequestScope
} from "../packages/database/src/request-scope.js";

const NOW = new Date("2026-08-24T10:00:00.000Z").getTime();
const SERVICE_SCOPE: RequestScope = {
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "service",
  actorId: "identity_sync",
  internalServiceCapability: "internal.principal"
};
const SECOND_SCOPE: RequestScope = {
  tenantId: "tenant_second",
  userId: "user_second",
  actorKind: "user",
  actorId: "user_second"
};

test("trusted identity sync provisions idempotent per-user settings, sources, strategies, and attribution policy", () => {
  const db = new YoinkDatabase();
  try {
    const principals = new PrincipalRepository(db);
    const input = {
      tenantId: SECOND_SCOPE.tenantId,
      userId: SECOND_SCOPE.userId,
      tenantName: "Second tenant",
      displayName: "Second user",
      confirmation: HOSTED_PRINCIPAL_CONFIRMATION
    } satisfies HostedPrincipalInput;
    assert.throws(() => runWithRequestScope({
      ...SERVICE_SCOPE,
      actorId: "delivery_worker",
      internalServiceCapability: "internal.delivery"
    }, () => principals.provision(input, NOW)), /internal\.principal/);
    const first = runWithRequestScope(SERVICE_SCOPE, () => principals.provision(input, NOW));
    const replay = runWithRequestScope(SERVICE_SCOPE, () => principals.provision(input, NOW + 1));
    assert.equal(first.created, true);
    assert.equal(replay.created, false);

    runWithRequestScope(SECOND_SCOPE, () => {
      const control = new ControlRepository(db);
      assert.equal(control.settings().actionsPaused, true);
      assert.equal(control.settings().executionMode, "shadow");
      assert.equal(control.listSources().length, 3);
      assert.equal(control.listStrategies().length, 1);
      assert.equal(new AttributionRepository(db).listPolicies().length, 20);
      const sourceId = scopedSourceConnectionId("trackalacker");
      assert.notEqual(sourceId, "source_trackalacker_local");
      assert.equal(db.get<{ userId: string }>(
        "SELECT user_id AS userId FROM source_connections WHERE id = ?",
        sourceId
      )?.userId, SECOND_SCOPE.userId);

      const catalog = new CatalogRepository(db);
      catalog.upsertTrackalackerItem({
        sourceProductId: "second-user-product",
        sourceProductSlug: "second-user-product",
        sourceProductUrl: "https://www.trackalacker.com/products/showcase/second-user-product",
        title: "Second user product",
        observedAt: new Date(NOW + 2).toISOString(),
        listings: []
      }, NOW + 3);
      assert.equal(db.get<{ sourceConnectionId: string }>(
        `SELECT source_connection_id AS sourceConnectionId FROM source_product_refs
         WHERE external_product_id = 'second-user-product'`
      )?.sourceConnectionId, sourceId);
    });

    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM source_connections WHERE user_id = ?",
      LOCAL_USER_ID
    )?.count, 2, "the local install no longer seeds the gated Discord placeholder");
    db.run(
      `INSERT INTO retailer_adapter_qualifications(
         tenant_id, user_id, retailer_id, adapter_version, highest_action,
         status, evidence_hash, qualified_at, updated_at
       ) VALUES (?, ?, 'target', 'target-add-v1', 'add_to_cart', 'qualified', 'local-only', ?, ?)`,
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString()
    );
    assert.equal(runWithRequestScope(SECOND_SCOPE, () => new QualificationRepository(db).targetAddQualified()), false);
    assert.throws(() => runWithRequestScope({
      tenantId: SERVICE_SCOPE.tenantId,
      userId: SERVICE_SCOPE.userId,
      actorKind: "maintainer",
      actorId: "not_an_identity_service"
    }, () => principals.provision({
      ...input,
      userId: "user_third"
    }, NOW)), /identity service scope/);
  } finally {
    db.close();
  }
});
