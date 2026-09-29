import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  POKEMONCENTER_ADD_ADAPTER_VERSION,
  ASUS_ADD_ADAPTER_VERSION,
  AUDIOADVICE_ADD_ADAPTER_VERSION,
  BANANAREPUBLIC_ADD_ADAPTER_VERSION,
  BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION,
  ATHLETA_ADD_ADAPTER_VERSION,
  AMERICANEAGLE_ADD_ADAPTER_VERSION,
  ANINEBING_ADD_ADAPTER_VERSION,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION
} from "../../contracts/src/index.js";
import { trackingNeedsReconnect } from "./delivery-health.js";

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
  | "spend_limit_exceeded"
  | "guarded_add_lane_closed"
  | "guarded_add_device_incapable"
  | "guarded_add_session_blocked"
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
  maxAllInCents: number | null;
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
  spend: {
    policy: {
      perOrderCapCents: number | null;
      dailyCapCents: number | null;
      monthlyCapCents: number | null;
    };
    availableTodayCents: number | null;
    availableThisMonthCents: number | null;
  };
  sessionBlockers?: Array<{
    deviceId: string;
    retailerId: GuardedRetailerId;
    signedInState: "signed_out" | "challenged";
  }>;
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
  sessionBlocked: boolean;
  readyForGuardedAdd: boolean;
  reasonCode:
    | "mapping_unavailable"
    | "policy_incomplete"
    | "lane_not_qualified"
    | "companion_adapter_unavailable"
    | "retailer_session_blocked"
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
  technicalReason: string;
  nextAction:
    | "review_plan"
    | "store_setup"
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

type GuardedRetailerId = "target" | "walmart" | "amazon" | "bestbuy" | "pokemoncenter" | "aninebing" | "americaneagle" | "asus" | "athleta" | "audioadvice" | "bananarepublic" | "bananarepublicfactory";

