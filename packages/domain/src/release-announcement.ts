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
  id: "yoink-1-30-10-test-calls",
  version: "1.30.10",
  publishedAt: "2026-10-08T19:00:00.000Z",
  title: "Try each store with a test call",
  summary: "In Setup › Stores, Test call sends one call for an item you pick, so you can watch the companion add it to your cart and open checkout without waiting for a restock.",
  highlights: [
    "The test call goes through the same checks as a real one: your plan, the MSRP, your max and the store check in Chrome. Nothing is ordered.",
    "Its alert says TEST. Remove the item from your cart afterwards if you don't want it.",
    "Want it asks you to confirm the MSRP at Amazon, Target, Walmart and Best Buy; an item is ready for a test call once it has one."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
