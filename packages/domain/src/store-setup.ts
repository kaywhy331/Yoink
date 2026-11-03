import { MSRP_GUARDED_RETAILERS } from "../../contracts/src/official-msrp.js";
import { ADD_LANES, RETAILER_READINESS_POLICY, type AddLaneId } from "../../contracts/src/add-lanes.js";
import { freshReadinessEvidence, readinessAgeLabel, readinessEvidenceAgeMs } from "./readiness-freshness.js";

interface SetupLane {
  retailerId: AddLaneId;
  qualification: { status: string; warning: string; expiresAt: string; highestAction?: string };
  session: { deviceId: string; signedInState: string; adapterVersion: string; updatedAt: string } | null;
  evidence: { liveEvidenceReady: boolean; rehearsalReady: boolean; qualificationEvidenceReady?: boolean };
  checklist: Array<{ id: string; ready: boolean }>;
  degraded: boolean;
  blockedReason: string;
  candidate: { canonicalUrl: string; title: string } | null;
}

export type StoreSetupAction = "chrome" | "permission" | "sign_in" | "checks" | "activation" | "actions" | "mode" | "refresh";
export interface StoreSetupStep {
  id: string;
  label: string;
  state: "passed" | "attention" | "unknown";
  owner: "You in Chrome" | "You" | "Administrator";
  detail: string;
  action: StoreSetupAction | null;
}

/** The Setup page's one switch per store: whether Yoink may add to cart there, and what the shopper can do about it. */
export interface StoreCartAdds {
  /** on: the shopper's cart adds here were authorized and not turned off or retired. */
  state: "on" | "off";
  /** Adds can happen right now: the store check is current and not failing. */
  ready: boolean;
  canTurnOn: boolean;
  canTurnOff: boolean;
  /** Off, and only a Yoink administrator can turn it on (a hosted shopper). */
  needsAdmin: boolean;
  /** One plain sentence for the shopper. */
  status: string;
  /** Wanted cart items sold here that would start adding to cart here when it is turned on. */
  wantsToJoin: number;
}

