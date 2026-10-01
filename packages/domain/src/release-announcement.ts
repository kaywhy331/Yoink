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
  id: "yoink-1-29-0-want-it-call-log",
  version: "1.29.0",
  publishedAt: "2026-10-01T03:00:00.000Z",
  title: "Want it, and every call explained",
  summary: "Tap Want it on any product to have Yoink add it to your cart at every store that's on, and see on Home what happened to each call and why.",
  highlights: [
    "Want it replaces Quick add: one button on every product and call, one max price, and Add to cart or Alert me across every store that sells the item. Edit it or stop wanting it in the same place.",
    "Home lists the latest calls with what Yoink did: added to your cart, alert sent, or no action because the price was over your max, above MSRP, or the item isn't on your Want list.",
    "Yoink on your PC now updates itself, and the Chrome companion no longer leaves store cart tabs open between calls."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
