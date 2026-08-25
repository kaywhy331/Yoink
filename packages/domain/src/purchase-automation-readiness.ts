import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION
} from "../../contracts/src/index.js";

export const PURCHASE_AUTOMATION_READINESS_CONTRACT_VERSION = 1;

export type PurchaseAutomationReadinessState =
  | "inactive"
  | "expired"
  | "advanced_strategy"
  | "needs_target"
  | "needs_signal"
  | "needs_current_companion"
  | "companion_offline"
  | "notification_ready"
  | "guarded_add_policy_incomplete"
  | "guarded_add_lane_closed"
  | "guarded_add_device_incapable"
  | "guarded_add_shadow"
  | "guarded_add_paused"
  | "guarded_add_armed";

export type PurchaseAutomationReadinessLevel = "ready" | "waiting" | "attention" | "off";
export type PurchaseAutomationCheckState = "pass" | "waiting" | "attention" | "runtime";

export interface PurchaseAutomationCheck {
  id: string;
  label: string;
  state: PurchaseAutomationCheckState;
  detail: string;
}

export interface PurchaseAutomationTargetInput {
  targetId?: string;
  id?: string;
  listingId?: string;
  retailerId: string;
  retailerName?: string;
  retailerSku?: string;
  enabled: boolean;
  executionSupported: boolean;
  maxUnitPriceCents: number | null;
  sellerPolicy: string;
  fulfillment: string;
}

export interface PurchaseAutomationPlanInput {
  id: string;
  status: string;
  title?: string;
  targetQuantity: number;
  actionCeiling: string;
  decisionMode: string;
  expiresAt?: string;
  targets: PurchaseAutomationTargetInput[];
}

export interface PurchaseAutomationReadinessContext {
  version: string;
  executionMode: string;
  actionsPaused: boolean;
  sources: Array<Record<string, unknown>>;
  devices: Array<Record<string, unknown>>;
  qualifications: Partial<Record<GuardedRetailerId, boolean>>;
  now?: number;
}

export interface PurchaseAutomationTargetReadiness {
  targetId: string;
  listingId: string;
  retailerId: string;
  retailerName: string;
  retailerSku: string;
  packagedMapping: boolean;
  reviewedPolicy: boolean;
  laneQualified: boolean;
  companionCapable: boolean;
  readyForGuardedAdd: boolean;
  reasonCode:
    | "mapping_unavailable"
    | "policy_incomplete"
    | "lane_not_qualified"
    | "companion_adapter_unavailable"
    | "runtime_offer_required"
    | "armed_for_fresh_offer";
  summary: string;
}

export interface PurchaseAutomationReadiness {
  contractVersion: typeof PURCHASE_AUTOMATION_READINESS_CONTRACT_VERSION;
  state: PurchaseAutomationReadinessState;
  level: PurchaseAutomationReadinessLevel;
  configuredAction: "notify" | "add_to_cart" | "advanced";
  effectiveAutomation: "none" | "notification" | "guarded_add";
  readyForMonitoring: boolean;
  readyForGuardedAdd: boolean;
  headline: string;
  summary: string;
  nextAction:
    | "review_plan"
    | "connect_signal"
    | "update_companion"
    | "open_chrome"
    | "resume_actions"
    | "enable_live_mode"
    | "wait_for_offer"
    | null;
  nextActionLabel: string;
  runtimeProof: "required_at_action_time";
  guardedAddAttemptQuantity: 1;
  checks: PurchaseAutomationCheck[];
  targets: PurchaseAutomationTargetReadiness[];
}

type GuardedRetailerId = "target" | "walmart" | "amazon" | "bestbuy";

interface RetailerLane {
  label: string;
  capability: "targetAddOnly" | "walmartAddOnly" | "amazonAddOnly" | "bestBuyAddOnly";
  versionCapability:
    | "targetAddAdapterVersion"
    | "walmartAddAdapterVersion"
    | "amazonAddAdapterVersion"
    | "bestBuyAddAdapterVersion";
  adapterVersion: string;
}

