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
  id: "yoink-1-30-25-cheapest-first",
  version: "1.30.25",
  publishedAt: "2026-10-10T04:00:00.000Z",
  title: "Cheapest price first, and In stock only",
  summary: "Find shows each product's cheapest store price, hides stores Yoink can't shop yet, and has an In stock only switch.",
  highlights: [
    "Each product shows its cheapest store; turn on In stock only beside the search to see only what a store has, at its cheapest in-stock price.",
    "Products without a picture get one on the next refresh; Yoink keeps a copy of each on this PC.",
    "A store's stock shows as in stock or sold out until it misses an hourly refresh, instead of turning stale after 5 minutes."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
