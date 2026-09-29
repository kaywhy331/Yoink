import { trackingNeedsReconnect } from "./delivery-health.js";

export type UserSetupStepState = "complete" | "current" | "waiting" | "attention";
export type UserSetupAction =
  | "download_companion"
  | "pair_companion"
  | "connect_signal"
  | "add_product"
  | "choose_product"
  | "resume_actions"
  | "view_plans";

export interface UserSetupStep {
  id: "companion" | "signal" | "product" | "plan" | "action";
  title: string;
  state: UserSetupStepState;
  summary: string;
  primaryAction: UserSetupAction | null;
  primaryActionLabel: string;
  secondaryAction: UserSetupAction | null;
  secondaryActionLabel: string;
}

export interface UserSetupInput {
  version: string;
  companionDownloadUrl?: string;
  devices: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  products: number;
  pendingProductProposals: number;
  plans: Array<Record<string, unknown>>;
  savedPlanCount?: number;
  actionsPaused: boolean;
  executionMode: string;
  /** True when a resume request already waits for independent approval; the step then says "Request resume". */
  resumePendingApproval?: boolean;
}

export interface UserSetupReadiness {
  level:
    | "needs_companion"
    | "review_saved_plans"
    | "needs_signal"
    | "needs_product"
    | "product_in_review"
    | "needs_plan"
    | "needs_action_enablement"
    | "temporarily_offline"
    | "monitoring_ready"
    | "guarded_cart_ready";
  headline: string;
  summary: string;
  completedSteps: number;
  totalSteps: 5;
  readyForMonitoring: boolean;
  readyForGuardedAdds: boolean;
  companion: {
    activeCount: number;
    currentCount: number;
    onlineCurrentCount: number;
    latestVersion: string;
    downloadUrl: string;
  };
  connectedSignalCount: number;
  savedPlanCount: number;
  activePlanCount: number;
  guardedCartPlanCount: number;
  steps: UserSetupStep[];
}

function step(
  id: UserSetupStep["id"],
  title: string,
  state: UserSetupStepState,
  summary: string,
  primaryAction: UserSetupAction | null = null,
  primaryActionLabel = "",
  secondaryAction: UserSetupAction | null = null,
  secondaryActionLabel = ""
): UserSetupStep {
  return { id, title, state, summary, primaryAction, primaryActionLabel, secondaryAction, secondaryActionLabel };
}

// "Request resume" is only honest while an approval is actually pending;
// otherwise the verb matches the header button: "Resume actions".
function resumeActionLabel(input: UserSetupInput): string {
  return input.resumePendingApproval === true ? "Request resume" : "Resume actions";
}

