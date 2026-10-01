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
  id: "yoink-1-30-0-cart-find-setup",
  version: "1.30.0",
  publishedAt: "2026-10-01T18:00:00.000Z",
  title: "Cart, Find and Setup",
  summary: "Yoink now has three tabs: Cart for your carts and what you want, Find for adding products, and Setup for stores, Chrome, alerts and limits. One Auto-cart switch at the top turns cart adds on or off.",
  highlights: [
    "Calls no longer add items to your Want list. A call for something you don't want shows in the call log with Want it, and Wanted offers a one-time Review that removes the items earlier calls added.",
    "On your own PC, turn each store on or off for cart adds in Setup › Stores, after the same store check Admin uses. Stores that are off still send alerts.",
    "Pause and Resume are now one Auto-cart switch in the header. Insights moved to Admin, and your results CSV is in Setup › Your data."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
