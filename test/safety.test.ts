import assert from "node:assert/strict";
import test from "node:test";
import { assertJobTransition, canTransitionJob, jobMayHaveMutated } from "../packages/domain/src/job-state.js";
import { sanitizeDiagnosticData } from "../packages/domain/src/redaction.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("diagnostic data structurally redacts browser and checkout secrets", () => {
  const output = sanitizeDiagnosticData({
    endpoint: "push-secret",
    nested: {
      p256dh: "key-secret",
      auth: "auth-secret",
      offerListingId: "offer-secret",
      cookie_header: "cookie-secret",
      harmless: "safe"
    }
  });
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes("push-secret"), false);
  assert.equal(serialized.includes("key-secret"), false);
  assert.equal(serialized.includes("auth-secret"), false);
  assert.equal(serialized.includes("offer-secret"), false);
  assert.equal(serialized.includes("cookie-secret"), false);
  assert.equal(serialized.includes("safe"), true);
  assert.match(serialized, /\[REDACTED\]/);
});

test("job transitions prevent skipping verification and identify mutation-risk states", () => {
  assert.equal(canTransitionJob("verifying_listing", "offer_verified"), true);
  assert.equal(canTransitionJob("verifying_listing", "submitting"), false);
  assert.throws(() => assertJobTransition("offer_verified", "submitting"), /cannot move/);
  assert.equal(jobMayHaveMutated("verifying_listing"), false);
  assert.equal(jobMayHaveMutated("adding"), true);
  assert.equal(jobMayHaveMutated("submission_uncertain"), true);
});

test("invalid executable strategy caps are rejected before persistence", () => {
  const db = new YoinkDatabase();
  try {
    const base = new ControlRepository(db).listStrategies()[0];
    assert.ok(base);
    const invalid = {
      ...base,
      id: "strategy_invalid_cap",
      action: "submit_order" as const,
      pricePolicy: { kind: "absolute_max" as const }
    };
    assert.throws(
      () => new ControlRepository(db).replaceStrategies([invalid]),
      /require a positive maximum price/
    );
  } finally {
    db.close();
  }
});
