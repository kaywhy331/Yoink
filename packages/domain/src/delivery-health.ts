import { ADD_LANE_IDS } from "../../contracts/src/add-lanes.js";

/**
 * Delivery health: the receipts that say whether a call can actually reach
 * the shopper. Every surface (Home, Insights, Settings, admin Overview, popup)
 * renders this one server-computed object instead of inferring health from
 * "connected" flags. A status word here is always a receipt with an age.
 */

/** Notify-only jobs stay leasable this long. Cart adds keep their own signal-age window. */
export const NOTIFY_JOB_LIFETIME_SECONDS = 24 * 60 * 60;
/** Default signal-age policy that sets a cart-add job's expiry (strategies.ts, control-repository.ts). */
export const DEFAULT_CART_FRESHNESS_SECONDS = 120;
/** An online device that has not asked for calls for this long is silent. */
export const DEVICE_POLL_SILENCE_MS = 5 * 60_000;
/** TrackaLacker syncs about once a day; twice the interval is overdue. */
export const TRACKALACKER_STALE_AFTER_MS = 48 * 60 * 60_000;
export const TRACKALACKER_STALE_WITH_PLANS_MS = 24 * 60 * 60_000;
export const BROWSER_OBSERVATION_STALE_AFTER_MS = 5 * 60_000;
export const GENERIC_SOURCE_STALE_AFTER_MS = 24 * 60 * 60_000;
export const TRACKALACKER_NOTIFICATION_SETTINGS_URL = "https://www.trackalacker.com/users/settings/notifications/edit";

export type ReceiptState = "ok" | "attention" | "waiting" | "none";
export type DeliveryHealthState = "ok" | "attention" | "waiting";
/**
 * `refused`: the companion reports (in its heartbeat) that it asked for calls
 * and Yoink answered with an HTTP error. `no_store_access`: it reports no
 * store permission at all, so it skips the job loop. Both differ from `never`,
 * where the companion reports nothing that explains the silence.
 */
export type DevicePollState = "polling" | "silent" | "never" | "refused" | "no_store_access" | "offline" | "unpaired";

/** The companion loops whose last outcome rides on the heartbeat (background.js LOOP_HEALTH_LOOPS). */
export const COMPANION_LOOPS = ["jobs", "notifications", "watch", "health"] as const;
export type CompanionLoop = (typeof COMPANION_LOOPS)[number];

export interface CompanionLoopOutcome {
  at: string;
  reason: string;
  ok: boolean;
  status: number;
  code: string;
  consecutiveFailures: number;
}

export type CompanionLoopHealth = Partial<Record<CompanionLoop, CompanionLoopOutcome>>;

/** A reported loop outcome counts for this long; older ones say nothing about the current silence. */
export const COMPANION_LOOP_REPORT_MAX_AGE_MS = 2 * DEVICE_POLL_SILENCE_MS;

const LOOP_CODE_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;

/**
 * Bound the heartbeat's `loopHealth` block to the documented shape: known
 * loops only, a valid timestamp, bounded words and numbers. Anything else is
 * dropped rather than refused so a newer companion never loses its heartbeat.
 */
export function normalizeCompanionLoopHealth(value: unknown): CompanionLoopHealth {
  const source = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const loops: CompanionLoopHealth = {};
  for (const loop of COMPANION_LOOPS) {
    const entry = source[loop];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const at = typeof record.at === "string" ? record.at.slice(0, 40) : "";
    const time = Date.parse(at);
    if (!Number.isFinite(time)) continue;
    const reason = String(record.reason ?? "");
    const code = String(record.code ?? "");
    loops[loop] = {
      at: new Date(time).toISOString(),
      reason: LOOP_CODE_PATTERN.test(reason) ? reason : "unknown",
      ok: record.ok === true,
      status: Math.max(0, Math.min(599, Math.trunc(Number(record.status) || 0))),
      code: LOOP_CODE_PATTERN.test(code) ? code : "",
      consecutiveFailures: Math.max(0, Math.min(10_000, Math.trunc(Number(record.consecutiveFailures) || 0)))
    };
  }
  return loops;
}

/**
 * The add lanes the companion holds store permission for. Unknown ids (a
 * newer companion's lanes) are dropped; `null` means "not reported" (an older
 * companion), which is different from an empty list.
 */
export function normalizeAccessibleRetailers(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const known = new Set<string>(ADD_LANE_IDS);
  return [...new Set(value.slice(0, 64).map((entry) => String(entry ?? "").toLowerCase()).filter((entry) => known.has(entry)))];
}

export interface DeliveryLever {
  code: string;
  label: string;
  url?: string;
}