export function buildUserSetupReadiness(input: UserSetupInput): UserSetupReadiness {
  const activeDevices = input.devices.filter((device) => device.status === "active");
  const currentDevices = activeDevices.filter((device) => device.extensionVersion === input.version);
  const onlineCurrentDevices = currentDevices.filter((device) => device.online === true);
  // A tracking feed that went quiet or failed is a known outage: browser
  // presence must not report tracking as connected while it lasts (E-03).
  const connectedSignals = trackingNeedsReconnect(input.sources)
    ? []
    : input.sources.filter((source) => source.source !== "user_link" && source.status === "connected");
  const savedPlanCount = Math.max(0, Number(input.savedPlanCount ?? input.plans.filter((plan) => plan.status !== "deleted").length) || 0);
  const activePlans = input.plans.filter((plan) => plan.status === "active");
  const guardedCartPlans = activePlans.filter((plan) => plan.actionCeiling === "add_to_cart");
  const notificationPlans = activePlans.filter((plan) => plan.actionCeiling !== "add_to_cart");
  const plansWithReadiness = activePlans.filter((plan) => plan.automationReadiness
    && typeof plan.automationReadiness === "object"
    && !Array.isArray(plan.automationReadiness));
  const guardedCartReadyPlans = guardedCartPlans.filter((plan) => {
    const readiness = plan.automationReadiness as Record<string, unknown> | undefined;
    return readiness?.readyForGuardedAdd === true;
  });
  const blockedGuardedReadiness = guardedCartPlans
    .map((plan) => plan.automationReadiness)
    .find((readiness) => readiness && typeof readiness === "object" && !Array.isArray(readiness)) as Record<string, unknown> | undefined;
  const productCount = Math.max(0, Number(input.products) || 0);
  const pendingCount = Math.max(0, Number(input.pendingProductProposals) || 0);
  const actionsReady = input.executionMode === "live" && input.actionsPaused === false;
  const readyForMonitoring = plansWithReadiness.length
    ? plansWithReadiness.some((plan) => (plan.automationReadiness as Record<string, unknown>).readyForMonitoring === true)
    : currentDevices.length > 0 && connectedSignals.length > 0 && activePlans.length > 0;
  const readyForGuardedAdds = plansWithReadiness.length
    ? guardedCartReadyPlans.length > 0
    : readyForMonitoring && guardedCartPlans.length > 0 && actionsReady && onlineCurrentDevices.length > 0;

  const companionStep = currentDevices.length
    ? step(
      "companion",
      "Install and pair Chrome",
      onlineCurrentDevices.length ? "complete" : "attention",
      onlineCurrentDevices.length
        ? `A current Yoink ${input.version} companion is online.`
        : `Yoink ${input.version} is paired but not currently online. Open Chrome before expecting live browser actions.`
    )
    : activeDevices.length
      ? step(
        "companion",
        "Install and pair Chrome",
        "current",
        `Your paired companion is out of date. Install Yoink ${input.version}, then reload it in Chrome.`,
        "download_companion",
        "Download update"
      )
      : step(
        "companion",
        "Install and pair Chrome",
        "current",
        "Install the Chrome companion, then pair it with a one-time code. It is the only component allowed to perform a qualified store click.",
        "download_companion",
        "Download companion",
        "pair_companion",
        "Create pairing code"
      );

  // A source whose freshness says "stale" is connected on paper only: the
  // last push, delivery, or registration is older than its sync interval.
  // A failed push registration ("error") needs the same recovery. Say so on
  // the step instead of "active", with the recovery lever.
  const staleSignals = input.sources.filter((source) => source.source !== "user_link"
    && (source.status === "stale" || source.status === "error"));
  const staleDetail = staleSignals
    .map((source) => String((source.freshness as Record<string, unknown> | undefined)?.detail || ""))
    .find(Boolean) || "";
  const signalStep = connectedSignals.length
    ? step("signal", "Connect your product tracking", "complete", `${connectedSignals.length} tracking connection${connectedSignals.length === 1 ? " is" : "s are"} active.`)
    : staleSignals.length
      ? step(
        "signal",
        "Reconnect your product tracking",
        "attention",
        `${staleDetail || "Your tracking source has gone quiet."} Open the Chrome companion popup and choose Reconnect, then re-check.`,
        "connect_signal",
        "Show reconnect help"
      )
      : step(
      "signal",
      "Connect your product tracking",
      currentDevices.length ? "current" : "waiting",
      "Open the Chrome companion and choose Connect to start tracking your followed products. Tracking can discover offers but cannot raise your limits.",
      "connect_signal",
      "Show connection help"
    );

  const productStep = productCount
    ? step("product", "Choose an exact product", "complete", `${productCount} exact catalog listing${productCount === 1 ? " is" : "s are"} available to review.`)
    : pendingCount
      ? step(
        "product",
        "Choose an exact product",
        "waiting",
        `${pendingCount} exact product link${pendingCount === 1 ? " is" : "s are"} waiting for independent catalog review. No stock claim or purchase plan was created.`,
        "add_product",
        "Suggest another product"
      )
      : step(
        "product",
        "Choose an exact product",
        "current",
        "Paste a supported store product page. Yoink extracts the exact store and item ID, then holds it for independent review.",
        "add_product",
        "Add product link"
      );

  const planStep = savedPlanCount
    ? step("plan", "Save your plan", "complete", `${savedPlanCount} saved plan${savedPlanCount === 1 ? "" : "s"}. Saving does not mean monitoring or cart actions are ready.`)
    : step(
      "plan",
      "Set your price and action",
      productCount ? "current" : "waiting",
      "Choose an approved exact listing, set the most you will pay, and select notifications or a guarded cart action.",
      "choose_product",
      "Choose a product"
    );

  let actionStep: UserSetupStep;
  if (!activePlans.length) {
    actionStep = savedPlanCount
      ? step("action", "Review your saved plans", "current", "Open Plans to check each plan’s status and readiness. Inactive plans stay inactive.", "view_plans", "Review plans")
      : step("action", "Review the safety boundary", "waiting", "Checkout, payment, raffle entry, and order submission always remain manual.");
  } else if (!guardedCartPlans.length && notificationPlans.length) {
    actionStep = step("action", "Review the safety boundary", "complete", "Your active plans notify only. No store control is clicked; checkout and ordering remain manual.");
  } else if (plansWithReadiness.length && !guardedCartReadyPlans.length && blockedGuardedReadiness) {
    actionStep = step(
      "action",
      "Review the safety boundary",
      blockedGuardedReadiness.level === "attention" ? "attention" : "current",
      `${String(blockedGuardedReadiness.headline || "Guarded add is not ready")}. ${String(blockedGuardedReadiness.summary || "No retailer click is currently authorized.")}`,
      blockedGuardedReadiness.nextAction === "resume_actions" ? "resume_actions" : null,
      blockedGuardedReadiness.nextAction === "resume_actions" ? resumeActionLabel(input) : ""
    );
  } else if (!actionsReady) {
    actionStep = step(
      "action",
      "Review the safety boundary",
      "current",
      input.actionsPaused
        ? input.resumePendingApproval === true
          ? "Your guarded cart plan is saved. A resume request is waiting for independent approval; cart adds stay paused until it is approved."
          : "Your guarded cart plan is saved, but purchase actions are paused. Resume them when you are ready for cart adds."
        : "Your guarded cart plan is saved, but the control plane is not in live execution mode.",
      input.actionsPaused ? "resume_actions" : null,
      input.actionsPaused ? resumeActionLabel(input) : ""
    );
  } else if (!onlineCurrentDevices.length) {
    actionStep = step("action", "Review the safety boundary", "attention", "Guarded actions are enabled, but a current Chrome companion must be online. Checkout and ordering remain manual.");
  } else {
    actionStep = step("action", "Review the safety boundary", "complete", "Guarded add-only actions are ready within your exact plan. Checkout, payment, and order submission remain manual.");
  }

  const steps = [productStep, planStep, companionStep, signalStep, actionStep];
  let level: UserSetupReadiness["level"];
  let headline: string;
  let summary: string;
  if (!savedPlanCount && !productCount) {
    level = pendingCount ? "product_in_review" : "needs_product";
    headline = pendingCount ? "Your product link is in review" : "What do you want to follow?";
    summary = pendingCount
      ? "Independent review must approve the exact product before you can save a plan."
      : "Choose a product and save your limits. You can finish browser setup afterward.";
  } else if (!savedPlanCount) {
    level = "needs_plan";
    headline = "Make your first plan";
    summary = "Choose an exact product, set your limits, and review what Yoink may do.";
  } else if (!activePlans.length) {
    level = "review_saved_plans";
    headline = "Review your saved plans";
    summary = "Your plans are saved. Check each plan’s status and readiness in Plans.";
  } else if (!currentDevices.length) {
    level = "needs_companion";
    headline = activeDevices.length ? "Update your Chrome companion" : "Plan saved. Connect Chrome next";
    summary = "Use desktop Chrome to observe store pages. Saving a plan alone does not start tracking or authorize a cart action.";
  } else if (!connectedSignals.length) {
    level = "needs_signal";
    headline = staleSignals.length ? "Plan saved. Reconnect product tracking" : "Plan saved. Connect product tracking";
    summary = staleSignals.length
      ? "Your tracking source has gone quiet or failed, so Yoink cannot learn when an exact product offer changes."
      : "Yoink needs a tracking connection to learn when an exact product offer changes.";
  } else if (guardedCartPlans.length && plansWithReadiness.length && !guardedCartReadyPlans.length && blockedGuardedReadiness) {
    if (blockedGuardedReadiness.state === "companion_offline") {
      level = "temporarily_offline";
    } else {
      level = "needs_action_enablement";
    }
    headline = String(blockedGuardedReadiness.headline || "Your guarded plan needs attention");
    summary = String(blockedGuardedReadiness.summary || "Your plan stays saved while retailer clicks remain closed.");
  } else if (guardedCartPlans.length && !actionsReady) {
    level = "needs_action_enablement";
    headline = input.actionsPaused ? "Your guarded actions are paused" : "Guarded actions are not live";
    summary = "Your plan stays saved while all retailer clicks remain closed.";
  } else if (!onlineCurrentDevices.length) {
    level = "temporarily_offline";
    headline = "Your setup is configured; Chrome is offline";
    summary = "Open the paired browser before expecting current observations or guarded store actions.";
  } else if (guardedCartPlans.length) {
    level = "guarded_cart_ready";
    headline = "Your guarded cart plan is ready";
    summary = "A click still requires a fresh exact first-party offer inside every saved limit. Checkout remains manual.";
  } else {
    level = "monitoring_ready";
    headline = "Your notification plan is ready";
    summary = "Yoink can monitor exact offers without clicking store controls.";
  }

  return {
    level,
    headline,
    summary,
    completedSteps: steps.filter((item) => item.state === "complete").length,
    totalSteps: 5,
    readyForMonitoring,
    readyForGuardedAdds,
    companion: {
      activeCount: activeDevices.length,
      currentCount: currentDevices.length,
      onlineCurrentCount: onlineCurrentDevices.length,
      latestVersion: input.version,
      downloadUrl: input.companionDownloadUrl === undefined
        ? "/api/v1/extension/release/download"
        : input.companionDownloadUrl
    },
    connectedSignalCount: connectedSignals.length,
    savedPlanCount,
    activePlanCount: activePlans.length,
    guardedCartPlanCount: guardedCartPlans.length,
    steps
  };
}