interface RetailerLane {
  label: string;
  capability: "targetAddOnly" | "walmartAddOnly" | "amazonAddOnly" | "bestBuyAddOnly" | "pokemonCenterAddOnly" | "anineBingAddOnly" | "americanEagleAddOnly" | "asusAddOnly" | "athletaAddOnly" | "audioadviceAddOnly" | "bananarepublicAddOnly" | "bananarepublicfactoryAddOnly";
  versionCapability:
    | "targetAddAdapterVersion"
    | "walmartAddAdapterVersion"
    | "amazonAddAdapterVersion"
    | "bestBuyAddAdapterVersion"
    | "pokemonCenterAddAdapterVersion" | "anineBingAddAdapterVersion" | "americanEagleAddAdapterVersion" | "asusAddAdapterVersion" | "athletaAddAdapterVersion" | "audioadviceAddAdapterVersion" | "bananarepublicAddAdapterVersion" | "bananarepublicfactoryAddAdapterVersion";
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
  pokemoncenter: { label: "Pokémon Center", capability: "pokemonCenterAddOnly", versionCapability: "pokemonCenterAddAdapterVersion", adapterVersion: POKEMONCENTER_ADD_ADAPTER_VERSION },
  asus: { label: "ASUS", capability: "asusAddOnly", versionCapability: "asusAddAdapterVersion", adapterVersion: ASUS_ADD_ADAPTER_VERSION },
  audioadvice: { label: "Audio Advice", capability: "audioadviceAddOnly", versionCapability: "audioadviceAddAdapterVersion", adapterVersion: AUDIOADVICE_ADD_ADAPTER_VERSION },
  bananarepublic: { label: "Banana Republic", capability: "bananarepublicAddOnly", versionCapability: "bananarepublicAddAdapterVersion", adapterVersion: BANANAREPUBLIC_ADD_ADAPTER_VERSION },
  bananarepublicfactory: { label: "Banana Republic Factory", capability: "bananarepublicfactoryAddOnly", versionCapability: "bananarepublicfactoryAddAdapterVersion", adapterVersion: BANANAREPUBLICFACTORY_ADD_ADAPTER_VERSION },
  athleta: { label: "Athleta", capability: "athletaAddOnly", versionCapability: "athletaAddAdapterVersion", adapterVersion: ATHLETA_ADD_ADAPTER_VERSION },
  americaneagle: { label: "American Eagle", capability: "americanEagleAddOnly", versionCapability: "americanEagleAddAdapterVersion", adapterVersion: AMERICANEAGLE_ADD_ADAPTER_VERSION },
  aninebing: { label: "ANINE BING", capability: "anineBingAddOnly", versionCapability: "anineBingAddAdapterVersion", adapterVersion: ANINEBING_ADD_ADAPTER_VERSION },
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

function exactActionFulfillment(value: string): value is "shipping" | "pickup" {
  return value === "shipping" || value === "pickup";
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

function deviceSessionBlocked(
  context: PurchaseAutomationReadinessContext,
  device: Record<string, unknown>,
  retailerId: string
): boolean {
  const id = guardedRetailer(retailerId);
  const deviceId = String(device.id || "");
  return Boolean(id && deviceId && context.sessionBlockers?.some((blocker) =>
    blocker.deviceId === deviceId && blocker.retailerId === id
      && (blocker.signedInState === "signed_out" || blocker.signedInState === "challenged")));
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
  const targetReasons = targets
    .filter((target) => target.readyForGuardedAdd !== true)
    .map((target) => `${target.retailerId}:${target.reasonCode}`);
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
    technicalReason: [`readiness:${state}`, ...targetReasons].join(" · "),
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
  // A quiet or failed tracking feed is not a connected call source, whatever
  // else is online (E-03). The copy below names no age: the preflight
  // fingerprint binds this readiness, so its words must not tick by the minute.
  const quietTracking = trackingNeedsReconnect(context.sources);
  const connectedSignal = !quietTracking
    && context.sources.some((source) => source.source !== "user_link" && source.status === "connected");
  const currentDevices = context.devices.filter((device) => device.status === "active" && device.extensionVersion === context.version);
  const onlineCurrentDevices = currentDevices.filter((device) => device.online === true);
  const notificationDevices = currentDevices.filter((device) => deviceCapabilities(device).notifications === true);
  const onlineNotificationDevices = notificationDevices.filter((device) => device.online === true);
  const active = plan.status === "active";
  const expiry = plan.expiresAt ? new Date(plan.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const expired = Boolean(plan.expiresAt) && (!Number.isFinite(expiry) || expiry <= now);
  const reviewedAllInCents = plan.maxAllInCents === null ? null : Number(plan.maxAllInCents);
  const spendingLimitsSatisfied = configuredAction !== "add_to_cart"
    || (Number.isSafeInteger(reviewedAllInCents) && Number(reviewedAllInCents) > 0
      && (context.spend.policy.perOrderCapCents === null
        || Number(reviewedAllInCents) <= context.spend.policy.perOrderCapCents)
      && (context.spend.availableTodayCents === null
        || Number(reviewedAllInCents) <= context.spend.availableTodayCents)
      && (context.spend.availableThisMonthCents === null
        || Number(reviewedAllInCents) <= context.spend.availableThisMonthCents));
  const spendingLimitDetail = configuredAction !== "add_to_cart"
    ? "Notifications do not reserve spending capacity."
    : reviewedAllInCents === null || !Number.isSafeInteger(reviewedAllInCents) || reviewedAllInCents <= 0
      ? "Set a maximum total before using cart adds."
      : context.spend.policy.perOrderCapCents !== null
          && reviewedAllInCents > context.spend.policy.perOrderCapCents
        ? `Lower the plan maximum to $${(context.spend.policy.perOrderCapCents / 100).toFixed(2)} or raise your per-order spending limit.`
        : context.spend.availableTodayCents !== null && reviewedAllInCents > context.spend.availableTodayCents
          ? `Only $${(context.spend.availableTodayCents / 100).toFixed(2)} remains in today's spending limit.`
          : context.spend.availableThisMonthCents !== null && reviewedAllInCents > context.spend.availableThisMonthCents
            ? `Only $${(context.spend.availableThisMonthCents / 100).toFixed(2)} remains in this month's spending limit.`
            : "The reviewed maximum fits your current spending limits.";
  const policyTargetsSafe = enabledTargets.length > 0 && enabledTargets.every((target) =>
    target.executionSupported === true
      && Number.isSafeInteger(Number(target.maxUnitPriceCents))
      && Number(target.maxUnitPriceCents) > 0
      && target.sellerPolicy === "first_party_only"
      && exactActionFulfillment(target.fulfillment)
      && (!["pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(target.retailerId) || target.fulfillment === "shipping")
  );

  const targetReadiness: PurchaseAutomationTargetReadiness[] = enabledTargets.map((target) => {
    const retailerId = guardedRetailer(target.retailerId);
    const reviewedPolicy = Number.isSafeInteger(Number(target.maxUnitPriceCents))
      && Number(target.maxUnitPriceCents) > 0
      && target.sellerPolicy === "first_party_only"
      && exactActionFulfillment(target.fulfillment)
      && (!["pokemoncenter", "aninebing", "americaneagle", "asus", "athleta", "audioadvice", "bananarepublic", "bananarepublicfactory"].includes(target.retailerId) || target.fulfillment === "shipping");
    const packagedMapping = target.executionSupported === true && retailerId !== null;
    const laneQualified = retailerId !== null && context.qualifications[retailerId] === true;
    const capableDevices = onlineCurrentDevices.filter((device) => deviceSupportsRetailer(device, target.retailerId));
    const companionCapable = capableDevices.length > 0;
    const sessionBlocked = companionCapable
      && capableDevices.every((device) => deviceSessionBlocked(context, device, target.retailerId));
    const globallyReady = active && !expired && directPlan && configuredAction === "add_to_cart"
      && spendingLimitsSatisfied
      && connectedSignal && context.executionMode === "live" && !context.actionsPaused;
    const readyForGuardedAdd = globallyReady && policyTargetsSafe && packagedMapping && laneQualified
      && companionCapable && !sessionBlocked;
    let reasonCode: PurchaseAutomationTargetReadiness["reasonCode"];
    let summary: string;
    if (!packagedMapping) {
      reasonCode = "mapping_unavailable";
      summary = `Yoink can watch this item, but ${targetLabel(target)} is not available for cart adds yet.`;
    } else if (!reviewedPolicy) {
      reasonCode = "policy_incomplete";
      summary = "Set a maximum item price, choose Store only, and select Shipping or Pickup.";
    } else if (!laneQualified) {
      reasonCode = "lane_not_qualified";
      summary = `${targetLabel(target)} is not switched on for cart adds yet.`;
    } else if (!companionCapable) {
      reasonCode = "companion_adapter_unavailable";
      summary = `Update Yoink in Chrome to use ${targetLabel(target)} cart adds.`;
    } else if (sessionBlocked) {
      reasonCode = "retailer_session_blocked";
      summary = `Sign in to ${targetLabel(target)} in Chrome or finish the security check, then retry.`;
    } else if (readyForGuardedAdd) {
      reasonCode = "armed_for_fresh_offer";
      summary = `${targetLabel(target)} is ready. Yoink will recheck the item before adding one to your cart.`;
    } else {
      reasonCode = "runtime_offer_required";
      summary = `${targetLabel(target)} is ready. Finish the setup above so Yoink can recheck the item before a cart add.`;
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
      sessionBlocked,
      readyForGuardedAdd,
      reasonCode,
      summary
    };
  });

  const baseChecks: PurchaseAutomationCheck[] = [
    check("plan", "Plan is active", active && !expired ? "pass" : "attention",
      active ? expired ? "This plan's end time has passed." : "The purchase plan is active." : "Turn the plan on before expecting monitoring or actions."),
    check("decision", "Reviewed decision", directPlan ? "pass" : "attention",
      directPlan ? "This saved plan sets the item, limit, and action." : "Review and save this older plan before relying on it."),
    check("targets", "Exact store item", enabledTargets.length ? "pass" : "attention",
      enabledTargets.length ? `${enabledTargets.length} exact store item${enabledTargets.length === 1 ? " is" : "s are"} selected.` : "Select at least one exact store item."),
    check("signal", "Product calls", connectedSignal ? "pass" : "waiting",
      connectedSignal ? "A non-manual source is connected."
        : quietTracking ? "Your product tracking needs reconnecting so Yoink can learn when the exact offer changes."
          : "Connect a supported source so Yoink can learn when the exact offer changes."),
    check("companion", "Current Chrome companion", notificationDevices.length
      ? onlineNotificationDevices.length ? "pass" : "waiting"
      : "attention",
    notificationDevices.length
      ? onlineNotificationDevices.length ? `Yoink ${context.version} is online.` : `Yoink ${context.version} is paired but Chrome is offline.`
      : `Install and pair Yoink ${context.version} in Chrome.`)
  ];

  const readyForMonitoring = active && !expired && directPlan && enabledTargets.length > 0
    && connectedSignal && notificationDevices.length > 0;

  if (!active) {
    return result("inactive", "off", configuredAction, "none", false,
      "This purchase plan is turned off",
      "Its limits stay saved. While paused, Yoink sends no calls and tries no cart adds for this plan.",
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
      "It still delegates decisions to admin-managed rules. Saving it from this dashboard converts it to an explicit user-controlled plan.",
      "review_plan", "Review plan", baseChecks, targetReadiness);
  }
  if (!enabledTargets.length) {
    return result("needs_target", "attention", configuredAction, "none", false,
      "Choose an exact store item",
      "This plan has no enabled store item, so no call can match it.",
      "review_plan", "Choose store item", baseChecks, targetReadiness);
  }

  if (configuredAction === "notify") {
    if (!connectedSignal) {
      return result("needs_signal", "waiting", "notify", "none", false,
        quietTracking ? "Reconnect your product tracking" : "Connect a call source",
        quietTracking
          ? "The exact plan is saved, but your product tracking needs reconnecting before Yoink can notify you."
          : "The exact plan is saved, but Yoink needs a supported source before it can notify you.",
        "connect_signal", quietTracking ? "Reconnect source" : "Connect source", baseChecks, targetReadiness);
    }
    if (!notificationDevices.length) {
      return result("needs_current_companion", "attention", "notify", "none", false,
        "Update and pair Yoink in Chrome",
        `Install or update Yoink ${context.version} in Chrome to receive notifications.`,
        "update_companion", "Update companion", baseChecks, targetReadiness);
    }
    if (!onlineNotificationDevices.length) {
      return result("companion_offline", "waiting", "notify", "notification", true,
        "Open Chrome to resume",
        "Your plan stays saved. Open the paired browser to receive notifications.",
        "open_chrome", "Open Chrome", baseChecks, targetReadiness);
    }
    return result("notification_ready", "ready", "notify", "notification", true,
      "Notifications are ready",
      "Yoink will notify only when a fresh exact offer matches this saved plan. No store control is clicked.",
      "wait_for_offer", "Wait for an exact match", baseChecks, targetReadiness);
  }

  const addChecks = [
    ...baseChecks,
    check("policy", "Store limits", policyTargetsSafe ? "pass" : "attention",
      policyTargetsSafe
        ? "Each selected item has a price cap, Store only seller, and a Shipping or Pickup choice."
        : "Set a price cap, choose Store only, and select Shipping or Pickup for every item."),
    check("spend", "Spending limit", spendingLimitsSatisfied ? "pass" : "attention", spendingLimitDetail),
    check("lane", "Store cart adds", targetReadiness.some((target) => target.laneQualified && target.packagedMapping)
      ? "pass" : "attention",
    targetReadiness.some((target) => target.laneQualified && target.packagedMapping)
      ? "At least one selected store is switched on for cart adds."
      : `${joinedStores(enabledTargets)} is not switched on for cart adds yet.`),
    check("runner", "Chrome support", targetReadiness.some((target) => target.laneQualified && target.companionCapable)
      ? "pass" : "waiting",
    targetReadiness.some((target) => target.laneQualified && target.companionCapable)
      ? "Chrome can add to the cart at one or more selected stores."
      : "Open or update Yoink in Chrome to add to the cart at the selected store."),
    check("session", "Store session", targetReadiness.some((target) =>
      target.laneQualified && target.companionCapable && !target.sessionBlocked) ? "pass" : "waiting",
    targetReadiness.some((target) => target.laneQualified && target.companionCapable && !target.sessionBlocked)
      ? "No fresh sign-out or challenge is recorded for at least one capable browser. Sign-in is checked again before an Add."
      : "Sign in to the store in Chrome or finish its security check."),
    check("global", "Cart adds enabled", context.executionMode === "live" && !context.actionsPaused ? "pass" : "waiting",
      context.executionMode !== "live"
        ? "Cart adds are in test mode. Review action mode to turn them on."
        : context.actionsPaused ? "Cart adds are paused. Resume actions when you are ready." : "Cart adds are enabled."),
    check("runtime", "Final item check", "runtime",
      "Before adding, Chrome checks the exact item, current price, Store only seller, saved Shipping or Pickup choice, quantity one, and Add to cart button. You still complete checkout.")
  ];

  if (!policyTargetsSafe) {
    return result("guarded_add_policy_incomplete", "attention", "add_to_cart", "none", readyForMonitoring,
      "Review this plan's store limits",
      "Complete the price, seller, and Shipping or Pickup choices for each selected item.",
      "review_plan", "Review limits", addChecks, targetReadiness);
  }
  if (!spendingLimitsSatisfied) {
    return result("spend_limit_exceeded", "attention", "add_to_cart", "none", readyForMonitoring,
      "This plan is above your spending limit",
      spendingLimitDetail,
      "review_plan", "Review spending limits", addChecks, targetReadiness);
  }
  const laneTargets = enabledTargets.filter((target) => {
    const retailerId = guardedRetailer(target.retailerId);
    return target.executionSupported === true && retailerId !== null && context.qualifications[retailerId] === true;
  });
  if (!laneTargets.length) {
    return result("guarded_add_lane_closed", "attention", "add_to_cart", "none", readyForMonitoring,
      `${joinedStores(enabledTargets)} is not switched on for cart adds yet`,
      "Yoink will keep watching. Turn on cart adds for this store before expecting an item in your cart.",
      "store_setup", "Set up store", addChecks, targetReadiness);
  }
  if (!connectedSignal) {
    return result("needs_signal", "waiting", "add_to_cart", "none", false,
      quietTracking ? "Reconnect your product tracking" : "Connect a call source",
      quietTracking
        ? "Your product tracking needs reconnecting before Yoink can recognize an exact match."
        : "Yoink needs a supported source before it can recognize an exact match.",
      "connect_signal", quietTracking ? "Reconnect source" : "Connect source", addChecks, targetReadiness);
  }
  if (!notificationDevices.length) {
    return result("needs_current_companion", "attention", "add_to_cart", "none", false,
      "Update and pair Yoink in Chrome",
      `Install or update Yoink ${context.version} in Chrome before using cart adds.`,
      "update_companion", "Update companion", addChecks, targetReadiness);
  }
  if (!onlineCurrentDevices.length) {
    return result("companion_offline", "waiting", "add_to_cart", "notification", readyForMonitoring,
      "Open Chrome to resume",
      "Your plan stays saved. Open the paired browser before expecting a cart add.",
      "open_chrome", "Open Chrome", addChecks, targetReadiness);
  }
  if (!laneTargets.some((target) => onlineCurrentDevices.some((device) => deviceSupportsRetailer(device, target.retailerId)))) {
    return result("guarded_add_device_incapable", "attention", "add_to_cart", "notification", readyForMonitoring,
      `Update Yoink in Chrome for ${joinedStores(laneTargets)}`,
      "The connected extension cannot add to the cart at this store yet.",
      "update_companion", "Update companion", addChecks, targetReadiness);
  }
  if (context.executionMode !== "live") {
    return result("guarded_add_shadow", "waiting", "add_to_cart", "notification", readyForMonitoring,
      "Cart adds are in test mode",
      "Yoink can check exact matches, but it will not add to the cart until action mode is live.",
      "enable_live_mode", "Review action mode", addChecks, targetReadiness);
  }
  if (context.actionsPaused) {
    return result("guarded_add_paused", "waiting", "add_to_cart", "notification", readyForMonitoring,
      "Cart adds are paused",
      "Your plan stays saved. Resume actions when you want Yoink to add matched items.",
      "resume_actions", "Review pause", addChecks, targetReadiness);
  }
  const sessionEligibleTargets = targetReadiness.filter((target) =>
    target.laneQualified && target.companionCapable && !target.sessionBlocked);
  if (!sessionEligibleTargets.length) {
    return result("guarded_add_session_blocked", "waiting", "add_to_cart", "notification", readyForMonitoring,
      `Sign in to ${joinedStores(laneTargets)} in Chrome`,
      "Sign in or finish the security check, then retry. Your plan stays saved and monitored.",
      "open_chrome", "Open store in Chrome", addChecks, targetReadiness);
  }
  return result("guarded_add_armed", "ready", "add_to_cart", "guarded_add", readyForMonitoring,
    `${joinedStores(enabledTargets.filter((target) =>
      sessionEligibleTargets.some((readyTarget) => readyTarget.retailerId === target.retailerId)))} is ready for cart adds`,
    "Yoink rechecks the item, price, seller, and delivery choice before adding exactly one item. You still complete checkout.",
    "wait_for_offer", "Wait for an exact match", addChecks, targetReadiness);
}
