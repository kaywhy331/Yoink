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
  id: "yoink-1-28-7-self-updating",
  version: "1.28.7",
  publishedAt: "2026-09-30T21:00:00.000Z",
  title: "Yoink updates itself on your PC",
  summary: "The Windows tray now installs new versions by itself, keeps the Chrome companion current, and sends troubleshooting logs to the development workstation.",
  highlights: [
    "The tray checks for a new version every hour and installs it by itself. It waits while a cart add is in progress, and it updates the Chrome companion and the tray too.",
    "Every 15 minutes and after any problem, the tray sends logs, status reports and saved store pages from failed store checks. It never sends your database, keys or pairing tokens.",
    "The Chrome companion no longer shows \"Background checks can't reach Yoink\" after Yoink restarts: the next successful check clears it."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
