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
  id: "yoink-1-15-action-platform",
  version: "1.15.0",
  publishedAt: "2026-08-30T00:00:00.000Z",
  title: "Drop watch and action readiness",
  summary: "Yoink can now stage exact drop windows, keep each opted-in item under bounded observation, and show what is ready before a signal becomes a cart action.",
  highlights: [
    "Provider-neutral signals add per-channel trust, Discord intake, batching, and replay-safe source health.",
    "Drop windows create an exact read-only watch queue that handles staggered releases without clicking a retailer control.",
    "Calls, readiness, connector handoffs, privacy receipts, health details, and action analytics now share one user action platform."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
