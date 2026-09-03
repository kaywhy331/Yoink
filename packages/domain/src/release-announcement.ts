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
  id: "yoink-1-19-3-target-qualification-incidents",
  version: "1.19.3",
  publishedAt: "2026-09-03T19:34:30.000Z",
  title: "Target store-check issues reach Incidents",
  summary: "Target page and store-check failures now use the same privacy-bounded incident pipeline as the other supported stores.",
  highlights: [
    "Target inspection reports missing price, seller, fulfillment, offer, and Add-to-Cart bindings for operator repair.",
    "Brief page hydration is retried before a Target layout issue is recorded, reducing transient false alarms.",
    "Diagnostics retain only bounded structural evidence; product URLs, page text, account state, and observed offer values remain excluded."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
