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
  id: "yoink-1-30-4-call-alerts-show",
  version: "1.30.4",
  publishedAt: "2026-10-08T01:00:00.000Z",
  title: "Call alerts now appear on your desktop",
  summary: "The Chrome companion can now show its desktop alerts in Brave and Chrome. Until this release every alert failed to appear, because the browser could not draw the companion's icon.",
  highlights: [
    "Calls, carts ready to check out and drop-watch alerts now pop up as desktop notifications from the companion.",
    "When Yoink updates, it also updates a Yoink Companion that Brave, Chrome or Edge loads from another folder, and the companion reloads into the new version by itself.",
    "Yoink keeps its own copy of each product picture and loads pictures from your PC."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
