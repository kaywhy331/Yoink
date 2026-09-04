import assert from "node:assert/strict";
import test from "node:test";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("an administrator action pause applies to every shopper in the tenant", () => {
  const db = new YoinkDatabase();
  try {
    const now = "2026-09-04T18:00:00.000Z";
    db.run(
      "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)",
      "user_tenant_pause_fixture",
      "tenant_local",
      "Tenant pause fixture",
      now
    );
    db.run("INSERT INTO app_settings(user_id, actions_paused, updated_at) VALUES (?, 0, ?)", "user_tenant_pause_fixture", now);
    db.run("UPDATE app_settings SET actions_paused = 0 WHERE user_id = 'user_local'");

    const paused = new ControlRepository(db).setTenantActionsPaused(true, "Tenant safety pause", Date.parse(now));
    assert.equal(paused.affectedUserCount, 2);
    assert.deepEqual(
      db.all<{ userId: string; paused: number }>(
        `SELECT user_id AS userId, actions_paused AS paused
         FROM app_settings WHERE user_id IN ('user_local', 'user_tenant_pause_fixture') ORDER BY user_id`
      ).map((row) => ({ ...row })),
      [
        { userId: "user_local", paused: 1 },
        { userId: "user_tenant_pause_fixture", paused: 1 }
      ]
    );
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'tenant_actions_pause_changed'"
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("missions edit the complete exact retailer target set atomically", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const first = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "mission-product",
      sourceListingId: "mission-target-1",
      title: "Editable Mission Fixture",
      retailerId: "target",
      retailerSku: "95280894",
      canonicalUrl: "https://www.target.com/p/-/A-95280894",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4499
    });
    const second = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "mission-product",
      sourceListingId: "mission-target-2",
      title: "Editable Mission Fixture",
      retailerId: "amazon",
      retailerSku: "B0MISSN001",
      canonicalUrl: "https://www.amazon.com/dp/B0MISSN001",
      listingStatus: "out_of_stock",
      executionSupported: true,
      msrpCents: 4499
    });
    const control = new ControlRepository(db);
    const ensured = control.ensureMission(first.listing.variantId, first.listing.id, "test");
    const detail = control.missionDetail(ensured.mission.id) as { targets: Array<Record<string, unknown>> };
    assert.equal(detail.targets.length, 2);
    const target = detail.targets.find((item) => item.listingId === first.listing.id);
    const amazon = detail.targets.find((item) => item.listingId === second.listing.id);
    assert.ok(target?.id);
    assert.ok(amazon?.id);

    const updated = control.updateMission(ensured.mission.id, {
      status: "active",
      targetQuantity: 3,
      targets: [
        {
          id: String(target?.id),
          enabled: true,
          maxUnitPriceCents: 4200,
          sellerPolicy: "first_party_only",
          fulfillment: "shipping"
        },
        {
          id: String(amazon?.id),
          enabled: false,
          maxUnitPriceCents: null,
          sellerPolicy: "allow_third_party",
          fulfillment: "inherit"
        }
      ]
    }) as { targetQuantity: number; targets: Array<Record<string, unknown>> };
    assert.equal(updated.targetQuantity, 3);
    assert.equal(updated.targets.find((item) => item.id === target?.id)?.maxUnitPriceCents, 4200);
    assert.equal(updated.targets.find((item) => item.id === amazon?.id)?.enabled, false);
    assert.throws(() => control.updateMission(ensured.mission.id, {
      status: "paused",
      targetQuantity: 4,
      targets: [{
        id: String(target?.id), enabled: true, maxUnitPriceCents: null,
        sellerPolicy: "inherit", fulfillment: "inherit"
      }]
    }), /complete exact target set/);
    assert.equal((control.missionDetail(ensured.mission.id) as { targetQuantity: number }).targetQuantity, 3);
  } finally {
    db.close();
  }
});