/** A shopper explanation of existing gates, never an authorization to execute. */
export function buildStoreSetup(input: {
  lanes: SetupLane[];
  devices: Array<Record<string, unknown>>;
  version: string;
  settings: { actionsPaused: boolean; executionMode: string };
  permissions: readonly string[];
  now: number;
  /** Per store, how many wanted cart items would join it (ControlRepository.wantedCartItemsMissingStoreCounts). */
  wantsToJoin?: Readonly<Record<string, number>>;
}) {
  return input.lanes.map(lane => {
    const definition = ADD_LANES[lane.retailerId];
    const matchingDevices = input.devices.filter(device => {
      const capabilities = device.capabilities as Record<string, unknown> | undefined;
      return device.status === "active" && device.extensionVersion === input.version
        && capabilities?.jobReconciliation === true
        && (!MSRP_GUARDED_RETAILERS.includes(lane.retailerId) || capabilities.officialMsrpCartV1 === true)
        && capabilities[definition.capability.enabled] === true
        && capabilities[definition.capability.version] === definition.contractVersion;
    });
    const currentDevices = matchingDevices.filter(device => device.online === true
      && freshReadinessEvidence(device.lastSeenAt, input.now, RETAILER_READINESS_POLICY.deviceMaxAgeMs));
    const sessionAgeMs = readinessEvidenceAgeMs(lane.session?.updatedAt, input.now);
    const freshSession = Boolean(lane.session && currentDevices.some(device => device.id === lane.session?.deviceId)
      && lane.session.adapterVersion === definition.contractVersion
      && freshReadinessEvidence(lane.session.updatedAt, input.now, RETAILER_READINESS_POLICY.sessionMaxAgeMs));
    // Never borrow permission from another browser to validate this session.
    const permissionDevice = lane.session
      ? matchingDevices.find(device => device.id === lane.session?.deviceId)
      : [...matchingDevices].sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))[0];
    const permissionAgeMs = readinessEvidenceAgeMs(permissionDevice?.lastSeenAt, input.now);
    const accessibleRetailers = permissionDevice?.accessibleRetailers;
    const permissionKnown = Boolean(permissionDevice && currentDevices.includes(permissionDevice)
      && Array.isArray(accessibleRetailers)
      && accessibleRetailers.every(id => typeof id === "string" && Object.hasOwn(ADD_LANES, id)));
    const permissionGranted = permissionKnown && (accessibleRetailers as string[]).includes(lane.retailerId);
    const permissionDetail = permissionKnown
      ? `Chrome reported this store ${permissionGranted ? "allowed" : "not allowed"} ${readinessAgeLabel(permissionAgeMs!)}. ${permissionGranted
        ? "Yoink checks permission again before an Add."
        : "In the Yoink extension, open Settings → Store access to allow it."}`
      : `Store permission is unknown. ${permissionAgeMs !== null
        ? `The matching browser's last report was ${readinessAgeLabel(permissionAgeMs)}; current permission evidence is unavailable. ` : ""}Open the paired Chrome browser and check Settings → Store access.`;
    const sessionAgeDetail = sessionAgeMs === null ? "" : ` Last check: ${readinessAgeLabel(sessionAgeMs)}${freshSession ? "." : "; not current."}`;
    const signedIn = freshSession && lane.session?.signedInState === "ready";
    const sessionBlocked = freshSession && ["signed_out", "challenged"].includes(lane.session?.signedInState || "");
    const activated = lane.checklist.some(check => check.id === "qualification" && check.ready);
    const healthVerified = lane.evidence.liveEvidenceReady && lane.evidence.rehearsalReady;
    const canActivate = input.permissions.includes("admin.read") && input.permissions.includes("qualification.manage");
    const canManageActions = input.permissions.includes("user.settings.manage");
    const step = (id: string, label: string, passed: boolean, owner: StoreSetupStep["owner"], detail: string, action: StoreSetupAction, unknown = false): StoreSetupStep =>
      ({ id, label, state: passed ? "passed" : unknown ? "unknown" : "attention", owner, detail, action: passed ? null : action });
    const steps: StoreSetupStep[] = [
      step("companion", "Paired Chrome", currentDevices.length > 0, "You in Chrome",
        currentDevices.length ? `${currentDevices.length} current browser${currentDevices.length === 1 ? " is" : "s are"} online with ${definition.name} cart support.` : `Open your paired Chrome browser with Yoink ${input.version}, or update and pair it in Chrome settings.`, "chrome"),
      step("permission", "Store permission", permissionGranted, "You in Chrome",
        permissionDetail, "permission", !permissionKnown),
      step("sign_in", "Store sign-in", signedIn, "You in Chrome", signedIn
        ? `A current Chrome check reported a signed-in store session. Yoink checks again before an Add.${sessionAgeDetail}`
        : sessionBlocked ? lane.session?.signedInState === "challenged"
          ? `The store needs a manual security check. Complete it yourself in the paired Chrome browser, then run the store check again.${sessionAgeDetail}`
          : `Chrome reported that you are signed out. Sign in yourself at this store, then run the store check again.${sessionAgeDetail}`
        : `Sign-in is not freshly verified. Open this store in your paired Chrome browser and run the store check.${sessionAgeDetail}`, "sign_in", !sessionBlocked),
      step("evidence", "Product evidence", lane.evidence.liveEvidenceReady, "You in Chrome",
        lane.evidence.liveEvidenceReady ? "The required current product observations have been collected."
          : "Open an available first-party product in Chrome and use the extension’s store checks to collect product evidence without adding to cart.", "checks"),
      step("rehearsal", "No-click check", lane.evidence.rehearsalReady, "You in Chrome",
        lane.evidence.rehearsalReady ? "The required no-click check passed."
          : "Run Check again in the extension’s Settings. It inspects a supported product without adding anything to your cart.", "checks"),
      // Whoever may turn the store on owns this step: the shopper in Setup ›
      // Stores on their own Yoink, an administrator on a shared one.
      step("activation", "Store turned on", activated, canActivate ? "You" : "Administrator", activated
        ? `This store is on${lane.qualification.expiresAt ? ` until ${lane.qualification.expiresAt}` : ""}.`
        : canActivate
          ? lane.qualification.status === "retired" ? "You turned this store off. Turn it on again in Setup › Stores after a current store check."
            : lane.qualification.status === "missing" ? "After the product evidence and no-click checks pass, turn this store on in Setup › Stores. Checks alone do not turn on cart adds."
              : "This store needs a current store check. Yoink renews it on its own when the check passes in Chrome."
          : lane.qualification.status === "retired" ? "This store was retired. An administrator must review current evidence and explicitly activate it again."
            : lane.qualification.status === "missing" ? "After product evidence and no-click checks pass, an administrator must explicitly activate this store. Checks alone do not enable cart adds."
              : "Activation needs current store checks. Automatic renewal can refresh a previously authorized store; it cannot authorize a new store.", "activation"),
      step("health", "Store check health", !lane.degraded && healthVerified, "You in Chrome", lane.degraded
        ? "Recent store checks are failing. Run Check again; an administrator can review persistent failures."
        : healthVerified ? "Current product evidence and no-click checks passed."
        : "Store checks are not verified yet.", "checks", !lane.degraded && !healthVerified),
      step("mode", "Live execution", input.settings.executionMode === "live", "Administrator",
        input.settings.executionMode === "live" ? "Live mode is enabled. Yoink still checks each exact offer before adding one item."
          : "Test mode is enabled. An administrator must review the execution settings before live cart actions can run.", "mode"),
      step("pause", "Auto-cart", !input.settings.actionsPaused, canManageActions ? "You" : "Administrator",
        input.settings.actionsPaused ? "Auto-cart is off. Turning it on does not turn on a store or resume an item you paused."
          : "Auto-cart is on. Each item keeps its own status and limits.", "actions")
    ];
    const nextStep = steps.find(item => item.state === "attention")
      ?? steps.find(item => item.id === "sign_in" && item.state === "unknown")
      ?? steps.find(item => item.id === "permission" && item.state === "unknown");
    const checksPassed = steps.every(item => item.state === "passed");
    // The same authorization the job lease accepts; a retired store is off.
    const authorized = (lane.qualification.status === "qualified" || lane.qualification.status === "suspended")
      && ["add_to_cart", "prepare_checkout", "submit_order"].includes(lane.qualification.highestAction ?? "add_to_cart");
    const storeChecksReady = authorized && activated && !lane.degraded;
    const cartAddsReady = storeChecksReady && signedIn && permissionGranted
      && !input.settings.actionsPaused && input.settings.executionMode === "live";
    const companionOnline = currentDevices.length > 0;
    const evidenceReady = lane.evidence.qualificationEvidenceReady === true;
    const canTurnOn = !authorized && canActivate && evidenceReady && companionOnline;
    const name = definition.name;
    // The store check refreshes on its own once the companion runs it; until
    // then a live match at this store becomes an alert instead of a cart add.
    const cartAddsStatus = authorized
      ? !storeChecksReady ? "On · waiting for a store check in Chrome. You get alerts until it passes."
        : !companionOnline ? "On · open Chrome with the Yoink companion so Yoink can add to your cart"
          : !permissionKnown ? "On · store permission is not freshly verified in Chrome"
          : !permissionGranted ? "On · allow this store in Chrome's Store access settings"
          : input.settings.actionsPaused ? "On · Auto-cart is paused"
          : input.settings.executionMode !== "live" ? "On · test mode is enabled"
          : signedIn ? `On · signed in at ${name} in Chrome`
            : lane.session?.signedInState === "challenged" && sessionBlocked ? `On · finish ${name}'s security check in Chrome`
              : sessionBlocked ? `On · sign in at ${name} in Chrome`
                : "On · sign-in is not freshly verified in Chrome"
      : !canActivate ? "Off · your Yoink administrator turns this store on"
        : canTurnOn ? "Off · ready to turn on"
          : !evidenceReady ? `Off · run ${name}'s store check in Chrome first`
            : "Off · open Chrome with the Yoink companion to turn this on";
    const cartAdds: StoreCartAdds = {
      state: authorized ? "on" : "off",
      ready: cartAddsReady,
      canTurnOn,
      canTurnOff: authorized && canManageActions,
      needsAdmin: !authorized && !canActivate,
      status: cartAddsStatus,
      wantsToJoin: Math.max(0, Number(input.wantsToJoin?.[lane.retailerId] ?? 0)) || 0
    };
    const qualificationNotice = ({
      expiring: "Store activation expires soon. Refresh the store checks.",
      expired: "Store activation expired. Refresh the evidence and review activation.",
      version_changed: "Store support was updated. Current checks and activation are required.",
      pack_unverified: "A store check is required after the store update."
    } as Record<string, string>)[lane.qualification.warning] || "";
    return {
      retailerId: lane.retailerId,
      retailerName: definition.name,
      capabilities: { browse: true, notify: true, inspect: true, guardedAdd: true },
      permissionEvidence: {
        state: permissionKnown ? permissionGranted ? "granted" : "denied" : "unknown",
        deviceId: permissionDevice?.id ?? null,
        observedAt: permissionDevice?.lastSeenAt ?? null,
        ageMs: permissionAgeMs
      },
      sessionEvidence: { fresh: freshSession, observedAt: lane.session?.updatedAt ?? null, ageMs: sessionAgeMs },
      summary: checksPassed ? qualificationNotice || "Store checks passed; Chrome verifies permission and each fresh offer."
        : nextStep ? `${nextStep.label} needs attention.` : "Verify this store in Chrome.",
      checksPassed,
      steps,
      nextAction: nextStep?.action ?? (lane.qualification.warning === "expiring" ? "checks" : "permission") as StoreSetupAction,
      nextOwner: nextStep?.owner ?? "You in Chrome",
      canActivate,
      canManageActions,
      canResumeActions: canManageActions && input.lanes.some(item => item.checklist.some(check => check.id === "qualification" && check.ready)),
      canManageExecution: input.permissions.includes("admin.read") && input.permissions.includes("user.settings.manage"),
      candidate: lane.candidate,
      candidateNote: lane.blockedReason === "no_candidate" ? "No saved check product is available. Open an available first-party product in Chrome."
        : lane.blockedReason === "no_purchasable_candidate" ? "Saved products are not currently purchasable. Choose an available first-party product for a no-click check." : "",
      qualificationNotice,
      cartAdds
    };
  });
}
