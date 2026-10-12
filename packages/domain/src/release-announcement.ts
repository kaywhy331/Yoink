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
  id: "yoink-1-30-31-one-tab-checkout",
  version: "1.30.31",
  publishedAt: "2026-10-12T05:10:00.000Z",
  title: "Each cart add runs in one tab, ending on checkout",
  summary: "Chrome checks your cart, opens the item, adds it and moves on to checkout in the same tab, so the one tab left is checkout, ready for you to place the order.",
  highlights: [
    "No second tab beside it and no item page left behind: checkout opens in that tab and comes to the front, now at Target too. At Amazon it opens the checkout Amazon's own \"Proceed to checkout\" button does.",
    "A busy Yoink no longer stops an add: Chrome waits up to 15 seconds, not 3, for Yoink to note each step, which is what stopped your Walmart test call. A store's robot check (like Walmart's Press & Hold) or a link that opens a different item is named in the call log, and a robot check's tab stays open for you.",
    "Best Buy's high-demand items now add when their \"High Demand Product\" panel offers Shipping only. Best Buy requires you to be signed in for them, so sign in to Best Buy in Chrome."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
