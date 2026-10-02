import assert from "node:assert/strict";
import test from "node:test";
import { ADD_LANES } from "../packages/contracts/src/add-lanes.js";
import { buildStoreSetup } from "../packages/domain/src/store-setup.js";

type Input = Parameters<typeof buildStoreSetup>[0];
const now = Date.parse("2026-09-05T12:00:00Z");
function fixture(): Input {
  return {
    now, version: "1.2.3", settings: { actionsPaused: false, executionMode: "live" },
    permissions: ["user.read", "user.settings.manage"],
    devices: [{ id: "device_current", status: "active", extensionVersion: "1.2.3", online: true, lastSeenAt: new Date(now).toISOString(),
      capabilities: { officialMsrpCartV1: true, jobReconciliation: true, targetAddOnly: true, targetAddAdapterVersion: ADD_LANES.target.contractVersion } }],
    lanes: [{ retailerId: "target", qualification: { status: "qualified", warning: "none", expiresAt: new Date(now + 3600000).toISOString() },
      session: { deviceId: "device_current", signedInState: "ready", adapterVersion: ADD_LANES.target.contractVersion, updatedAt: new Date(now).toISOString() },
      evidence: { liveEvidenceReady: true, rehearsalReady: true }, checklist: [{ id: "qualification", ready: true }],
      degraded: false, blockedReason: "", candidate: null }]
  };
}
const project = (input = fixture()) => buildStoreSetup(input)[0]!;
const step = (input: Input, id: string) => project(input).steps.find(item => item.id === id)!;

test("passed checks never claim a browser permission or authorize an Add", () => {
  const input = fixture();
  const before = structuredClone(input);
  const store = project(input);
  assert.equal(store.checksPassed, true);
  assert.equal(step(input, "permission").state, "unknown");
  assert.match(store.summary, /Chrome verifies permission and each fresh offer/);
  assert.equal(store.nextAction, "permission");
  assert.equal(store.canActivate, false);
  assert.equal(store.canResumeActions, true);
  assert.equal("mutationAuthorized" in store, false);
  assert.deepEqual(input, before);
});

for (const [name, change] of Object.entries({
  offline: (input: Input) => { input.devices[0]!.online = false; },
  revoked: (input: Input) => { input.devices[0]!.status = "revoked"; },
  old_extension: (input: Input) => { input.devices[0]!.extensionVersion = "0.0.1"; },
  old_adapter: (input: Input) => { (input.devices[0]!.capabilities as any).targetAddAdapterVersion = "target-add-v0"; },
  no_msrp_guard: (input: Input) => { (input.devices[0]!.capabilities as any).officialMsrpCartV1 = false; },
  no_reconciliation: (input: Input) => { (input.devices[0]!.capabilities as any).jobReconciliation = false; },
  future_device: (input: Input) => { input.devices[0]!.lastSeenAt = new Date(now + 600001).toISOString(); }
})) test(`${name} Chrome cannot satisfy this store's companion or sign-in checks`, () => {
  const input = fixture(); change(input);
  assert.equal(project(input).checksPassed, false);
  assert.equal(project(input).nextAction, "chrome");
  assert.equal(step(input, "sign_in").state, "unknown");
});

for (const [name, change] of Object.entries({
  stale: (input: Input) => { input.lanes[0]!.session!.updatedAt = new Date(now - 300001).toISOString(); },
  future: (input: Input) => { input.lanes[0]!.session!.updatedAt = new Date(now + 300001).toISOString(); },
  other_device: (input: Input) => { input.lanes[0]!.session!.deviceId = "device_other"; },
  old_adapter: (input: Input) => { input.lanes[0]!.session!.adapterVersion = "target-add-v0"; }
})) test(`${name} session evidence stays unknown`, () => {
  const input = fixture(); change(input);
  assert.equal(step(input, "sign_in").state, "unknown");
  assert.equal(project(input).checksPassed, false);
  assert.equal(project(input).nextAction, "sign_in");
});