export interface DeliveryReceipt {
  key: "signal" | "job" | "lease" | "delivered" | "cart_ready";
  label: string;
  at: string;
  ageMs: number | null;
  state: ReceiptState;
  detail: string;
  lever: DeliveryLever | null;
}

export interface DeliveryDeviceInput {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string;
  lastNotificationPollAt: string;
  lastJobPollAt: string;
  notificationsCapable: boolean;
  platform?: string;
  /** Last loop outcomes the companion reported in its heartbeat; absent for older companions. */
  loopHealth?: CompanionLoopHealth;
  /** Add lanes the companion holds store permission for; null/absent when not reported. */
  accessibleRetailers?: string[] | null;
}

export interface DeliveryTestAlertReceipt {
  requestedAt: string;
  jobId: string;
  deliveryId: string;
  state: string;
  attempts: number;
  deliveredAt: string;
  failureCode: string;
  title: string;
}

export interface DeliveryHealthInput {
  now: number;
  lastSignalAt: string;
  lastJobAt: string;
  lastLeaseAt: string;
  lastDeliveredAt: string;
  lastCartReadyAt: string;
  notifications: {
    windowDays: number;
    created: number;
    delivered: number;
    expired: number;
    failed: number;
    pending: number;
  };
  pendingNotifications: number;
  consecutiveUndelivered: number;
  dominantFailureCode: string;
  devices: DeliveryDeviceInput[];
  connectors: { total: number; enabled: number; bound: number };
  activePlans: number;
  cartFreshnessSeconds: number;
  notifyLifetimeSeconds: number;
  testAlert: DeliveryTestAlertReceipt | null;
}

export interface DeliveryHealth {
  contractVersion: 1;
  generatedAt: string;
  state: DeliveryHealthState;
  headline: string;
  summary: string;
  nextAction: DeliveryLever | null;
  receipts: DeliveryReceipt[];
  channel: {
    kind: "chrome_toast";
    label: string;
    deviceName: string;
    pollState: DevicePollState;
    lastPollAt: string;
    lastPollAgeMs: number | null;
    onlineDevices: number;
    pairedDevices: number;
    cartFreshnessSeconds: number;
    notifyLifetimeSeconds: number;
    explanation: string;
    devices: Array<DeliveryDeviceInput & { pollState: DevicePollState; lastPollAgeMs: number | null }>;
  };
  notifications: DeliveryHealthInput["notifications"] & {
    pendingNow: number;
    consecutiveUndelivered: number;
    dominantFailureCode: string;
    dominantFailureReason: string;
  };
  destinations: { total: number; enabled: number; bound: number };
  testAlert: (DeliveryTestAlertReceipt & { label: string; summary: string }) | null;
}

interface NotificationFailureReason {
  label: string;
  summary: string;
  lever: DeliveryLever | null;
}

export const OPEN_COMPANION_LEVER: DeliveryLever = { code: "open_companion", label: "Open the Chrome companion" };
export const CHROME_NOTIFICATIONS_LEVER: DeliveryLever = { code: "chrome_notifications", label: "Check Chrome notification permission" };
export const SEND_TEST_ALERT_LEVER: DeliveryLever = { code: "send_test_alert", label: "Send test alert" };
export const PAIR_COMPANION_LEVER: DeliveryLever = { code: "pair_companion", label: "Pair Chrome" };
export const RELOAD_COMPANION_LEVER: DeliveryLever = { code: "reload_companion", label: "Reload the companion in chrome://extensions" };
export const GRANT_STORE_ACCESS_LEVER: DeliveryLever = { code: "grant_store_access", label: "Allow store access in the Chrome companion" };

/**
 * Failure codes written when the shopper's own plan change closed a pending
 * call (pause, satisfied, archive, delete, a disabled listing). They are not
 * delivery failures: delivery health neither counts nor blames the device for
 * them, and expiry recovery never relabels them (it only touches open rows).
 */
export const PLAN_CLOSED_DELIVERY_FAILURE_CODES = Object.freeze([
  "plan_paused", "plan_satisfied", "plan_archived", "plan_deleted", "target_disabled"
] as const);
export type PlanClosedDeliveryFailureCode = (typeof PLAN_CLOSED_DELIVERY_FAILURE_CODES)[number];