const RETAILER_LANES: Record<GuardedRetailerId, RetailerLane> = {
  target: {
    label: "Target",
    capability: "targetAddOnly",
    versionCapability: "targetAddAdapterVersion",
    adapterVersion: TARGET_ADD_ADAPTER_VERSION
  },
  walmart: {
    label: "Walmart",
    capability: "walmartAddOnly",
    versionCapability: "walmartAddAdapterVersion",
    adapterVersion: WALMART_ADD_ADAPTER_VERSION
  },
  amazon: {
    label: "Amazon",
    capability: "amazonAddOnly",
    versionCapability: "amazonAddAdapterVersion",
    adapterVersion: AMAZON_ADD_ADAPTER_VERSION
  },
  bestbuy: {
    label: "Best Buy",
    capability: "bestBuyAddOnly",
    versionCapability: "bestBuyAddAdapterVersion",
    adapterVersion: BESTBUY_ADD_ADAPTER_VERSION
  }
};

function guardedRetailer(value: string): GuardedRetailerId | null {
  return Object.prototype.hasOwnProperty.call(RETAILER_LANES, value) ? value as GuardedRetailerId : null;
}

function deviceCapabilities(device: Record<string, unknown>): Record<string, unknown> {
  return device.capabilities && typeof device.capabilities === "object" && !Array.isArray(device.capabilities)
    ? device.capabilities as Record<string, unknown>
    : {};
}

function deviceSupportsRetailer(device: Record<string, unknown>, retailerId: string): boolean {
  const id = guardedRetailer(retailerId);
  if (!id) return false;
  const lane = RETAILER_LANES[id];
  const capabilities = deviceCapabilities(device);
  return capabilities.jobReconciliation === true
    && capabilities[lane.capability] === true
    && capabilities[lane.versionCapability] === lane.adapterVersion;
}

function targetLabel(target: PurchaseAutomationTargetInput): string {
  const id = guardedRetailer(target.retailerId);
  return String(target.retailerName || (id ? RETAILER_LANES[id].label : target.retailerId) || "Store");
}