test("guided purchase setup creates one reviewed revision with only the chosen exact store enabled", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-08-24T20:00:00.000Z").getTime();
  try {
    const catalog = new CatalogRepository(db);
    const selected = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "guided-product",
      sourceListingId: "guided-target",
      title: "Guided Exact Fixture",
      retailerId: "target",
      retailerSku: "95280895",
      canonicalUrl: "https://www.target.com/p/-/A-95280895",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4500
    }, now);
    const sibling = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "guided-product",
      sourceListingId: "guided-amazon",
      title: "Guided Exact Fixture",
      retailerId: "amazon",
      retailerSku: "B0GUIDD001",
      canonicalUrl: "https://www.amazon.com/dp/B0GUIDD001",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4600
    }, now);
    const control = new ControlRepository(db);
    const created = control.createConfiguredMission({
      contractVersion: 1,
      listingId: selected.listing.id,
      targetQuantity: 2,
      maxUnitPriceCents: 5000,
      maxAllInCents: 15_000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "manual",
      substitutionPolicy: "exact_only",
      expiresAt: new Date(now + 86_400_000).toISOString(),
      cooldownSeconds: 900,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now);
    assert.equal(created.created, true);
    const detail = control.missionDetail(created.mission.id) as {
      targetQuantity: number;
      intentPolicy: Record<string, unknown>;
      targets: Array<Record<string, unknown>>;
    };
    assert.equal(detail.targetQuantity, 2);
    assert.equal(detail.intentPolicy.revision, 1);
    assert.equal(detail.intentPolicy.actionCeiling, "add_to_cart");
    assert.equal(detail.intentPolicy.decisionMode, "purchase_intent");
    assert.equal(detail.intentPolicy.maxSignalAgeSeconds, 120);
    assert.equal(detail.intentPolicy.maxAllInCents, 15_000);
    assert.equal(detail.intentPolicy.cooldownSeconds, 900);
    const selectedTarget = detail.targets.find((target) => target.listingId === selected.listing.id);
    const siblingTarget = detail.targets.find((target) => target.listingId === sibling.listing.id);
    assert.deepEqual({
      enabled: selectedTarget?.enabled,
      maxUnitPriceCents: selectedTarget?.maxUnitPriceCents,
      sellerPolicy: selectedTarget?.sellerPolicy,
      fulfillment: selectedTarget?.fulfillment
    }, {
      enabled: true,
      maxUnitPriceCents: 5000,
      sellerPolicy: "first_party_only",
      fulfillment: "shipping"
    });
    assert.equal(siblingTarget?.enabled, false);
    assert.equal(siblingTarget?.maxUnitPriceCents, null);
    assert.throws(() => control.createConfiguredMission({
      contractVersion: 1,
      listingId: selected.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5000,
      maxAllInCents: 5000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now + 1), /already exists/);
    const discoveredLater = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "guided-product",
      sourceListingId: "guided-later-target",
      title: "Guided Exact Fixture",
      retailerId: "target",
      retailerSku: "95280898",
      canonicalUrl: "https://www.target.com/p/-/A-95280898",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4700
    }, now + 2);
    const expanded = control.missionDetail(created.mission.id) as {
      intentPolicy: { revision: number; targets: Array<Record<string, unknown>> };
      targets: Array<Record<string, unknown>>;
    };
    assert.equal(expanded.targets.find((target) => target.listingId === discoveredLater.listing.id)?.enabled, false);
    assert.equal(expanded.intentPolicy.revision, 1);
    assert.equal(expanded.intentPolicy.targets.length, 2);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM mission_intent_revisions WHERE mission_id = ?",
      created.mission.id
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("purchase plans delete from active use while retaining history and can be explicitly recreated", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-08-31T18:00:00.000Z").getTime();
  try {
    const catalog = new CatalogRepository(db);
    const selected = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "delete-plan-product",
      sourceListingId: "delete-plan-listing",
      title: "Delete Purchase Plan Fixture",
      retailerId: "target",
      retailerSku: "95280998",
      canonicalUrl: "https://www.target.com/p/-/A-95280998",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 2500
    }, now);
    const control = new ControlRepository(db);
    const created = control.createConfiguredMission({
      contractVersion: 1,
      listingId: selected.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 3000,
      maxAllInCents: 3000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now);
    const missionId = created.mission.id;

    assert.throws(() => control.deleteMission(missionId, {
      confirmation: "DELETE_PURCHASE_PLAN_WRONG" as "DELETE_PURCHASE_PLAN"
    }), /Confirm that you want to permanently remove/);
    const deletion = control.deleteMission(missionId, {
      confirmation: "DELETE_PURCHASE_PLAN"
    }, now + 1_000);
    assert.deepEqual(deletion, {
      id: missionId,
      deleted: true,
      cancelledPendingJobCount: 0,
      cancelledWatchItemCount: 0
    });
    assert.equal(control.missionDetail(missionId), null);
    assert.equal(control.missionCount(), 0);
    assert.deepEqual(control.listMissions(), []);
    assert.equal(control.findMissionForListing(selected.listing.id)?.status, "deleted");
    assert.throws(() => control.updateMission(missionId, {
      status: "active",
      targetQuantity: 1,
      targets: []
    }), /mission does not exist/);
    assert.equal(db.get<{ status: string }>("SELECT status FROM missions WHERE id = ?", missionId)?.status, "deleted");
    assert.equal(db.get<{ enabled: number }>("SELECT enabled FROM mission_targets WHERE mission_id = ?", missionId)?.enabled, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM mission_intent_revisions WHERE mission_id = ?",
      missionId
    )?.count, 1);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE correlation_id = ? AND event_type = 'mission_deleted'",
      missionId
    )?.count, 1);

    const preview = control.previewConfiguredMission({
      contractVersion: 2,
      listingId: selected.listing.id,
      targetQuantity: 2,
      maxUnitPriceCents: 3200,
      maxAllInCents: 6400,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 60,
      confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN"
    }, now + 2_000);
    assert.equal(preview.noPurchasePlanSaved, true);
    const recreated = control.createConfiguredMission({
      contractVersion: 1,
      listingId: selected.listing.id,
      targetQuantity: 2,
      maxUnitPriceCents: 3200,
      maxAllInCents: 6400,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 60,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now + 3_000);
    assert.equal(recreated.created, true);
    assert.equal(recreated.mission.id, missionId);
    assert.equal(recreated.mission.status, "active");
    assert.equal(recreated.mission.targetQuantity, 2);
    assert.equal(control.missionCount(), 1);
    assert.equal((control.missionDetail(missionId) as { intentPolicy: { cooldownSeconds: number } }).intentPolicy.cooldownSeconds, 60);
  } finally {
    db.close();
  }
});

