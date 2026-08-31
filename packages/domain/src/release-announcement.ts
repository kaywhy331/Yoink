export interface UserReleaseAnnouncement {
  id: string;
  version: string;
  publishedAt: string;
  title: string;
  summary: string;
  highlights: string[];
  docsUrl: string;
}

export const CURRENT_USER_RELEASE_ANNOUNCEMENT: Readonly<UserReleaseAnnouncement> = Object.freeze({
  id: "yoink-1-16-action-speed",
  version: "1.16.0",
  publishedAt: "2026-08-30T00:00:00.000Z",
  title: "Faster cart handoffs and store readiness",
  summary: "Yoink now carries each exact call through a faster, restart-safe Chrome path and makes cart-ready, source, queue, and store-lane state immediately actionable.",
  highlights: [
    "Cart-ready notification, badge, optional sound, popup state, adaptive dashboard handoff, and Got it or Missed it close-out now share one measured path.",
    "Batch retry, warm readiness, reusable store tabs, restart-safe watch leases, and all-lane no-click reverification remove avoidable cold-path and arming delays.",
    "Calls now combines queue-open facts, bulk profiles, affiliate routing, false-positive feedback, source replay, all-store confirmation observation, and sanitized health controls."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
