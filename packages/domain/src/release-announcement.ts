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
  id: "yoink-1-30-19-yoink-button",
  version: "1.30.19",
  publishedAt: "2026-10-09T06:00:00.000Z",
  title: "Wanted items say Yoink",
  summary: "Once you want an item, its Want it button turns into Yoink and draws the new Yoink mark: a check with a stem that makes a Y.",
  highlights: [
    "Tap Yoink on a wanted item to change or stop what Yoink does, as before.",
    "The new mark is Yoink's icon in the app, the browser tab, the companion and the Windows tray.",
    "Want it can add at any price up to your max at the store itself, and charts each store's price history."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