test("purchase-plan preflight returns authoritative cost and readiness inputs without writing purchase state", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-08-25T18:00:00.000Z").getTime();
  try {
    const selected = new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "preflight-product",
      sourceListingId: "preflight-target",
      title: "Preflight Exact Fixture",
      retailerId: "target",
      retailerSku: "95280901",
      canonicalUrl: "https://www.target.com/p/-/A-95280901",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 5000
    }, now);
    const control = new ControlRepository(db);
    control.updateSettings({
      dedupeWindowSeconds: 300,
      affiliateMode: "disabled",
      taxBps: 825,
      storeAllowancesCents: { target: 250, walmart: 0, amazon: 0, bestbuy: 0 }
    }, now);
    const purchaseWriteCounts = () => db.get<Record<string, number>>(
      `SELECT (SELECT COUNT(*) FROM missions) AS missions,
              (SELECT COUNT(*) FROM mission_targets) AS targets,
              (SELECT COUNT(*) FROM mission_intent_revisions) AS revisions,
              (SELECT COUNT(*) FROM spend_reservations) AS reservations,
              (SELECT COUNT(*) FROM action_jobs) AS jobs`
    );
    const before = purchaseWriteCounts();
    const preflight = control.previewConfiguredMission({
      contractVersion: 2,
      listingId: selected.listing.id,
      targetQuantity: 2,
      maxUnitPriceCents: 5000,
      maxAllInCents: 12_000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      expiresAt: new Date(now + 86_400_000).toISOString(),
      cooldownSeconds: 900,
      confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN"
    }, now);
    assert.equal(preflight.noPurchasePlanSaved, true);
    assert.equal(preflight.listing.retailerSku, "95280901");
    assert.equal(preflight.cost.itemSubtotalCapCents, 10_000);
    assert.equal(preflight.cost.taxReserveCents, 825);
    assert.equal(preflight.cost.storeReserveCents, 250);
    assert.equal(preflight.cost.minimumAllInCents, 11_075);
    assert.equal(preflight.cost.headroomCents, 925);
    assert.equal(preflight.readinessPlan.targets[0]?.listingId, selected.listing.id);
    assert.deepEqual(purchaseWriteCounts(), before);
    assert.throws(() => control.createConfiguredMission({
      ...preflight.draft,
      contractVersion: 2,
      preflightFingerprint: "a".repeat(64),
      preflightedAt: new Date(now).toISOString(),
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now), /preview changed or is missing/);
    assert.throws(() => control.createConfiguredMission({
      ...preflight.draft,
      contractVersion: 2,
      preflightFingerprint: "a".repeat(64),
      preflightedAt: new Date(now - 301_000).toISOString(),
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now, "a".repeat(64)), /preview expired/);
    assert.throws(() => control.previewConfiguredMission({
      ...preflight.draft,
      contractVersion: 2,
      expiresAt: new Date(now - 1).toISOString(),
      confirmation: "PREFLIGHT_EXACT_PURCHASE_PLAN"
    }, now), /future timestamp/);
    assert.deepEqual(purchaseWriteCounts(), before);
  } finally {
    db.close();
  }
});