for (const state of ["signed_out", "challenged"]) test(`${state} requires manual store recovery`, () => {
  const input = fixture(); input.lanes[0]!.session!.signedInState = state;
  assert.equal(step(input, "sign_in").state, "attention");
  assert.equal(project(input).nextAction, "sign_in");
  assert.match(step(input, "sign_in").detail, state === "challenged" ? /Complete it yourself/ : /Sign in yourself/);
});

test("passing evidence and rehearsal do not activate a missing or retired store", () => {
  for (const status of ["missing", "retired", "suspended", "qualified"]) {
    const input = fixture(); input.lanes[0]!.qualification.status = status; input.lanes[0]!.checklist[0]!.ready = false;
    assert.equal(step(input, "evidence").state, "passed");
    assert.equal(step(input, "rehearsal").state, "passed");
    assert.equal(step(input, "activation").state, "attention");
    assert.equal(project(input).nextAction, "activation");
    assert.equal(project(input).canResumeActions, false);
    assert.equal(project(input).nextOwner, "Administrator");
    assert.equal(project(input).checksPassed, false);
  }
});

test("an account that may turn stores on itself owns activation in Setup; others keep the administrator", () => {
  const input = fixture(); input.permissions = ["admin.read", "qualification.manage", "user.settings.manage"];
  input.lanes[0]!.qualification.status = "missing"; input.lanes[0]!.checklist[0]!.ready = false;
  assert.equal(step(input, "activation").owner, "You");
  assert.match(step(input, "activation").detail, /turn this store on in Setup › Stores/);
  assert.equal(project(input).nextOwner, "You");
  input.lanes[0]!.qualification.status = "retired";
  assert.match(step(input, "activation").detail, /You turned this store off/);
  input.lanes[0]!.qualification.status = "qualified";
  assert.match(step(input, "activation").detail, /renews it on its own/);
  input.permissions = ["user.read", "user.settings.manage"]; input.lanes[0]!.qualification.status = "missing";
  assert.equal(step(input, "activation").owner, "Administrator");
  assert.match(step(input, "activation").detail, /an administrator must explicitly activate this store/);
});

test("the pause step is the Auto-cart switch, in its words", () => {
  const input = fixture();
  assert.equal(step(input, "pause").label, "Auto-cart");
  assert.match(step(input, "pause").detail, /^Auto-cart is on\./);
  input.settings = { actionsPaused: true, executionMode: "live" };
  assert.match(step(input, "pause").detail, /^Auto-cart is off\./);
});

test("pause, test mode, degradation, evidence and rehearsal are independent gates", () => {
  const input = fixture(); input.settings = { actionsPaused: true, executionMode: "shadow" };
  input.lanes[0]!.degraded = true;
  input.lanes[0]!.evidence = { liveEvidenceReady: false, rehearsalReady: false };
  for (const id of ["evidence", "rehearsal", "health", "mode", "pause"]) assert.equal(step(input, id).state, "attention");
  assert.equal(step(input, "activation").state, "passed");
  assert.equal(project(input).nextAction, "checks");
  input.permissions = ["user.read"];
  assert.equal(step(input, "pause").owner, "Administrator");
  assert.equal(project(input).canManageActions, false);
  input.permissions = ["admin.read", "qualification.manage", "user.settings.manage"];
  assert.equal(project(input).canActivate, true);
  assert.equal(project(input).canManageExecution, true);
});

test("each packaged store requires its own current adapter", () => {
  for (const definition of Object.values(ADD_LANES)) {
    const input = fixture(); input.lanes[0]!.retailerId = definition.id;
    input.lanes[0]!.session!.adapterVersion = definition.contractVersion;
    input.devices[0]!.capabilities = { officialMsrpCartV1: true, jobReconciliation: true, [definition.capability.enabled]: true, [definition.capability.version]: definition.contractVersion };
    assert.equal(project(input).checksPassed, true);
    assert.equal(project(input).retailerName, definition.name);
  }
});


