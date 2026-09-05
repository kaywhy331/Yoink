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
  id: "yoink-1-22-3-store-checks-say-what-failed",
  version: "1.22.3",
  publishedAt: "2026-09-05T03:50:00.000Z",
  title: "Store checks say what actually failed",
  summary: "A store check no longer calls a product sold out when the page never said so; it reports the binding it lost, keeps a page snapshot, and opens a repair. Target checks work again and automatic checks run on their own.",
  highlights: [
    "Best Buy, Amazon, and the other stores report out of stock only from page evidence; a lost price, seller, or shipping binding is now a repair with a snapshot, and a pickup-only offer is a plan result.",
    "Target product pages record their store checks again, automatic store checks start within minutes and run hourly while any store needs evidence, and Check stores now runs them on demand.",
    "Closed repair groups say whether the current version was re-checked or the item only changed state."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
