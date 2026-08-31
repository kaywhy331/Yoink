import { JOB_STATES, type JobState } from "../../contracts/src/index.js";

export const USER_ACTION_STAGES = [
  "queued",
  "checking",
  "ready_to_checkout",
  "needs_you",
  "closed"
] as const;

export type UserActionStage = typeof USER_ACTION_STAGES[number];
export type UserReportedCartOutcome = "got_it" | "missed_it" | "";

export interface ActionStatusDefinition {
  label: string;
  stage: UserActionStage;
  summary: string;
}

export const ACTION_STATUS_GLOSSARY = Object.freeze({
  notify_only: {
    label: "Notified",
    stage: "closed",
    summary: "Yoink sent the opportunity without requesting a retailer action."
  },
  shadow_ready: {
    label: "Checked only",
    stage: "closed",
    summary: "Yoink evaluated the opportunity without requesting a retailer click."
  },
  awaiting_executor: {
    label: "Queued",
    stage: "queued",
    summary: "The exact bounded cart action is waiting for the paired Chrome companion."
  },
  leased: {
    label: "Starting",
    stage: "checking",
    summary: "Chrome accepted the bounded action lease."
  },
  navigating: {
    label: "Opening store",
    stage: "checking",
    summary: "Chrome is opening the exact cart or product page."
  },
  verifying_listing: {
    label: "Checking offer",
    stage: "checking",
    summary: "Chrome is rechecking the exact item, seller, price, and fulfillment."
  },
  offer_verified: {
    label: "Offer verified",
    stage: "checking",
    summary: "The live first-party offer passed the bounded action contract."
  },
  add_authorized: {
    label: "Ready to add",
    stage: "checking",
    summary: "Chrome prepared one exact Add control for final revalidation."
  },
  adding: {
    label: "Adding",
    stage: "checking",
    summary: "Chrome crossed the one-click Add boundary and will not retry it."
  },
  cart_verified: {
    label: "Verifying cart",
    stage: "checking",
    summary: "Chrome proved the exact cart quantity change."
  },
  checkout_review: {
    label: "Needs you",
    stage: "needs_you",
    summary: "Review the retailer checkout yourself before continuing."
  },
  submit_authorized: {
    label: "Needs you",
    stage: "needs_you",
    summary: "Order submission is not available from the current Yoink product."
  },
  submitting: {
    label: "Needs you",
    stage: "needs_you",
    summary: "Review the retailer session because the final result is not yet settled."
  },
  confirmed: {
    label: "Ready to check out",
    stage: "ready_to_checkout",
    summary: "The exact item is in the retailer cart; checkout remains manual."
  },
  expired: {
    label: "Expired",
    stage: "closed",
    summary: "The bounded opportunity ended before a retailer action completed."
  },
  cancelled: {
    label: "Closed",
    stage: "closed",
    summary: "The action closed without a recorded order."
  },
  offer_rejected: {
    label: "Did not qualify",
    stage: "closed",
    summary: "The live offer failed a required safety check before the Add boundary."
  },
  manual_review: {
    label: "Needs you",
    stage: "needs_you",
    summary: "Check the retailer cart because Chrome cannot safely infer the result."
  },
  submission_uncertain: {
    label: "Needs you",
    stage: "needs_you",
    summary: "Check the retailer session because the final result is uncertain."
  }
} satisfies Readonly<Record<JobState, ActionStatusDefinition>>);

if (Object.keys(ACTION_STATUS_GLOSSARY).length !== JOB_STATES.length) {
  throw new Error("The user action status glossary must cover every action-job state.");
}

export function actionStatusPresentation(input: {
  state: JobState;
  action: string;
  userReportOutcome?: UserReportedCartOutcome;
}): ActionStatusDefinition {
  if (input.userReportOutcome === "got_it") {
    return {
      label: "Got it",
      stage: "closed",
      summary: "You reported completing manual checkout for this exact cart action."
    };
  }
  if (input.userReportOutcome === "missed_it") {
    return {
      label: "Missed it",
      stage: "closed",
      summary: "You reported that manual checkout was not completed."
    };
  }
  if (input.state === "confirmed" && input.action !== "add_to_cart") {
    return {
      label: "Completed",
      stage: "closed",
      summary: "The action reached its confirmed terminal state."
    };
  }
  return ACTION_STATUS_GLOSSARY[input.state];
}

export function actionStatusGlossaryProjection(): Record<string, ActionStatusDefinition> {
  return {
    ...Object.fromEntries(JOB_STATES.map((state) => [state, { ...ACTION_STATUS_GLOSSARY[state] }])),
    user_reported_got_it: actionStatusPresentation({ state: "confirmed", action: "add_to_cart", userReportOutcome: "got_it" }),
    user_reported_missed_it: actionStatusPresentation({ state: "confirmed", action: "add_to_cart", userReportOutcome: "missed_it" })
  };
}