function joinedStores(targets: PurchaseAutomationTargetInput[]): string {
  const names = [...new Set(targets.map(targetLabel))];
  if (!names.length) return "This store";
  if (names.length === 1) return names[0] ?? "This store";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function check(
  id: string,
  label: string,
  state: PurchaseAutomationCheckState,
  detail: string
): PurchaseAutomationCheck {
  return { id, label, state, detail };
}

function result(
  state: PurchaseAutomationReadinessState,
  level: PurchaseAutomationReadinessLevel,
  configuredAction: PurchaseAutomationReadiness["configuredAction"],
  effectiveAutomation: PurchaseAutomationReadiness["effectiveAutomation"],
  readyForMonitoring: boolean,
  headline: string,
  summary: string,
  nextAction: PurchaseAutomationReadiness["nextAction"],
  nextActionLabel: string,
  checks: PurchaseAutomationCheck[],
  targets: PurchaseAutomationTargetReadiness[]
): PurchaseAutomationReadiness {
  return {
    contractVersion: PURCHASE_AUTOMATION_READINESS_CONTRACT_VERSION,
    state,
    level,
    configuredAction,
    effectiveAutomation,
    readyForMonitoring,
    readyForGuardedAdd: state === "guarded_add_armed",
    headline,
    summary,
    nextAction,
    nextActionLabel,
    runtimeProof: "required_at_action_time",
    guardedAddAttemptQuantity: 1,
    checks,
    targets
  };
}

export function buildPurchaseAutomationReadiness(
  plan: PurchaseAutomationPlanInput,
  context: PurchaseAutomationReadinessContext
): PurchaseAutomationReadiness {
  const now = Number.isFinite(context.now) ? Number(context.now) : Date.now();
  const directPlan = plan.decisionMode === "purchase_intent";
  const configuredAction: PurchaseAutomationReadiness["configuredAction"] = directPlan
    ? plan.actionCeiling === "add_to_cart" ? "add_to_cart" : "notify"
    : "advanced";
  const enabledTargets = (Array.isArray(plan.targets) ? plan.targets : []).filter((target) => target.enabled === true);
  const connectedSignal = context.sources.some((source) => source.source !== "user_link" && source.status === "connected");
  const currentDevices = context.devices.filter((device) => device.status === "active" && device.extensionVersion === context.version);
  const onlineCurrentDevices = currentDevices.filter((device) => device.online === true);
  const notificationDevices = currentDevices.filter((device) => deviceCapabilities(device).notifications === true);
  const onlineNotificationDevices = notificationDevices.filter((device) => device.online === true);
  const active = plan.status === "active";
  const expiry = plan.expiresAt ? new Date(plan.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const expired = Boolean(plan.expiresAt) && (!Number.isFinite(expiry) || expiry <= now);
  const policyTargetsSafe = enabledTargets.length > 0 && enabledTargets.every((target) =>
    target.executionSupported === true
      && Number.isSafeInteger(Number(target.maxUnitPriceCents))
      && Number(target.maxUnitPriceCents) > 0
      && target.sellerPolicy === "first_party_only"
      && target.fulfillment === "shipping"
  );

  const targetReadiness: PurchaseAutomationTargetReadiness[] = enabledTargets.map((target) => {
    const retailerId = guardedRetailer(target.retailerId);
    const reviewedPolicy = Number.isSafeInteger(Number(target.maxUnitPriceCents))
      && Number(target.maxUnitPriceCents) > 0
      && target.sellerPolicy === "first_party_only"
      && target.fulfillment === "shipping";
    const packagedMapping = target.executionSupported === true && retailerId !== null;
    const laneQualified = retailerId !== null && context.qualifications[retailerId] === true;
    const companionCapable = onlineCurrentDevices.some((device) => deviceSupportsRetailer(device, target.retailerId));
    const globallyReady = active && !expired && directPlan && configuredAction === "add_to_cart"
      && connectedSignal && context.executionMode === "live" && !context.actionsPaused;
    const readyForGuardedAdd = globallyReady && policyTargetsSafe && packagedMapping && laneQualified && companionCapable;
    let reasonCode: PurchaseAutomationTargetReadiness["reasonCode"];
    let summary: string;
    if (!packagedMapping) {
      reasonCode = "mapping_unavailable";
      summary = "Yoink can monitor this exact item, but this store has no packaged add-only runner.";
    } else if (!reviewedPolicy) {
      reasonCode = "policy_incomplete";
      summary = "Set a maximum item price, Store only seller, and Shipping before this target can be armed.";
    } else if (!laneQualified) {
      reasonCode = "lane_not_qualified";
      summary = `${targetLabel(target)} add-only execution has not completed its separate safety qualification.`;
    } else if (!companionCapable) {
      reasonCode = "companion_adapter_unavailable";
      summary = `No online current Chrome companion has the qualified ${targetLabel(target)} add-only runner.`;
    } else if (readyForGuardedAdd) {
      reasonCode = "armed_for_fresh_offer";
      summary = "Armed for one guarded cart add after a fresh exact offer passes every live check.";
    } else {
      reasonCode = "runtime_offer_required";
      summary = "The store lane is ready, but global setup must be ready and every action still needs a fresh exact offer.";
    }
    return {
      targetId: String(target.targetId || target.id || ""),
      listingId: String(target.listingId || ""),
      retailerId: target.retailerId,
      retailerName: targetLabel(target),
      retailerSku: String(target.retailerSku || ""),
      packagedMapping,
      reviewedPolicy,
      laneQualified,
      companionCapable,
      readyForGuardedAdd,
      reasonCode,
      summary
    };
  });

  const baseChecks: PurchaseAutomationCheck[] = [
    check("plan", "Plan is active", active && !expired ? "pass" : "attention",
      active ? expired ? "This plan's end time has passed." : "The purchase plan is active." : "Turn the plan on before expecting monitoring or actions."),
    check("decision", "Reviewed decision", directPlan ? "pass" : "attention",
      directPlan ? "This saved plan—not an advanced global strategy—sets the action boundary." : "Review and save this legacy strategy plan before relying on it from the user dashboard."),
    check("targets", "Exact store item", enabledTargets.length ? "pass" : "attention",
      enabledTargets.length ? `${enabledTargets.length} exact store target${enabledTargets.length === 1 ? " is" : "s are"} enabled.` : "Enable at least one exact store item."),
    check("signal", "Product signal", connectedSignal ? "pass" : "waiting",
      connectedSignal ? "A non-manual signal source is connected." : "Connect a supported signal source so Yoink can learn when the exact offer changes."),
    check("companion", "Current Chrome companion", notificationDevices.length
      ? onlineNotificationDevices.length ? "pass" : "waiting"
      : "attention",
    notificationDevices.length
      ? onlineNotificationDevices.length ? `Yoink ${context.version} is online.` : `Yoink ${context.version} is paired but Chrome is offline.`
      : `Install and pair a notification-capable Yoink ${context.version} companion.`)
  ];

  const readyForMonitoring = active && !expired && directPlan && enabledTargets.length > 0
    && connectedSignal && notificationDevices.length > 0;

  if (!active) {
    return result("inactive", "off", configuredAction, "none", false,
      "This purchase plan is turned off",
      "Its limits stay saved, but Yoink will not monitor or act for this plan.",
      "review_plan", "Review plan", baseChecks, targetReadiness);
  }
  if (expired) {
    return result("expired", "off", configuredAction, "none", false,
      "This purchase plan has ended",
      "Choose a new end time only after reviewing the exact item and limits again.",
      "review_plan", "Review end time", baseChecks, targetReadiness);
  }
  if (!directPlan) {
    return result("advanced_strategy", "attention", "advanced", "none", false,
      "Review this legacy automation plan",
      "It still delegates decisions to advanced global strategies. Saving it from this dashboard converts it to an explicit user-controlled plan.",
      "review_plan", "Review plan", baseChecks, targetReadiness);
  }
  if (!enabledTargets.length) {
    return result("needs_target", "attention", configuredAction, "none", false,
      "Choose an exact store item",
      "This plan has no enabled retailer target, so no signal can match it.",
      "review_plan", "Choose store item", baseChecks, targetReadiness);
  }

  if (configuredAction === "notify") {
    if (!connectedSignal) {
      return result("needs_signal", "waiting", "notify", "none", false,
        "Connect a product signal",
        "The exact plan is saved, but Yoink needs a supported signal source before it can notify you.",
        "connect_signal", "Connect signal", baseChecks, targetReadiness);
    }
    if (!notificationDevices.length) {
      return result("needs_current_companion", "attention", "notify", "none", false,
        "Update and pair the Chrome companion",
        `Notifications need an active Yoink ${context.version} companion with the current contract.`,
        "update_companion", "Update companion", baseChecks, targetReadiness);
    }
    if (!onlineNotificationDevices.length) {
      return result("companion_offline", "waiting", "notify", "notification", true,
        "Monitoring is configured; Chrome is offline",
        "Yoink can retain incoming evidence, but open the paired browser for current page observations and prompt notification delivery.",
        "open_chrome", "Open Chrome", baseChecks, targetReadiness);
    }
    return result("notification_ready", "ready", "notify", "notification", true,
      "Notifications are ready",
      "Yoink will notify only when a fresh exact offer matches this saved plan. No retailer control is clicked.",
      "wait_for_offer", "Wait for an exact match", baseChecks, targetReadiness);
  }

  const addChecks = [
    ...baseChecks,
    check("policy", "Guarded store limits", policyTargetsSafe ? "pass" : "attention",
      policyTargetsSafe
        ? "Every enabled target has a reviewed item cap, Store only seller, Shipping, and exact-item substitution."
        : "Every enabled cart target needs a reviewed item cap, Store only seller, Shipping, and the exact item."),
    check("lane", "Qualified store lane", targetReadiness.some((target) => target.laneQualified && target.packagedMapping)
      ? "pass" : "attention",
    targetReadiness.some((target) => target.laneQualified && target.packagedMapping)
      ? "At least one enabled exact store target has a separately qualified add-only lane."
      : "No enabled exact store target currently has a separately qualified add-only lane."),
    check("runner", "Online add-only runner", targetReadiness.some((target) => target.laneQualified && target.companionCapable)
      ? "pass" : "waiting",
    targetReadiness.some((target) => target.laneQualified && target.companionCapable)
      ? "A current online companion can run at least one qualified store adapter."
      : "Open or update a companion that includes the qualified add-only runner."),
    check("global", "Guarded actions enabled", context.executionMode === "live" && !context.actionsPaused ? "pass" : "waiting",
      context.executionMode !== "live"
        ? "The control plane is in test mode; no retailer click can run."
        : context.actionsPaused ? "Global guarded actions are paused." : "Guarded actions are enabled."),
    check("runtime", "Fresh offer verification", "runtime",
      "At action time Chrome must re-bind the exact item, price, first-party seller, shipping offer, quantity one, and usable add control. Checkout remains manual.")
  ];

  if (!policyTargetsSafe) {
    return result("guarded_add_policy_incomplete", "attention", "add_to_cart", "none", readyForMonitoring,
      "Review this cart plan's store limits",
      "One or more enabled targets is missing a requirement for safe add-only execution.",
      "review_plan", "Review limits", addChecks, targetReadiness);
  }
  const laneTargets = enabledTargets.filter((target) => {
    const retailerId = guardedRetailer(target.retailerId);
    return target.executionSupported === true && retailerId !== null && context.qualifications[retailerId] === true;
  });
  if (!laneTargets.length) {
    return result("guarded_add_lane_closed", "attention", "add_to_cart", "none", readyForMonitoring,
      `${joinedStores(enabledTargets)} guarded add is not qualified yet`,
      "Monitoring and notifications remain available, but this plan cannot create a retailer click until a separately verified lane is activated.",
      "review_plan", "Review plan", addChecks, targetReadiness);
  }
  if (!connectedSignal) {
    return result("needs_signal", "waiting", "add_to_cart", "none", false,
      "Connect a product signal",
      "The guarded store lane exists, but Yoink needs a supported signal source before an exact opportunity can arrive.",
      "connect_signal", "Connect signal", addChecks, targetReadiness);
  }
  if (!notificationDevices.length) {
    return result("needs_current_companion", "attention", "add_to_cart", "none", false,
      "Update and pair the Chrome companion",
      `Guarded actions need an active Yoink ${context.version} companion with the current contract.`,
      "update_companion", "Update companion", addChecks, targetReadiness);
  }
  if (!onlineCurrentDevices.length) {
    return result("companion_offline", "waiting", "add_to_cart", "notification", readyForMonitoring,
      "Your guarded plan is configured; Chrome is offline",
      "Open the paired browser before expecting a store-page verification or cart action.",
      "open_chrome", "Open Chrome", addChecks, targetReadiness);
  }
  if (!laneTargets.some((target) => onlineCurrentDevices.some((device) => deviceSupportsRetailer(device, target.retailerId)))) {
    return result("guarded_add_device_incapable", "attention", "add_to_cart", "notification", readyForMonitoring,
      `Update the Chrome companion for ${joinedStores(laneTargets)}`,
      "The store lane is qualified, but no online current companion advertises its exact add-only adapter contract.",
      "update_companion", "Update companion", addChecks, targetReadiness);
  }
  if (context.executionMode !== "live") {
    return result("guarded_add_shadow", "waiting", "add_to_cart", "notification", readyForMonitoring,
      "Guarded clicks are in test mode",
      "Yoink can evaluate exact matches, but the control plane is not permitting retailer clicks.",
      "enable_live_mode", "Review execution mode", addChecks, targetReadiness);
  }
  if (context.actionsPaused) {
    return result("guarded_add_paused", "waiting", "add_to_cart", "notification", readyForMonitoring,
      "Guarded actions are paused",
      "Your exact plan and store qualification stay saved while all retailer clicks remain closed.",
      "resume_actions", "Review pause", addChecks, targetReadiness);
  }
  return result("guarded_add_armed", "ready", "add_to_cart", "guarded_add", readyForMonitoring,
    "Guarded add is armed",
    `Yoink may add exactly one item at ${joinedStores(laneTargets)} only after a fresh exact first-party shipping offer passes every live check. Checkout stays manual.`,
    "wait_for_offer", "Wait for an exact match", addChecks, targetReadiness);
}