test("qualification warnings remain visible independently of sign-in and other blockers", () => {
  const input = fixture(); input.lanes[0]!.qualification.warning = "expiring";
  assert.equal(project(input).checksPassed, true);
  assert.match(project(input).summary, /expires soon/);
  assert.equal(project(input).nextAction, "checks");
  for (const warning of ["expired", "version_changed", "pack_unverified"]) {
    input.lanes[0]!.qualification.warning = warning;
    input.lanes[0]!.checklist[0]!.ready = false;
    assert.ok(project(input).qualificationNotice);
    assert.equal(project(input).checksPassed, false);
    assert.equal(step(input, "sign_in").state, "passed");
  }
});


test("absence of failures cannot mark an unchecked store healthy", () => {
  const input = fixture();
  input.lanes[0]!.evidence = { liveEvidenceReady: false, rehearsalReady: false };
  assert.equal(input.lanes[0]!.degraded, false);
  assert.equal(step(input, "health").state, "unknown");
  assert.equal(project(input).checksPassed, false);
});

test("the cart-add switch says plainly whether a store is on, ready, and who can turn it on", () => {
  const statuses: string[] = [];
  const cartAdds = (input: Input) => {
    const projected = project(input).cartAdds;
    statuses.push(projected.status);
    return projected;
  };
  const input = fixture();
  assert.deepEqual(cartAdds(input), {
    state: "on", ready: true, canTurnOn: false, canTurnOff: true, needsAdmin: false,
    status: "On · signed in at Target in Chrome", wantsToJoin: 0
  });
  input.lanes[0]!.session!.signedInState = "signed_out";
  assert.equal(cartAdds(input).status, "On · sign in at Target in Chrome");
  input.lanes[0]!.session!.signedInState = "challenged";
  assert.equal(cartAdds(input).status, "On · finish Target's security check in Chrome");
  input.devices[0]!.online = false;
  assert.equal(cartAdds(input).status, "On · open Chrome with the Yoink companion so Yoink can add to your cart");
  // A lapsed or failing store check keeps the store on but not ready.
  for (const change of [(lane: Input["lanes"][number]) => { lane.checklist[0]!.ready = false; }, (lane: Input["lanes"][number]) => { lane.degraded = true; }]) {
    const lapsed = fixture();
    change(lapsed.lanes[0]!);
    assert.deepEqual([cartAdds(lapsed).state, cartAdds(lapsed).ready], ["on", false]);
    assert.equal(cartAdds(lapsed).status, "On · waiting for a store check in Chrome. You get alerts until it passes.");
  }

  // Never authorized, retired, or only partly authorized: off.
  for (const status of ["missing", "retired"]) {
    const off = fixture();
    off.lanes[0]!.qualification.status = status;
    assert.deepEqual(cartAdds(off), {
      state: "off", ready: false, canTurnOn: false, canTurnOff: false, needsAdmin: true,
      status: "Off · your Yoink administrator turns this store on", wantsToJoin: 0
    });
  }
  const inspectOnly = fixture();
  inspectOnly.lanes[0]!.qualification.highestAction = "inspect";
  assert.equal(cartAdds(inspectOnly).state, "off");

  // The local owner turns a store on once its store check passed and Chrome is online.
  const owner = fixture();
  owner.permissions = ["admin.read", "qualification.manage", "user.settings.manage"];
  owner.lanes[0]!.qualification.status = "missing";
  owner.lanes[0]!.evidence = { liveEvidenceReady: true, rehearsalReady: true, qualificationEvidenceReady: true };
  owner.wantsToJoin = { target: 3, walmart: 1 };
  assert.deepEqual(cartAdds(owner), {
    state: "off", ready: false, canTurnOn: true, canTurnOff: false, needsAdmin: false,
    status: "Off · ready to turn on", wantsToJoin: 3
  });
  owner.devices[0]!.online = false;
  assert.deepEqual([cartAdds(owner).canTurnOn, cartAdds(owner).status], [false, "Off · open Chrome with the Yoink companion to turn this on"]);
  owner.lanes[0]!.evidence.qualificationEvidenceReady = false;
  assert.equal(cartAdds(owner).status, "Off · run Target's store check in Chrome first");

  for (const status of statuses) assert.doesNotMatch(status, /lane|qualif|rehears|evidence|shadow/i, status);
});
