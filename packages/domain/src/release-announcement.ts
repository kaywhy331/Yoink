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
  id: "yoink-1-30-9-confirm-msrp",
  version: "1.30.9",
  publishedAt: "2026-10-08T18:00:00.000Z",
  title: "Confirm the MSRP and Yoink adds it to your cart",
  summary: "At Amazon, Target, Walmart and Best Buy, Want it now asks you to confirm the item's MSRP, filled in from TrackaLacker when it has one. After that, a call at or below it is added to your cart.",
  highlights: [
    "Open Want it on each item you want in your cart, check the MSRP and save. Items still waiting show Add to cart · needs MSRP.",
    "Your max can't be above the MSRP, and a call has to be at or below both before Yoink adds the item.",
    "After a cart add at Walmart, Amazon or Best Buy, the companion opens checkout so you can place the order."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
