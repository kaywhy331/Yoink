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
  id: "yoink-1-22-1-store-checks-run-on-their-own",
  version: "1.22.1",
  publishedAt: "2026-09-05T02:30:00.000Z",
  title: "Store checks run on their own",
  summary: "Target checks work again, automatic store checks start within minutes and run hourly while a store needs attention, and Check stores now starts one on demand.",
  highlights: [
    "Target product pages record their store checks again; a rejected check now says why instead of failing silently.",
    "Automatic store checks begin two minutes after the companion starts, wake hourly while any store needs evidence, and record every held decision.",
    "Check stores now in the companion menu runs the store checks immediately, and closed repair groups say whether the fix was re-checked or the item only changed state."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
