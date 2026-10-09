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
  id: "yoink-1-30-18-any-price-history",
  version: "1.30.18",
  publishedAt: "2026-10-09T02:00:00.000Z",
  title: "Any price up to your max, and price history",
  summary: "Want it can now add an item at whatever Target, Best Buy, Walmart or Amazon charges, up to your max, and shows each store's price history.",
  highlights: [
    "Tick Any price up to my max in Want it. Yoink skips the MSRP check and adds it at the store's own price, never from a third-party seller.",
    "Want it charts every price Yoink recorded at each store, with the MSRP and your max as dashed lines. Hover for that day's prices or open the table.",
    "Updates no longer stop halfway, and Open Yoink uses Brave or another installed browser when Windows has no default one."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