test("failed guided setup rolls back every mission, target, and policy write", () => {
  const db = new YoinkDatabase();
  const now = new Date("2026-08-24T20:00:00.000Z").getTime();
  try {
    const created = new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "guided-rollback-product",
      sourceListingId: "guided-rollback-listing",
      title: "Guided Rollback Fixture",
      retailerId: "target",
      retailerSku: "95280896",
      canonicalUrl: "https://www.target.com/p/-/A-95280896",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4500
    }, now);
    const control = new ControlRepository(db);
    assert.throws(() => control.createConfiguredMission({
      contractVersion: 1,
      listingId: created.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5000,
      maxAllInCents: 5000,
      actionCeiling: "add_to_cart",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now), /tax and store-fee safety reserve/);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.throws(() => control.createConfiguredMission({
      contractVersion: 1,
      listingId: created.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5000,
      maxAllInCents: 5000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      expiresAt: new Date(now - 1).toISOString(),
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    }, now), /future timestamp/);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM mission_targets")?.count, 0);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM mission_intent_revisions")?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type IN ('mission_created', 'purchase_intent_policy_revised')"
    )?.count, 0);
  } finally {
    db.close();
  }
});

test("legacy user plan creation is notification-only until limits are explicitly reviewed", () => {
  const db = new YoinkDatabase();
  try {
    const created = new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "safe-user-draft",
      sourceListingId: "safe-user-draft-listing",
      title: "Safe User Draft Fixture",
      retailerId: "target",
      retailerSku: "95280897",
      canonicalUrl: "https://www.target.com/p/-/A-95280897",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 4500
    });
    const control = new ControlRepository(db);
    const mission = control.ensureUserMission(created.listing.variantId, created.listing.id);
    const detail = control.missionDetail(mission.mission.id) as {
      intentPolicy: Record<string, unknown>;
      targets: Array<Record<string, unknown>>;
    };
    assert.equal(detail.intentPolicy.revision, 1);
    assert.equal(detail.intentPolicy.actionCeiling, "notify");
    assert.equal(detail.intentPolicy.decisionMode, "purchase_intent");
    assert.equal(detail.targets[0]?.enabled, true);
    assert.equal(detail.targets[0]?.maxUnitPriceCents, null);
    assert.equal(detail.targets[0]?.sellerPolicy, "first_party_only");
  } finally {
    db.close();
  }
});

