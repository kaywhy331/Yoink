import assert from "node:assert/strict";
import test from "node:test";
import {
  RESUME_BLOCKED_MESSAGE,
  buildResumePreflight,
  resumeBlockedDetails,
  type ResumePreflightInput
} from "../packages/domain/src/resume-preflight.js";

const TARGET = { retailerId: "target", name: "Target" };
const PENDING = { id: "request_1", createdAt: "2026-09-20T12:00:00.000Z", expiresAt: "2026-09-21T12:00:00.000Z" };

function input(overrides: Partial<ResumePreflightInput> = {}): ResumePreflightInput {
  return {
    actionsPaused: true,
    pauseReason: "Paused by you.",
    pausedAt: "2026-09-20T11:00:00.000Z",
    pausedBy: "shopper",
    executionMode: "live",
    readyStores: [TARGET],
    storeToSetUp: null,
    savedPlanCount: 2,
    cartPlanCount: 1,
    notifyPlanCount: 1,
    dailyCapCents: 20_000,
    availableTodayCents: 15_000,
    pendingRequest: null,
    tenantPause: null,
    ...overrides
  };
}

test("resume preflight blockers, allowed flag, and next action across paused × pending × ready stores", () => {
  const cases: Array<{
    name: string;
    overrides: Partial<ResumePreflightInput>;
    allowed: boolean;
    blockers: string[];
    nextAction: string | null;
  }> = [
    { name: "paused, ready, nothing pending", overrides: {}, allowed: true, blockers: [], nextAction: null },
    { name: "paused, approval pending", overrides: { pendingRequest: PENDING }, allowed: false, blockers: ["approval_pending"], nextAction: "open_activity" },
    {
      name: "paused, no store ready, one to set up",
      overrides: { readyStores: [], storeToSetUp: TARGET },
      allowed: false,
      blockers: ["no_store_ready"],
      nextAction: "store_setup"
    },
    {
      name: "paused, no store ready, nothing to suggest",
      overrides: { readyStores: [] },
      allowed: false,
      blockers: ["no_store_ready"],
      nextAction: "open_stores"
    },
    {
      // approval_pending is listed first so the client's 409-vs-400 choice is stable.
      name: "paused, pending and no store",
      overrides: { readyStores: [], pendingRequest: PENDING },
      allowed: false,
      blockers: ["approval_pending", "no_store_ready"],
      nextAction: "open_activity"
    },
    { name: "not paused", overrides: { actionsPaused: false }, allowed: false, blockers: [], nextAction: null }
  ];
  for (const testCase of cases) {
    const preflight = buildResumePreflight(input(testCase.overrides));
    assert.equal(preflight.allowed, testCase.allowed, testCase.name);
    assert.deepEqual(preflight.blockers.map((blocker) => blocker.code), testCase.blockers, testCase.name);
    assert.equal(preflight.nextAction?.kind ?? null, testCase.nextAction, testCase.name);
  }
  const blocked = buildResumePreflight(input({ readyStores: [], storeToSetUp: TARGET }));
  assert.equal(blocked.blockers[0]?.message, RESUME_BLOCKED_MESSAGE);
  assert.deepEqual(blocked.nextAction, { kind: "store_setup", label: "Set up Target", retailerId: "target", route: "stores/target" });
  assert.deepEqual(resumeBlockedDetails(blocked), { blockers: blocked.blockers, nextAction: blocked.nextAction, summary: blocked.summary });
});

test("resume preflight presentation decides on the paused state first", () => {
  const cases: Array<[Partial<ResumePreflightInput>, string, string]> = [
    [{ actionsPaused: false }, "running", "Running"],
    [{ actionsPaused: false, executionMode: "shadow" }, "test_mode", "Test mode"],
    // A stale pending request must not say "Approval pending" while actions run.
    [{ actionsPaused: false, pendingRequest: PENDING }, "running", "Running"],
    [{ pendingRequest: PENDING }, "approval_pending", "Approval pending"],
    [{ savedPlanCount: 0 }, "setting_up", "Setting up"],
    [{}, "paused", "Paused"],
    [{ executionMode: "shadow" }, "paused", "Paused"]
  ];
  for (const [overrides, presentation, label] of cases) {
    const preflight = buildResumePreflight(input(overrides));
    assert.equal(preflight.presentation, presentation, JSON.stringify(overrides));
    assert.equal(preflight.presentationLabel, label, JSON.stringify(overrides));
  }
});

test("resume preflight summary, confirmation, and tenant pause are server words", () => {
  const ready = buildResumePreflight(input());
  assert.deepEqual(ready.summary, [
    "1 store ready: Target",
    "1 cart-mode plan may add to a cart",
    "1 notify-only plan unchanged",
    "Today: $150.00 left of $200.00"
  ]);
  assert.match(ready.confirmation.summary, /at Target when a call matches a cart-mode plan/);
  assert.equal(ready.pausedByLabel, "you");

  const none = buildResumePreflight(input({ readyStores: [], cartPlanCount: 0, notifyPlanCount: 0, dailyCapCents: null }));
  assert.deepEqual(none.summary, ["No store is ready for cart adds", "No cart-mode plans; watching and calls only", "Today: no limit"]);
  assert.equal(none.confirmation.summary, "No store is ready, so resuming would change nothing yet.");

  const running = buildResumePreflight(input({ actionsPaused: false, tenantPause: { active: true, reason: "Maintenance", pausedAt: "2026-09-20T10:00:00.000Z" } }));
  assert.equal(running.pausedAt, "");
  assert.deepEqual(running.tenantPause, { active: true, overridden: true, reason: "Maintenance", pausedAt: "2026-09-20T10:00:00.000Z" });
  assert.equal(buildResumePreflight(input({ tenantPause: { active: false, reason: "", pausedAt: "" } })).tenantPause, null);
});