/** Plain words for every notification delivery failure code the server can write. */
export const NOTIFICATION_FAILURE_REASONS: Readonly<Record<string, NotificationFailureReason>> = Object.freeze({
  device_poll_refused: {
    label: "Chrome was refused",
    summary: "Chrome asked Yoink for calls but every request was refused, so this one expired unseen. Reload the companion; if it continues, pair it again.",
    lever: RELOAD_COMPANION_LEVER
  },
  no_device_poll: {
    label: "Chrome never asked",
    summary: "Chrome never asked Yoink for this call, so it expired unseen. Keep Chrome open, then reload the companion and send a test alert.",
    lever: RELOAD_COMPANION_LEVER
  },
  job_window_expired: {
    label: "Expired before pickup",
    summary: "Chrome asked for calls but this one expired before it was picked up.",
    lever: OPEN_COMPANION_LEVER
  },
  delivery_attempts_exhausted: {
    label: "Chrome could not show it",
    summary: "Chrome tried three times and could not show the notification. Check that Chrome notifications are allowed.",
    lever: CHROME_NOTIFICATIONS_LEVER
  },
  chrome_notification_failed: {
    label: "Chrome could not show it",
    summary: "Chrome reported that the notification could not be shown.",
    lever: CHROME_NOTIFICATIONS_LEVER
  },
  lease_expired_requeued: {
    label: "Retrying",
    summary: "Chrome started this delivery but did not confirm it; Yoink will hand it to Chrome again.",
    lever: null
  },
  unsupported_retailer: {
    label: "Store not supported",
    summary: "Chrome notifications are not available for this store yet.",
    lever: null
  },
  superseded: {
    label: "Replaced by a newer call",
    summary: "A newer call for the same product replaced this one.",
    lever: null
  },
  plan_paused: {
    label: "Plan paused",
    summary: "The plan was paused before Chrome showed this call, so it was closed. Chrome was not at fault.",
    lever: null
  },
  plan_satisfied: {
    label: "Plan complete",
    summary: "The plan reached its quantity before Chrome showed this call, so it was closed. Chrome was not at fault.",
    lever: null
  },
  plan_archived: {
    label: "Plan archived",
    summary: "The plan was archived before Chrome showed this call, so it was closed. Chrome was not at fault.",
    lever: null
  },
  plan_deleted: {
    label: "Plan deleted",
    summary: "The plan was deleted before Chrome showed this call, so it was closed. Chrome was not at fault.",
    lever: null
  },
  target_disabled: {
    label: "Listing turned off",
    summary: "This store listing was turned off in the plan before Chrome showed the call, so it was closed. Chrome was not at fault.",
    lever: null
  }
});

export function notificationFailureReason(code: string): NotificationFailureReason {
  const key = String(code || "").trim();
  if (!key) return { label: "", summary: "", lever: null };
  return NOTIFICATION_FAILURE_REASONS[key] ?? {
    label: "Not delivered",
    summary: `The notification was not delivered (${key.replaceAll("_", " ")}).`,
    lever: null
  };
}

export interface NotificationDeliveryPresentation {
  label: string;
  summary: string;
  stage: "queued" | "checking" | "closed";
  failed: boolean;
  pending: boolean;
  delivered: boolean;
  reason: string;
}

/** Server-side status words for a notify job, computed from its delivery state (not from the job state). */
export function notificationDeliveryPresentation(
  deliveryState: string,
  failureCode = "",
  deliveredAt = ""
): NotificationDeliveryPresentation | null {
  const state = String(deliveryState || "").trim();
  if (!state) return null;
  const reason = notificationFailureReason(failureCode);
  switch (state) {
    case "pending":
      return {
        label: "Waiting for Chrome",
        summary: failureCode === "lease_expired_requeued"
          ? reason.summary
          : "Yoink is holding this call until a paired Chrome browser asks for it.",
        stage: "queued",
        failed: false,
        pending: true,
        delivered: false,
        reason: failureCode === "lease_expired_requeued" ? reason.label : ""
      };
    case "leased":
      return {
        label: "Delivering",
        summary: "Chrome picked this call up and is showing the notification.",
        stage: "checking",
        failed: false,
        pending: true,
        delivered: false,
        reason: ""
      };
    case "delivered":
    case "clicked":
    case "dismissed":
      return {
        label: "Delivered",
        summary: deliveredAt ? `Chrome showed this call at ${deliveredAt}.` : "Chrome showed this call.",
        stage: "closed",
        failed: false,
        pending: false,
        delivered: true,
        reason: ""
      };
    case "expired":
      return {
        label: "Not delivered",
        summary: reason.summary || "This call expired before Chrome showed it.",
        stage: "closed",
        failed: true,
        pending: false,
        delivered: false,
        reason: reason.label || "Expired"
      };
    case "failed":
      return {
        label: "Not delivered",
        summary: reason.summary || "Chrome could not show this call.",
        stage: "closed",
        failed: true,
        pending: false,
        delivered: false,
        reason: reason.label || "Failed"
      };
    default:
      return {
        label: "Not delivered",
        summary: reason.summary || `Delivery state: ${state.replaceAll("_", " ")}.`,
        stage: "closed",
        failed: true,
        pending: false,
        delivered: false,
        reason: reason.label
      };
  }
}

