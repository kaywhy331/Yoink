import assert from "node:assert/strict";
import test from "node:test";
import { TARGET_ADD_ADAPTER_VERSION } from "../packages/contracts/src/index.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { MutationLaneRepository } from "../packages/database/src/mutation-lane-repository.js";

test("pickup, prepare-checkout, and submit-order stay independently closed for every retailer", () => {
  const db = new YoinkDatabase();
  try {
    const repository = new MutationLaneRepository(db);
    const initial = repository.readiness();
    assert.equal(initial.policyVersion, "advanced-mutation-gates-v1");
    assert.equal(initial.mutationAuthorized, false);
    assert.equal(initial.lanes.length, 12);
    assert.equal(initial.lanes.every((lane) => lane.status === "closed" && lane.packagedAdapterVersion === "" && lane.mutationAuthorized === false), true);
    assert.equal(initial.lanes.filter((lane) => lane.lane === "pickup_add").length, 4);
    assert.equal(initial.lanes.filter((lane) => lane.lane === "prepare_checkout").length, 4);
    assert.equal(initial.lanes.filter((lane) => lane.lane === "submit_order").length, 4);
    assert.equal(initial.lanes.filter((lane) => lane.lane === "submit_order")
      .every((lane) => lane.requirements.every((requirement) => requirement.met === false)), true);

    const timestamp = new Date().toISOString();
    db.run(
      `INSERT INTO retailer_adapter_qualifications(
         tenant_id, user_id, retailer_id, adapter_version, highest_action,
         status, evidence_hash, qualified_at, updated_at
       ) VALUES (?, ?, 'target', ?, 'add_to_cart', 'qualified', 'test', ?, ?)`,
      LOCAL_TENANT_ID,
      LOCAL_USER_ID,
      TARGET_ADD_ADAPTER_VERSION,
      timestamp,
      timestamp
    );
    const updated = repository.readiness();
    const targetPrepare = updated.lanes.find((lane) => lane.id === "target_prepare_checkout");
    assert.equal(targetPrepare?.requirements.find((requirement) => requirement.id === "add_lane")?.met, true);
    assert.equal(targetPrepare?.mutationAuthorized, false);
    assert.equal(targetPrepare?.requirements.find((requirement) => requirement.id === "packaged_adapter")?.met, false);
  } finally {
    db.close();
  }
});
