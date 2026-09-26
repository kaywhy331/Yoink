/**
 * Resume preflight: one server-computed answer to "can store actions resume
 * right now, and what would that mean?". The dashboard, the Chrome companion
 * popup and the admin console all render this object instead of assembling
 * their own reason, confirmation or next step, so the words stay identical.
 *
 * Pausing is never gated here: the brake is always one tap. Only resuming
 * carries blockers, a scope summary and a confirmation.
 */

import { stableHash } from "./ids.js";

export type PausedBy = "shopper" | "companion" | "administrator" | "system";

export interface ResumePreflightStore {
  retailerId: string;
  name: string;
}

export interface ResumePreflightNextAction {
  kind: "store_setup" | "open_stores" | "open_activity" | "wait_approval";
  label: string;
  retailerId?: string;
  route: string;
}

export interface ResumePreflightBlocker {
  code: "no_store_ready" | "approval_pending";
  message: string;
  nextAction: ResumePreflightNextAction;
}

export interface ResumePreflightInput {
  actionsPaused: boolean;
  pauseReason: string;
  pausedAt: string;
  pausedBy: PausedBy;
  executionMode: string;
  readyStores: ResumePreflightStore[];
  /** The store to finish first when nothing is ready (a store a plan already uses, else the first supported). */
  storeToSetUp: ResumePreflightStore | null;
  savedPlanCount: number;
  cartPlanCount: number;
  notifyPlanCount: number;
  dailyCapCents: number | null;
  availableTodayCents: number | null;
  pendingRequest: { id: string; createdAt: string; expiresAt: string } | null;
  tenantPause: { active: boolean; reason: string; pausedAt: string } | null;
}

export interface ResumePreflight {
  paused: boolean;
  pauseReason: string;
  pausedAt: string;
  pausedBy: PausedBy;
  pausedByLabel: string;
  allowed: boolean;
  blockers: ResumePreflightBlocker[];
  nextAction: ResumePreflightNextAction | null;
  pending: { requestId: string; createdAt: string; expiresAt: string } | null;
  scope: {
    stores: ResumePreflightStore[];
    savedPlanCount: number;
    cartPlanCount: number;
    notifyPlanCount: number;
    dailyCapCents: number | null;
    availableTodayCents: number | null;
  };
  /** Human lines describing what goes live; rendered verbatim by every client. */
  summary: string[];
  /** The resume confirmation every surface shows, byte-identical. */
  confirmation: { title: string; summary: string; confirmLabel: string };
  tenantPause: { active: boolean; overridden: boolean; reason: string; pausedAt: string } | null;
  /** What the header should say; clients render this word, not their own rule. */
  presentation: "setting_up" | "paused" | "approval_pending" | "running" | "test_mode";
  presentationLabel: string;
  /**
   * Stable hash of what the shopper confirms (paused state, ready stores,
   * plan scope, daily cap, blockers). A resume may echo it back; the server
   * refuses the resume with 409 when the scope changed since (EXT-UI-06/WEB-09).
   */
  confirmationToken: string;
}

/** Shape every client checks before echoing a token (background.js, popup-state). */
export const RESUME_CONFIRMATION_TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{8,200}$/;

/**
 * The confirmation token for one preflight. Money left today is left out on
 * purpose: it moves with the clock, while the stores, plans, cap and blockers
 * are what the confirmation actually promises.
 */
export function resumeConfirmationToken(preflight: Pick<ResumePreflight, "paused" | "scope" | "blockers">): string {
  const digest = stableHash(
    "yoink-resume-confirmation-v1",
    preflight.paused ? "paused" : "running",
    preflight.scope.stores.map((store) => store.retailerId).sort().join(","),
    preflight.scope.savedPlanCount,
    preflight.scope.cartPlanCount,
    preflight.scope.notifyPlanCount,
    preflight.scope.dailyCapCents === null ? "none" : preflight.scope.dailyCapCents,
    preflight.blockers.map((blocker) => blocker.code).sort().join(",")
  );
  return `rp1:${digest.slice(0, 40)}`;
}

const PAUSED_BY_LABELS: Record<PausedBy, string> = {
  shopper: "you",
  companion: "the Chrome companion",
  administrator: "an administrator",
  system: "Yoink"
};

export const RESUME_BLOCKED_MESSAGE = "Turn on cart adds for at least one store before resuming actions.";
export const RESUME_CONFIRM_TITLE = "Resume cart adds?";
export const RESUME_CONFIRM_LABEL = "Resume actions";

