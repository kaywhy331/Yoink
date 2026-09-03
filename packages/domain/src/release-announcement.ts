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
  id: "yoink-1-19-0-contextual-action-handoff",
  version: "1.19.0",
  publishedAt: "2026-09-02T23:57:23.000Z",
  title: "The next action is easier to find",
  summary: "Yoink now keeps the current product, cart handoff, and system attention state together without turning the popup or dashboards into settings pages.",
  highlights: [
    "Cart ready and Needs you handoffs appear immediately and remain recoverable after the popup or store tab closes.",
    "Background updates preserve loaded pages, refresh the visible workspace, and show a clear Retry control if data becomes stale.",
    "Validated Walmart handoffs prefer the review-order route with affiliate-safe fallbacks; checkout and order submission remain manual."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
