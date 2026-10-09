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
  id: "yoink-1-30-20-suggested-price",
  version: "1.30.20",
  publishedAt: "2026-10-09T18:00:00.000Z",
  title: "A suggested price in Want it",
  summary: "Under the price chart in Want it: the 90-day low and high, and Yoink's suggested price, a fair going price without spikes or marked-up stores.",
  highlights: [
    "Yoink suggests each store's usual price over 90 days, the highest within $5 or 10% of the cheapest store. Use as my max sets your max to it.",
    "Prices from third-party sellers are left out of the chart and the numbers.",
    "Wanted items show a Yoink button that draws the new Yoink mark."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
