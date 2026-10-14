import type { JobState } from "../../contracts/src/index.js";

const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  notify_only: [],
  shadow_ready: ["awaiting_executor", "expired", "cancelled"],
  awaiting_executor: ["leased", "expired", "cancelled"],
  leased: ["navigating", "expired", "cancelled"],
  navigating: ["verifying_listing", "offer_rejected", "expired", "cancelled", "manual_review"],
  // Back to awaiting_executor only for Retry when sold out: the live page showed
  // the item out of stock, before any Add authorization.
  verifying_listing: ["offer_verified", "offer_rejected", "awaiting_executor", "expired", "cancelled", "manual_review"],
  offer_verified: ["add_authorized", "offer_rejected", "expired", "cancelled", "manual_review"],
  add_authorized: ["adding", "offer_rejected", "cancelled", "manual_review"],
  adding: ["cart_verified", "manual_review"],
  cart_verified: ["checkout_review", "confirmed", "manual_review"],
  checkout_review: ["submit_authorized", "confirmed", "manual_review", "offer_rejected"],
  submit_authorized: ["submitting", "manual_review"],
  submitting: ["confirmed", "submission_uncertain", "manual_review"],
  confirmed: [],
  expired: [],
  cancelled: [],
  offer_rejected: [],
  manual_review: ["confirmed", "cancelled", "submission_uncertain"],
  submission_uncertain: ["confirmed", "cancelled", "manual_review"]
});

export function canTransitionJob(current: JobState, next: JobState): boolean {
  return TRANSITIONS[current]?.includes(next) === true;
}

export function assertJobTransition(current: JobState, next: JobState): void {
  if (!canTransitionJob(current, next)) throw new Error(`Action job cannot move from ${current} to ${next}.`);
}

export function jobMayHaveMutated(state: JobState): boolean {
  return [
    "adding",
    "cart_verified",
    "checkout_review",
    "submit_authorized",
    "submitting",
    "confirmed",
    "manual_review",
    "submission_uncertain"
  ].includes(state);
}

export function jobIsTerminal(state: JobState): boolean {
  return ["notify_only", "confirmed", "expired", "cancelled", "offer_rejected"].includes(state);
}
