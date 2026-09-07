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
  id: "yoink-1-28-3-bestbuy-verification-alerts",
  version: "1.28.3",
  publishedAt: "2026-09-07T00:00:00.000Z",
  title: "Best Buy waiting and verification alerts",
  summary: "The companion shows when Best Buy Add starts and when a manual step needs your attention.",
  highlights: [
    "A WAIT badge and popup message remain visible while Best Buy finishes an Add request.",
    "Verification steps show an attention badge and an alert. Open the waiting tab to enter any SMS code yourself.",
    "Yoink preserves the waiting tab and reports cart ready only after verifying the exact item."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
