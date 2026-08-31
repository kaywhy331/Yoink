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
  id: "yoink-1-17-0-store-routing",
  version: "1.17.0",
  publishedAt: "2026-08-31T00:00:00.000Z",
  title: "More reliable store checks and safer outbound routing",
  summary: "Yoink now recognizes additional current retailer layouts, routes only approved Howl stores through affiliate links, and lets you safely delete obsolete purchase plans.",
  highlights: [
    "Target, Walmart, Amazon, and Best Buy checks handle additional current page structures while ambiguous evidence still stops safely before any Add control.",
    "The admin Howl directory contains 160 exact website scopes; unlisted registered stores keep their direct retailer links.",
    "Purchase plans can be deleted without erasing action or spend history, and challenged warm-readiness tabs no longer multiply in the background."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
