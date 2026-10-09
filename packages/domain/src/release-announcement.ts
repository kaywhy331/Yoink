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
  id: "yoink-1-30-24-product-pictures",
  version: "1.30.24",
  publishedAt: "2026-10-10T02:00:00.000Z",
  title: "Pictures for your products",
  summary: "Every followed TrackaLacker product now gets a picture, so Find and Wanted are easy to scan. Yoink also refreshes them by itself, every hour.",
  highlights: [
    "Products without a picture get one on the next refresh; Yoink keeps a copy of each on this PC.",
    "Prices and stock refresh every hour by themselves, about ten times faster than before.",
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