test("legacy signal plans transition atomically to explicit notification-only control", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    const createLegacy = (suffix: string) => {
      const listing = catalog.upsertListing({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        sourceProductId: `legacy-transition-${suffix}`,
        sourceListingId: `legacy-transition-listing-${suffix}`,
        title: `Legacy Transition ${suffix}`,
        retailerId: "target",
        retailerSku: `95281${suffix.padStart(3, "0")}`,
        canonicalUrl: `https://www.target.com/p/-/A-95281${suffix.padStart(3, "0")}`,
        listingStatus: "in_stock",
        executionSupported: true,
        msrpCents: 2500
      });
      return control.ensureMission(listing.listing.variantId, listing.listing.id, "signal:trackalacker").mission.id;
    };
    const firstId = createLegacy("1");
    const secondId = createLegacy("2");
    const advancedListing = catalog.upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "advanced-strategy-plan",
      sourceListingId: "advanced-strategy-listing",
      title: "Intentional Advanced Strategy",
      retailerId: "target",
      retailerSku: "95281998",
      canonicalUrl: "https://www.target.com/p/-/A-95281998",
      listingStatus: "in_stock",
      executionSupported: true,
      msrpCents: 2500
    });
    const advancedId = control.ensureMission(
      advancedListing.listing.variantId,
      advancedListing.listing.id,
      "advanced:operator"
    ).mission.id;
    const firstPreview = control.legacyPurchaseIntentTransitionPreview();
    assert.equal(firstPreview.contractVersion, 1);
    assert.equal(firstPreview.eligibleCount, 2);
    assert.equal(firstPreview.activeCount, 2);
    assert.equal(firstPreview.outcome, "notification_only");
    assert.equal(firstPreview.retailerMutationAuthorized, false);
    assert.match(firstPreview.previewFingerprint, /^[a-f0-9]{64}$/);
    assert.throws(() => control.transitionLegacyPurchaseIntents({
      contractVersion: 1,
      previewFingerprint: firstPreview.previewFingerprint,
      confirmation: "WRONG" as "CONVERT_LEGACY_PLANS_TO_NOTIFICATIONS"
    }), /explicitly confirm/);
    const thirdId = createLegacy("3");
    assert.throws(() => control.transitionLegacyPurchaseIntents({
      contractVersion: 1,
      previewFingerprint: firstPreview.previewFingerprint,
      confirmation: "CONVERT_LEGACY_PLANS_TO_NOTIFICATIONS"
    }), /changed after preview/);
    assert.equal((control.missionDetail(firstId) as { intentPolicy: { decisionMode: string } }).intentPolicy.decisionMode, "strategy");

    const currentPreview = control.legacyPurchaseIntentTransitionPreview();
    const result = control.transitionLegacyPurchaseIntents({
      contractVersion: 1,
      previewFingerprint: currentPreview.previewFingerprint,
      confirmation: "CONVERT_LEGACY_PLANS_TO_NOTIFICATIONS"
    });
    assert.equal(result.transitionedCount, 3);
    assert.equal(result.cancelledPendingJobCount, 0);
    assert.equal(result.preview.eligibleCount, 0);
    assert.deepEqual(new Set(result.transitionedPlanIds), new Set([firstId, secondId, thirdId]));
    assert.equal((control.missionDetail(advancedId) as { intentPolicy: { decisionMode: string } }).intentPolicy.decisionMode, "strategy");
    for (const id of [firstId, secondId, thirdId]) {
      const detail = control.missionDetail(id) as {
        intentPolicy: { revision: number; decisionMode: string; actionCeiling: string };
        targets: Array<{ enabled: boolean; maxUnitPriceCents: number | null; sellerPolicy: string; fulfillment: string }>;
      };
      assert.equal(detail.intentPolicy.revision, 2);
      assert.equal(detail.intentPolicy.decisionMode, "purchase_intent");
      assert.equal(detail.intentPolicy.actionCeiling, "notify");
      assert.deepEqual(detail.targets.map((target) => ({
        enabled: target.enabled,
        maxUnitPriceCents: target.maxUnitPriceCents,
        sellerPolicy: target.sellerPolicy,
        fulfillment: target.fulfillment
      })), [{ enabled: true, maxUnitPriceCents: null, sellerPolicy: "inherit", fulfillment: "inherit" }]);
    }
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'legacy_purchase_intents_transitioned'"
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("a direct plan update cannot authorize an unsafe cart target", () => {
  const db = new YoinkDatabase();
  try {
    const created = new CatalogRepository(db).upsertListing({
      sourceConnectionId: "source_trackalacker_local",
      source: "trackalacker",
      sourceProductId: "monitor-only-product",
      sourceListingId: "monitor-only-listing",
      title: "Monitor-only Direct Plan Fixture",
      retailerId: "amazon",
      retailerSku: "B0DIRCT001",
      canonicalUrl: "https://www.amazon.com/dp/B0DIRCT001",
      listingStatus: "in_stock",
      executionSupported: false,
      msrpCents: 4500
    });
    const control = new ControlRepository(db);
    const configured = control.createConfiguredMission({
      contractVersion: 1,
      listingId: created.listing.id,
      targetQuantity: 1,
      maxUnitPriceCents: 5000,
      maxAllInCents: 5000,
      actionCeiling: "notify",
      sellerPolicy: "first_party_only",
      fulfillment: "shipping",
      substitutionPolicy: "exact_only",
      cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN"
    });
    const before = control.missionDetail(configured.mission.id) as {
      intentPolicy: { revision: number; actionCeiling: string };
      targets: Array<{ id: string }>;
    };
    assert.throws(() => control.updateMission(configured.mission.id, {
      status: "active",
      targetQuantity: 1,
      targets: [{
        id: before.targets[0]!.id,
        enabled: true,
        maxUnitPriceCents: 5000,
        sellerPolicy: "first_party_only",
        fulfillment: "shipping"
      }],
      policy: {
        expectedRevision: 1,
        maxAllInCents: 8600,
        actionCeiling: "add_to_cart",
        decisionMode: "purchase_intent"
      }
    }), /packaged mapping/);
    const after = control.missionDetail(configured.mission.id) as {
      intentPolicy: { revision: number; actionCeiling: string };
    };
    assert.equal(after.intentPolicy.revision, 1);
    assert.equal(after.intentPolicy.actionCeiling, "notify");
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM mission_intent_revisions WHERE mission_id = ?",
      configured.mission.id
    )?.count, 1);
  } finally {
    db.close();
  }
});

