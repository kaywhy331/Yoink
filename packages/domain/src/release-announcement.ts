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
  id: "yoink-1-19-4-automatic-incident-repair",
  version: "1.19.4",
  publishedAt: "2026-09-03T23:10:20.000Z",
  title: "Store checks repair incidents automatically",
  summary: "Current store-check issues now drive bounded, varied-product rechecks and close automatically only after passing evidence arrives.",
  highlights: [
    "The newest Target, Walmart, Amazon, or Best Buy incident appears first instead of being buried by older severity.",
    "Automatic checks prioritize unresolved products across distinct recorded layouts, including no-click rehearsal failures.",
    "Passing evidence renews a previously authorized store without resuming paused actions or overriding manual retirement."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
