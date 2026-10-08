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
  id: "yoink-1-30-8-checkout-handoff",
  version: "1.30.8",
  publishedAt: "2026-10-08T17:00:00.000Z",
  title: "Added items open on checkout",
  summary: "When the companion has added an item at Walmart, Amazon or Best Buy and proved it is in your cart, it now opens that store's checkout page, so the next step is placing the order.",
  highlights: [
    "Checkout opens in the same tab the companion used to check your cart. You review the order and place it yourself.",
    "Target still opens on the cart until its store check passes.",
    "The companion is named after the browser it runs in, such as Desktop - Windows - Brave."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