test("control-plane guardrail settings validate and round-trip", () => {
  const db = new YoinkDatabase();
  try {
    const control = new ControlRepository(db);
    const settings = control.updateSettings({
      dedupeWindowSeconds: 180,
      affiliateMode: "disabled",
      taxBps: 825,
      storeAllowancesCents: { target: 500, walmart: 600, amazon: 700, bestbuy: 800 }
    });
    assert.equal(settings.dedupeWindowSeconds, 180);
    assert.equal(settings.affiliateMode, "disabled");
    assert.equal(settings.taxBps, 825);
    assert.deepEqual(settings.storeAllowancesCents, { target: 500, walmart: 600, amazon: 700, bestbuy: 800 });
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'guardrail_settings_updated'")?.count, 1);
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'guardrail_settings_updated'")?.count, 1);
    assert.throws(() => control.updateSettings({
      dedupeWindowSeconds: 1,
      affiliateMode: "prefer_fallback",
      taxBps: 0,
      storeAllowancesCents: {}
    }), /dedupe window/);
  } finally {
    db.close();
  }
});

test("source cards expose bounded reliability projections without counting test signals", () => {
  const db = new YoinkDatabase();
  try {
    const source = new ControlRepository(db).listSources().find((item) => item.id === "source_trackalacker_local");
    assert.ok(source);
    assert.equal(source.signalCount, 0);
    assert.equal(source.matchedSignalCount, 0);
    assert.equal(source.unresolvedSignalCount, 0);
    assert.equal(source.ambiguousSignalCount, 0);
    assert.equal(source.qualifiedSignalCount, 0);
    assert.equal(source.corroboratedSignalCount, 0);
    assert.equal(source.matchRatePercent, null);
  } finally {
    db.close();
  }
});
