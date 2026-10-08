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
  id: "yoink-1-30-5-trackalacker-reconnects",
  version: "1.30.5",
  publishedAt: "2026-10-08T05:00:00.000Z",
  title: "TrackaLacker stays connected through updates",
  summary: "After a Yoink update, the companion now reconnects to TrackaLacker by itself, so calls keep arriving without pressing Reconnect.",
  highlights: [
    "The companion reconnects through your open TrackaLacker tab, or opens one in the background and closes it again.",
    "Reconnect now works even when your browser has put the TrackaLacker tab to sleep.",
    "Calls, carts ready to check out and drop-watch alerts appear as desktop notifications from the companion."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
