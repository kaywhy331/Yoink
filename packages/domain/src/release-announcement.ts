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
  id: "yoink-1-22-0-local-adapter-repair-loop",
  version: "1.22.0",
  publishedAt: "2026-09-04T21:30:00.000Z",
  title: "Store fixes stay local and verifiable",
  summary: "Failed store checks can now leave a private local capture, reproduce offline, and return through a measured repair and renewal path.",
  highlights: [
    "Sanitized page captures and selector traces stay in the Chrome companion and can be reviewed or deleted from local settings.",
    "Promoted captures replay against source and packaged adapters, while versioned selector packs catch stale releases before packaging.",
    "Repair groups now distinguish store state from adapter defects, recheck automatically, and show when a fix still needs live confirmation."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
