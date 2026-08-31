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
  id: "yoink-1-14-cart-handoff",
  version: "1.14.0",
  publishedAt: "2026-08-30T00:00:00.000Z",
  title: "Faster cart handoff",
  summary: "Cart-ready actions now surface immediately, stay visible after the popup closes, and explain what needs you.",
  highlights: [
    "Ready-to-check-out and Needs-you actions are separated clearly.",
    "Got it and Missed it close the exact cart action with explicit confirmation.",
    "Per-hop latency now shows where action time was spent."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