/** A failure label inside a sentence: lower-case its first letter unless it starts with a name. */
function inlineLabel(label: string): string {
  return /^(?:Chrome|TrackaLacker|Yoink)\b/.test(label) ? label : `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

export function ageMs(value: string, now: number): number | null {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? Math.max(0, now - time) : null;
}

export function describeAge(value: number | null): string {
  if (value === null) return "never";
  const minutes = Math.round(value / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function latest(...values: string[]): string {
  let best = "";
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const time = Date.parse(String(value || ""));
    if (Number.isFinite(time) && time > bestTime) {
      best = new Date(time).toISOString();
      bestTime = time;
    }
  }
  return best;
}

/**
 * The most recent refusal among the polling loops: the companion asked
 * (jobs or notifications) and the server answered with an HTTP error.
 */
export function companionPollRefusal(device: DeliveryDeviceInput, now: number): CompanionLoopOutcome | null {
  let refusal: CompanionLoopOutcome | null = null;
  for (const loop of ["notifications", "jobs"] as const) {
    const entry = device.loopHealth?.[loop];
    if (!entry || entry.ok || entry.status < 400) continue;
    const age = ageMs(entry.at, now);
    if (age === null || age > COMPANION_LOOP_REPORT_MAX_AGE_MS) continue;
    if (!refusal || Date.parse(entry.at) > Date.parse(refusal.at)) refusal = entry;
  }
  return refusal;
}

export function devicePollState(device: DeliveryDeviceInput, now: number): { pollState: DevicePollState; lastPollAgeMs: number | null } {
  const lastPoll = latest(device.lastNotificationPollAt, device.lastJobPollAt);
  const lastPollAgeMs = ageMs(lastPoll, now);
  if (!device.online) return { pollState: "offline", lastPollAgeMs };
  if (lastPollAgeMs !== null && lastPollAgeMs <= DEVICE_POLL_SILENCE_MS) return { pollState: "polling", lastPollAgeMs };
  // Not polling. The heartbeat's own report explains why when it can.
  if (companionPollRefusal(device, now)) return { pollState: "refused", lastPollAgeMs };
  if (Array.isArray(device.accessibleRetailers) && device.accessibleRetailers.length === 0) {
    return { pollState: "no_store_access", lastPollAgeMs };
  }
  return { pollState: lastPollAgeMs === null ? "never" : "silent", lastPollAgeMs };
}

export function buildDeliveryHealth(input: DeliveryHealthInput): DeliveryHealth {
  const now = input.now;
  const generatedAt = new Date(now).toISOString();
  const devices = input.devices.map((device) => ({ ...device, ...devicePollState(device, now) }));
  const onlineDevices = devices.filter((device) => device.online);
  const pairedDevices = devices.length;
  const primaryDevice = onlineDevices.find((device) => device.notificationsCapable) ?? onlineDevices[0] ?? devices[0] ?? null;
  const lastPollAt = latest(...devices.flatMap((device) => [device.lastNotificationPollAt, device.lastJobPollAt]));
  const lastPollAgeMs = ageMs(lastPollAt, now);
  const pollState: DevicePollState = pairedDevices === 0
    ? "unpaired"
    : onlineDevices.length === 0
      ? "offline"
      : onlineDevices.some((device) => device.pollState === "polling")
        ? "polling"
        : onlineDevices.some((device) => device.pollState === "refused")
          ? "refused"
          : onlineDevices.some((device) => device.pollState === "no_store_access")
            ? "no_store_access"
            : onlineDevices.some((device) => device.pollState === "silent") ? "silent" : "never";
  const refusedDevice = pollState === "refused" ? onlineDevices.find((device) => device.pollState === "refused") ?? null : null;
  const refusal = refusedDevice ? companionPollRefusal(refusedDevice, now) : null;
  const refusalWords = refusal
    ? `HTTP ${refusal.status}${refusal.code ? `, ${refusal.code.replaceAll("_", " ")}` : ""}`
    : "";
  const dominant = notificationFailureReason(input.dominantFailureCode);
  const counts = input.notifications;
  const undeliveredRecently = counts.created > 0 && counts.delivered === 0 && (counts.expired + counts.failed) > 0;
  const streak = input.consecutiveUndelivered >= 3;
  // Count the undelivered calls from the window when it has any; a streak of
  // older ones (the streak query reads the last ten) is named as "the last N"
  // rather than as "0 calls in the last 7 days".
  const windowUndelivered = counts.expired + counts.failed;
  const undeliveredCalls = windowUndelivered > 0
    ? `${windowUndelivered.toLocaleString("en-US")} call${windowUndelivered === 1 ? "" : "s"}`
    : `The last ${input.consecutiveUndelivered.toLocaleString("en-US")} calls`;
  const undeliveredPronoun = windowUndelivered === 1 ? "it" : "them";
  const undeliveredWindow = windowUndelivered > 0 ? ` in the last ${counts.windowDays} days` : "";

  const signalAge = ageMs(input.lastSignalAt, now);
  const jobAge = ageMs(input.lastJobAt, now);
  const leaseAge = ageMs(input.lastLeaseAt, now);
  const deliveredAge = ageMs(input.lastDeliveredAt, now);
  const cartReadyAge = ageMs(input.lastCartReadyAt, now);
  const quietSourceMs = input.activePlans > 0 ? TRACKALACKER_STALE_WITH_PLANS_MS : TRACKALACKER_STALE_AFTER_MS;

  const receipts: DeliveryReceipt[] = [
    {
      key: "signal",
      label: "Last call received",
      at: input.lastSignalAt,
      ageMs: signalAge,
      state: signalAge === null
        ? (input.activePlans > 0 ? "waiting" : "none")
        : signalAge > quietSourceMs && input.activePlans > 0 ? "attention" : "ok",
      detail: signalAge === null
        ? "No call has arrived yet."
        : signalAge > quietSourceMs && input.activePlans > 0
          ? `The last call arrived ${describeAge(signalAge)}; the source may have gone quiet.`
          : `Received ${describeAge(signalAge)}.`,
      lever: signalAge !== null && signalAge > quietSourceMs && input.activePlans > 0
        ? { code: "reconnect_source", label: "Open TrackaLacker notification settings", url: TRACKALACKER_NOTIFICATION_SETTINGS_URL }
        : null
    },
    {
      key: "job",
      label: "Last call matched a plan",
      at: input.lastJobAt,
      ageMs: jobAge,
      state: jobAge === null ? (signalAge === null ? "none" : "waiting") : "ok",
      detail: jobAge === null
        ? (signalAge === null ? "Nothing to match yet." : "No call has matched a saved plan yet.")
        : `Matched ${describeAge(jobAge)}.`,
      lever: jobAge === null && signalAge !== null ? { code: "view_plans", label: "Review plans" } : null
    },
    {
      key: "lease",
      label: "Last time Chrome asked",
      at: lastPollAt || input.lastLeaseAt,
      ageMs: lastPollAgeMs ?? leaseAge,
      state: pollState === "polling"
        ? "ok"
        : pollState === "unpaired"
          ? "none"
          : pollState === "offline"
            ? "waiting"
            : "attention",
      detail: pollState === "polling"
        ? `Chrome asked for calls ${describeAge(lastPollAgeMs)}.`
        : pollState === "unpaired"
          ? "No Chrome browser is paired."
          : pollState === "offline"
            ? "No paired Chrome browser is online."
            : pollState === "refused"
              ? `Chrome asks for calls but Yoink refuses the request (${refusalWords}).`
              : pollState === "no_store_access"
                ? "Chrome is online but the companion has no store access, so it does not ask for cart adds."
                : pollState === "never"
                  ? "Chrome is online but has never asked Yoink for calls."
                  : `Chrome is online but last asked for calls ${describeAge(lastPollAgeMs)}.`,
      lever: pollState === "polling" ? null
        : pollState === "unpaired" ? PAIR_COMPANION_LEVER
          : pollState === "offline" ? OPEN_COMPANION_LEVER
            : pollState === "refused" && (refusal?.status === 401 || refusal?.status === 403) ? PAIR_COMPANION_LEVER
              : pollState === "no_store_access" ? GRANT_STORE_ACCESS_LEVER : RELOAD_COMPANION_LEVER
    },
    {
      key: "delivered",
      label: "Last call delivered",
      at: input.lastDeliveredAt,
      ageMs: deliveredAge,
      state: undeliveredRecently || streak
        ? "attention"
        : deliveredAge === null ? (jobAge === null ? "none" : "waiting") : "ok",
      detail: undeliveredRecently || streak
        ? `${undeliveredCalls}${undeliveredWindow} expired before Chrome showed ${undeliveredPronoun}${dominant.label ? ` (${inlineLabel(dominant.label)})` : ""}.`
        : deliveredAge === null
          ? (jobAge === null ? "Nothing to deliver yet." : "No call has been delivered yet.")
          : `Delivered ${describeAge(deliveredAge)}.`,
      lever: undeliveredRecently || streak ? (dominant.lever ?? SEND_TEST_ALERT_LEVER) : null
    },
    {
      key: "cart_ready",
      label: "Last cart ready",
      at: input.lastCartReadyAt,
      ageMs: cartReadyAge,
      state: cartReadyAge === null ? "none" : "ok",
      detail: cartReadyAge === null ? "No cart add has completed yet." : `Cart ready ${describeAge(cartReadyAge)}.`,
      lever: null
    }
  ];

  const attention = receipts.filter((receipt) => receipt.state === "attention");
  const anyActivity = receipts.some((receipt) => receipt.ageMs !== null);
  const state: DeliveryHealthState = attention.length ? "attention" : anyActivity ? "ok" : "waiting";

  let headline: string;
  let summary: string;
  let nextAction: DeliveryLever | null;
  const deviceName = primaryDevice?.name || "your Chrome browser";
  if (pollState === "unpaired") {
    headline = "No Chrome browser is paired.";
    summary = "Calls can only reach you as a Chrome notification. Pair the companion first.";
    nextAction = PAIR_COMPANION_LEVER;
  } else if (pollState === "offline") {
    headline = "No paired Chrome browser is online.";
    summary = `Open Chrome on ${deviceName} so the companion can pick up calls.`;
    nextAction = OPEN_COMPANION_LEVER;
  } else if (pollState === "refused") {
    headline = "Chrome asks Yoink for calls, but the requests are refused.";
    summary = `${deviceName} asked for calls ${describeAge(ageMs(refusal?.at ?? "", now))} and Yoink answered ${refusalWords}${refusal && refusal.consecutiveFailures > 1 ? ` (${refusal.consecutiveFailures.toLocaleString("en-US")} times in a row)` : ""}. ${refusal?.status === 401 || refusal?.status === 403 ? "Pair the companion again." : "Reload the companion, then send a test alert."}`;
    nextAction = refusal?.status === 401 || refusal?.status === 403 ? PAIR_COMPANION_LEVER : RELOAD_COMPANION_LEVER;
  } else if (pollState === "no_store_access") {
    headline = "The Chrome companion has no store access.";
    summary = `${deviceName} is online but Chrome has not granted the companion access to any supported store, so it cannot pick up calls. Allow store access from the companion popup.`;
    nextAction = GRANT_STORE_ACCESS_LEVER;
  } else if (pollState === "never" || pollState === "silent") {
    headline = "Chrome is not asking Yoink for calls.";
    summary = pollState === "never"
      ? `${deviceName} is online but has never asked Yoink for calls, so nothing can be delivered. Reload the companion, then send a test alert.`
      : `${deviceName} is online but last asked for calls ${describeAge(lastPollAgeMs)}. Reload the companion, then send a test alert.`;
    nextAction = RELOAD_COMPANION_LEVER;
  } else if (undeliveredRecently || streak) {
    headline = `${undeliveredCalls} expired before Chrome could show ${undeliveredPronoun}.`;
    summary = `${dominant.summary || "Chrome did not show the notification."} Last delivered: ${describeAge(deliveredAge)}.`;
    nextAction = dominant.lever ?? SEND_TEST_ALERT_LEVER;
  } else if (attention.length) {
    headline = attention[0]!.detail;
    summary = attention.slice(1).map((receipt) => receipt.detail).join(" ") || "Check the receipts below.";
    nextAction = attention[0]!.lever;
  } else if (deliveredAge !== null) {
    headline = `Calls reach ${deviceName}.`;
    summary = `Last delivered ${describeAge(deliveredAge)}; Chrome asked for calls ${describeAge(lastPollAgeMs)}.`;
    nextAction = null;
  } else {
    headline = `Ready to deliver to ${deviceName}.`;
    summary = `Chrome asked for calls ${describeAge(lastPollAgeMs)}. No call has been delivered yet; send a test alert to prove the path.`;
    nextAction = SEND_TEST_ALERT_LEVER;
  }

  const cartMinutes = Math.max(1, Math.round(input.cartFreshnessSeconds / 60));
  const notifyHours = Math.max(1, Math.round(input.notifyLifetimeSeconds / 3_600));
  const explanation = `Calls appear as a Chrome notification on ${deviceName}. A notify-only call waits up to ${notifyHours} hour${notifyHours === 1 ? "" : "s"} for Chrome; a cart-add call expires ${cartMinutes} minute${cartMinutes === 1 ? "" : "s"} after the store signal.`;

  const testAlert = input.testAlert
    ? (() => {
      const presentation = notificationDeliveryPresentation(input.testAlert.state, input.testAlert.failureCode, input.testAlert.deliveredAt);
      return {
        ...input.testAlert,
        label: presentation?.label ?? "Requested",
        summary: presentation?.summary ?? "The test alert was requested."
      };
    })()
    : null;

  return {
    contractVersion: 1,
    generatedAt,
    state,
    headline,
    summary,
    nextAction,
    receipts,
    channel: {
      kind: "chrome_toast",
      label: `Chrome notification on ${deviceName}`,
      deviceName,
      pollState,
      lastPollAt,
      lastPollAgeMs,
      onlineDevices: onlineDevices.length,
      pairedDevices,
      cartFreshnessSeconds: input.cartFreshnessSeconds,
      notifyLifetimeSeconds: input.notifyLifetimeSeconds,
      explanation,
      devices
    },
    notifications: {
      ...counts,
      pendingNow: input.pendingNotifications,
      consecutiveUndelivered: input.consecutiveUndelivered,
      dominantFailureCode: input.dominantFailureCode,
      dominantFailureReason: dominant.summary
    },
    destinations: input.connectors,
    testAlert
  };
}

/** Per-source freshness: an honest age instead of a stored "connected" bit. */
export type SourceFreshnessState = "fresh" | "stale" | "never" | "unknown";

export interface SourceFreshnessInput {
  source: string;
  status: string;
  lastEventAt: string;
  lastSignalAt: string;
  lastSyncAt: string;
  activePlans: number;
  now: number;
  trackalacker?: {
    ready: boolean;
    state: string;
    errorCode: string;
    lastHttpStatus: number;
    lastRegistrationAt: string;
    lastNotificationAt: string;
    lastDeliveryAt: string;
    deviceName: string;
  } | null;
  device?: { online: boolean; lastSeenAt: string; name: string } | null;
}

export interface SourceFreshness {
  state: SourceFreshnessState;
  status: string;
  lastSignalAt: string;
  lastSyncAt: string;
  lastActivityAt: string;
  ageMs: number | null;
  /** 0 for a source with no feed to age (links added by hand, scheduled drop windows). */
  staleAfterMs: number;
  detail: string;
  recovery: DeliveryLever | null;
  registration: {
    errorCode: string;
    lastHttpStatus: number;
    lastRegistrationAt: string;
    deviceName: string;
  } | null;
}

/** Sources with no feed to age: product links added by hand and scheduled drop windows. */
const FEEDLESS_SOURCES: ReadonlySet<string> = new Set(["user_link", "admin_link", "drop_window"]);
/** Sources that are not tracking feeds: the feedless ones, and browser observations, which exist while Chrome is open. */
const NON_FEED_SOURCES: ReadonlySet<string> = new Set([...FEEDLESS_SOURCES, "browser"]);

/**
 * Whether a tracking feed (TrackaLacker, Discord) went quiet or failed to
 * register while no other feed is connected. Browser presence never stands in
 * for a feed that is down (E-03). Reads the server's derived source status
 * (DeliveryHealthRepository.decorateSources), which changes only at a
 * freshness threshold, so readiness that binds it stays stable between a
 * preview and a save.
 */
export function trackingNeedsReconnect(sources: ReadonlyArray<Record<string, unknown>>): boolean {
  const feeds = sources.filter((source) => !NON_FEED_SOURCES.has(String(source.source)));
  return feeds.some((source) => source.status === "stale" || source.status === "error")
    && !feeds.some((source) => source.status === "connected");
}

export function sourceFreshness(input: SourceFreshnessInput): SourceFreshness {
  const now = input.now;
  if (input.source === "browser") {
    const online = input.device?.online === true;
    const seenAge = ageMs(input.device?.lastSeenAt ?? "", now);
    const lastActivityAt = latest(input.lastSignalAt, input.device?.lastSeenAt ?? "");
    return {
      state: online ? "fresh" : seenAge === null ? "never" : "stale",
      status: online ? "connected" : "disconnected",
      lastSignalAt: input.lastSignalAt,
      lastSyncAt: input.device?.lastSeenAt ?? "",
      lastActivityAt,
      ageMs: seenAge,
      staleAfterMs: BROWSER_OBSERVATION_STALE_AFTER_MS,
      detail: online
        ? `${input.device?.name || "The Chrome companion"} is online${input.lastSignalAt ? `; last browser observation ${describeAge(ageMs(input.lastSignalAt, now))}` : ""}.`
        : seenAge === null ? "No Chrome companion has been paired." : `The Chrome companion was last online ${describeAge(seenAge)}.`,
      // A paired companion that is offline needs Chrome opened, not a new pairing.
      recovery: online ? null : seenAge === null ? PAIR_COMPANION_LEVER : OPEN_COMPANION_LEVER,
      registration: null
    };
  }
  if (input.source === "trackalacker") {
    const push = input.trackalacker ?? null;
    const lastActivityAt = latest(input.lastSignalAt, push?.lastDeliveryAt ?? "", push?.lastRegistrationAt ?? "", push?.lastNotificationAt ?? "");
    const activityAge = ageMs(lastActivityAt, now);
    const staleAfterMs = input.activePlans > 0 ? TRACKALACKER_STALE_WITH_PLANS_MS : TRACKALACKER_STALE_AFTER_MS;
    const registration = push
      ? { errorCode: push.errorCode, lastHttpStatus: push.lastHttpStatus, lastRegistrationAt: push.lastRegistrationAt, deviceName: push.deviceName }
      : null;
    const reconnect: DeliveryLever = { code: "reconnect_source", label: "Open TrackaLacker notification settings", url: TRACKALACKER_NOTIFICATION_SETTINGS_URL };
    if (!push?.ready) {
      // Never echo the stored status here: it is set to "connected" on every
      // event and never ages, so an unregistered or failed push would still
      // mark tracking complete in setup.
      return {
        state: "unknown",
        status: push?.errorCode ? "error" : "disconnected",
        lastSignalAt: input.lastSignalAt,
        lastSyncAt: input.lastSyncAt,
        lastActivityAt,
        ageMs: activityAge,
        staleAfterMs,
        detail: push?.errorCode
          ? `Push registration failed (${push.errorCode.replaceAll("_", " ")}${push.lastHttpStatus ? `, HTTP ${push.lastHttpStatus}` : ""})${push.lastRegistrationAt ? `; last registered ${describeAge(ageMs(push.lastRegistrationAt, now))}` : ""}.`
          : "TrackaLacker push is not registered from the Chrome companion yet.",
        recovery: reconnect,
        registration
      };
    }
    if (activityAge === null) {
      return {
        state: "never",
        status: "connected",
        lastSignalAt: input.lastSignalAt,
        lastSyncAt: input.lastSyncAt,
        lastActivityAt,
        ageMs: null,
        staleAfterMs,
        detail: "Registered, but no push has arrived yet.",
        recovery: null,
        registration
      };
    }
    const stale = activityAge > staleAfterMs;
    return {
      state: stale ? "stale" : "fresh",
      status: stale ? "stale" : "connected",
      lastSignalAt: input.lastSignalAt,
      lastSyncAt: input.lastSyncAt,
      lastActivityAt,
      ageMs: activityAge,
      staleAfterMs,
      detail: stale
        ? `No push, delivery, or registration from TrackaLacker for ${describeAge(activityAge).replace(" ago", "")}. Re-register from the companion popup.`
        : `Last TrackaLacker activity ${describeAge(activityAge)}${input.lastSignalAt ? `; last call ${describeAge(ageMs(input.lastSignalAt, now))}` : ""}.`,
      recovery: stale ? reconnect : null,
      registration
    };
  }
  const lastActivityAt = latest(input.lastSignalAt, input.lastEventAt);
  const activityAge = ageMs(lastActivityAt, now);
  if (FEEDLESS_SOURCES.has(input.source) || input.status === "manual") {
    // Links added by hand and scheduled drop windows have no feed that can go
    // quiet: keep the stored status and never age them to "stale".
    const scheduled = input.source === "drop_window";
    const activity = activityAge === null ? "" : `; last activity ${describeAge(activityAge)}`;
    return {
      state: activityAge === null ? "never" : "fresh",
      status: input.status,
      lastSignalAt: input.lastSignalAt,
      lastSyncAt: input.lastSyncAt,
      lastActivityAt,
      ageMs: activityAge,
      staleAfterMs: 0,
      detail: scheduled ? `Scheduled drop windows${activity}.` : `Links added by hand${activity}.`,
      recovery: null,
      registration: null
    };
  }
  const connected = input.status === "connected";
  return {
    state: !connected ? "unknown" : activityAge === null ? "never" : activityAge > GENERIC_SOURCE_STALE_AFTER_MS ? "stale" : "fresh",
    status: connected && activityAge !== null && activityAge > GENERIC_SOURCE_STALE_AFTER_MS ? "stale" : input.status,
    lastSignalAt: input.lastSignalAt,
    lastSyncAt: input.lastSyncAt,
    lastActivityAt,
    ageMs: activityAge,
    staleAfterMs: GENERIC_SOURCE_STALE_AFTER_MS,
    detail: !connected
      ? "This source is not connected."
      : activityAge === null ? "Connected, but no call has arrived yet." : `Last call ${describeAge(activityAge)}.`,
    recovery: null,
    registration: null
  };
}
