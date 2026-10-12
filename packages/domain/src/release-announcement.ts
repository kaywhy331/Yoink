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
  id: "yoink-1-30-30-one-tab-checkout",
  version: "1.30.30",
  publishedAt: "2026-10-12T03:20:00.000Z",
  title: "Each cart add runs in one tab, ending on checkout",
  summary: "Chrome checks your cart, opens the item, adds it and moves on to checkout in the same tab, so the one tab left is checkout, ready for you to place the order.",
  highlights: [
    "No second tab beside it and no item page left behind: checkout opens in that tab and comes to the front, now at Target too.",
    "If a store shows its robot check (like Walmart's Press & Hold) or the link opens a different item, the call log says so instead of \"Chrome stopped before adding\". A robot check's tab stays open for you to finish it.",
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