function money(cents: number): string {
  return `$${(Math.max(0, Math.round(cents)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralWord}`;
}

export function buildResumePreflight(input: ResumePreflightInput): ResumePreflight {
  const readyStores = input.readyStores.map((store) => ({ retailerId: String(store.retailerId), name: String(store.name) }));
  const blockers: ResumePreflightBlocker[] = [];
  if (input.pendingRequest) {
    blockers.push({
      code: "approval_pending",
      message: "A resume request is waiting for independent approval. Cart adds stay paused until it is approved.",
      nextAction: { kind: "open_activity", label: "Open Activity", route: "activity" }
    });
  }
  if (!readyStores.length) {
    const store = input.storeToSetUp;
    blockers.push({
      code: "no_store_ready",
      message: RESUME_BLOCKED_MESSAGE,
      nextAction: store
        ? { kind: "store_setup", label: `Set up ${store.name}`, retailerId: store.retailerId, route: `stores/${store.retailerId}` }
        : { kind: "open_stores", label: "Open Stores", route: "stores" }
    });
  }
  const allowed = input.actionsPaused && blockers.length === 0;
  const summary: string[] = [];
  if (readyStores.length) {
    summary.push(`${plural(readyStores.length, "store")} ready: ${readyStores.map((store) => store.name).join(", ")}`);
  } else {
    summary.push("No store is ready for cart adds");
  }
  summary.push(input.cartPlanCount
    ? `${plural(input.cartPlanCount, "cart-mode plan")} may add to a cart`
    : "No cart-mode plans; watching and calls only");
  if (input.notifyPlanCount) summary.push(`${plural(input.notifyPlanCount, "notify-only plan")} unchanged`);
  summary.push(input.dailyCapCents === null
    ? "Today: no limit"
    : `Today: ${money(input.availableTodayCents ?? input.dailyCapCents)} left of ${money(input.dailyCapCents)}`);

  // The paused state decides first: a stale pending request must not say
  // "Approval pending" while cart adds are already running.
  const presentation: ResumePreflight["presentation"] = !input.actionsPaused
    ? (input.executionMode === "live" ? "running" : "test_mode")
    : input.pendingRequest
      ? "approval_pending"
      : input.savedPlanCount === 0
        ? "setting_up"
        : "paused";
  const presentationLabel = presentation === "approval_pending" ? "Approval pending"
    : presentation === "running" ? "Running"
      : presentation === "test_mode" ? "Test mode"
        : presentation === "setting_up" ? "Setting up"
          : "Paused";
  const tenantPause = input.tenantPause && input.tenantPause.active
    ? {
      active: true,
      overridden: !input.actionsPaused,
      reason: input.tenantPause.reason,
      pausedAt: input.tenantPause.pausedAt
    }
    : null;
  const scope = {
    stores: readyStores,
    savedPlanCount: input.savedPlanCount,
    cartPlanCount: input.cartPlanCount,
    notifyPlanCount: input.notifyPlanCount,
    dailyCapCents: input.dailyCapCents,
    availableTodayCents: input.availableTodayCents
  };
  return {
    paused: input.actionsPaused,
    pauseReason: input.pauseReason,
    pausedAt: input.actionsPaused ? input.pausedAt : "",
    pausedBy: input.pausedBy,
    pausedByLabel: PAUSED_BY_LABELS[input.pausedBy],
    allowed,
    blockers,
    nextAction: blockers[0]?.nextAction ?? null,
    pending: input.pendingRequest
      ? { requestId: input.pendingRequest.id, createdAt: input.pendingRequest.createdAt, expiresAt: input.pendingRequest.expiresAt }
      : null,
    scope,
    summary,
    confirmation: {
      title: RESUME_CONFIRM_TITLE,
      summary: readyStores.length
        ? `Yoink may add one item to a cart at ${readyStores.map((store) => store.name).join(", ")} when a call matches a cart-mode plan. Checkout stays manual.`
        : "No store is ready, so resuming would change nothing yet.",
      confirmLabel: RESUME_CONFIRM_LABEL
    },
    tenantPause,
    presentation,
    presentationLabel,
    confirmationToken: resumeConfirmationToken({ paused: input.actionsPaused, scope, blockers })
  };
}

/** The 400 details a client gets when it asks to resume while blocked. */
export function resumeBlockedDetails(preflight: ResumePreflight): Record<string, unknown> {
  return {
    blockers: preflight.blockers,
    nextAction: preflight.nextAction,
    summary: preflight.summary
  };
}
